//! Filter scan runner.
//!
//! For each source we keep at most one in-flight scan. Issuing a new scan
//! sets the previous scan's cancel flag; the worker checks it between lines
//! and exits early. Matching line numbers stream into a shared Vec while the
//! UI virtualizes over its current length.

use crate::filter::Filter;
use crate::index::LineIndex;
use crate::parse;
use crate::source::file::FileSource;
use crate::state::SourceEntry;
use parking_lot::RwLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

pub struct FilterSession {
    pub id: u64,
    pub matches: RwLock<Vec<u64>>,
    pub scanned_lines: AtomicU64,
    pub total_lines: AtomicU64,
    pub done: AtomicBool,
    pub cancel: AtomicBool,
}

impl FilterSession {
    pub fn new(id: u64, total_lines: u64) -> Arc<Self> {
        Arc::new(Self {
            id,
            matches: RwLock::new(Vec::new()),
            scanned_lines: AtomicU64::new(0),
            total_lines: AtomicU64::new(total_lines),
            done: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
        })
    }
}

pub struct ScanProgress {
    pub scanned: u64,
    pub total: u64,
    pub matches: u64,
    pub done: bool,
}

pub fn run_scan(
    entry: Arc<SourceEntry>,
    session: Arc<FilterSession>,
    filter: Filter,
    mut on_progress: impl FnMut(&ScanProgress),
) {
    let file: Arc<FileSource> = entry.file.clone();
    let index: Arc<LineIndex> = entry.index.read().clone();
    let total = index.line_count();
    session.total_lines.store(total, Ordering::Relaxed);

    // Empty filter: every line matches; skip the scan, leave matches empty
    // and rely on `total_lines` for virtualization.
    if filter.is_empty() {
        session.done.store(true, Ordering::Release);
        on_progress(&ScanProgress {
            scanned: total,
            total,
            matches: total,
            done: true,
        });
        return;
    }

    let mut local: Vec<u64> = Vec::new();
    let report_every: u64 = (total / 100).max(8192);
    let mut last_report: u64 = 0;
    for n in 0..total {
        if session.cancel.load(Ordering::Relaxed) {
            return;
        }
        let Some(bytes) = file.raw_line(&index, n) else {
            continue;
        };
        let raw = std::str::from_utf8(&bytes).unwrap_or("");
        let parsed = parse::parse(raw);
        if filter.matches(raw, &parsed) {
            local.push(n);
        }
        if n - last_report >= report_every {
            session.scanned_lines.store(n + 1, Ordering::Relaxed);
            {
                let mut m = session.matches.write();
                m.extend_from_slice(&local);
            }
            local.clear();
            on_progress(&ScanProgress {
                scanned: n + 1,
                total,
                matches: session.matches.read().len() as u64,
                done: false,
            });
            last_report = n;
        }
    }
    {
        let mut m = session.matches.write();
        m.extend_from_slice(&local);
    }
    session.scanned_lines.store(total, Ordering::Relaxed);
    session.done.store(true, Ordering::Release);
    on_progress(&ScanProgress {
        scanned: total,
        total,
        matches: session.matches.read().len() as u64,
        done: true,
    });
}
