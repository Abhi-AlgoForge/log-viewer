//! Live tail for file sources. Wraps `notify` and re-indexes appended bytes.

use crate::error::AppResult;
use crate::state::SourceEntry;
use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub struct TailHandle {
    _watcher: RecommendedWatcher,
    pub stop: Arc<Mutex<bool>>,
}

pub struct AppendInfo {
    pub added_lines: u64,
    pub total_lines: u64,
    pub total_bytes: u64,
}

pub fn start(
    entry: Arc<SourceEntry>,
    mut on_append: impl FnMut(&AppendInfo) + Send + 'static,
) -> AppResult<TailHandle> {
    let path: PathBuf = entry.file.path.clone();
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })?;
    // Watch the parent directory so we still get events if the file is
    // recreated. v0.1 doesn't handle truncation/rotation.
    if let Some(parent) = path.parent() {
        watcher.watch(parent, RecursiveMode::NonRecursive)?;
    } else {
        watcher.watch(&path, RecursiveMode::NonRecursive)?;
    }

    let stop = Arc::new(Mutex::new(false));
    let stop_clone = stop.clone();
    let entry_clone = entry.clone();
    std::thread::spawn(move || {
        let mut last_check = Instant::now() - Duration::from_secs(1);
        loop {
            if *stop_clone.lock() {
                return;
            }
            // Block on the next event but periodically wake to poll the file
            // — some filesystems coalesce or drop modify events under load.
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ok(ev)) => {
                    if !event_targets_path(&ev, &path) {
                        continue;
                    }
                    if last_check.elapsed() < Duration::from_millis(40) {
                        continue;
                    }
                    last_check = Instant::now();
                    poll_and_emit(&entry_clone, &mut on_append);
                }
                Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Timeout) => {
                    if last_check.elapsed() >= Duration::from_millis(500) {
                        last_check = Instant::now();
                        poll_and_emit(&entry_clone, &mut on_append);
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
    });

    Ok(TailHandle {
        _watcher: watcher,
        stop,
    })
}

fn event_targets_path(ev: &Event, path: &std::path::Path) -> bool {
    if ev.paths.is_empty() {
        return true;
    }
    if ev.paths.iter().any(|p| p == path) {
        return true;
    }
    match ev.kind {
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => true,
        EventKind::Create(_) => ev.paths.iter().any(|p| p == path),
        _ => false,
    }
}

fn poll_and_emit(entry: &Arc<SourceEntry>, on_append: &mut impl FnMut(&AppendInfo)) {
    let Some(prev_bytes) = entry.file.refresh().ok().flatten() else {
        return;
    };
    let added_bytes = entry.file.bytes().saturating_sub(prev_bytes);
    if added_bytes == 0 {
        return;
    }
    let (total_lines, prev_total) = {
        let mut guard = entry.index.write();
        let mut new_index = (**guard).clone_for_extend();
        let prev_total = new_index.line_count();
        entry.file.extend_index(&mut new_index, prev_bytes);
        let total_lines = new_index.line_count();
        *guard = Arc::new(new_index);
        (total_lines, prev_total)
    };
    // Invalidate any active filter: appended lines need re-evaluation. For
    // v0.1 we cancel the in-flight scan and clear the session so the
    // frontend can re-issue if needed.
    {
        let mut filt = entry.filter.lock();
        if let Some(prev) = filt.take() {
            prev.cancel.store(true, Ordering::Release);
        }
    }
    on_append(&AppendInfo {
        added_lines: total_lines.saturating_sub(prev_total),
        total_lines,
        total_bytes: entry.file.bytes(),
    });
}
