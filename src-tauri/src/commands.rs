//! Tauri command surface exposed to the frontend.

use crate::ai::{self, prompts, AiConfigView, AiState, ChatMessage, ProviderSettingsUpdate, Speed};
use crate::cluster::{PatternTree, PatternView};
use crate::error::{AppError, AppResult};
use crate::filter::Filter;
use crate::merge::{self, MergeStatus, MergeView};
use crate::parse::{self, Level};
use crate::search::{self, FilterSession};
use crate::source::command;
use crate::source::file::FileSource;
use crate::source::{SourceInfo, SourceKind};
use crate::state::AppState;
use crate::tail;
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{Emitter, State};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgress {
    pub source_id: String,
    pub indexed: u64,
    pub total: u64,
    pub line_count: u64,
    pub done: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FilterProgress {
    pub source_id: String,
    pub filter_id: u64,
    pub scanned: u64,
    pub total: u64,
    pub matches: u64,
    pub done: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawLine {
    pub line_number: u64,
    pub raw: String,
    pub timestamp: Option<i64>,
    pub timestamp_str: Option<String>,
    pub level: Option<Level>,
    pub message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterStatus {
    pub filter_id: u64,
    pub scanned: u64,
    pub total: u64,
    pub matches: u64,
    pub done: bool,
    pub is_empty_filter: bool,
}

#[tauri::command]
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn spawn_indexing(entry: Arc<crate::state::SourceEntry>, app: tauri::AppHandle) {
    let entry_for_task = entry.clone();
    let app_for_task = app.clone();
    let id_for_task = entry.id.clone();
    std::thread::spawn(move || {
        let file = entry_for_task.file.clone();
        let total = file.bytes();
        let mut last_emit = std::time::Instant::now();
        let working_index = file.build_index(8 * 1024 * 1024, |indexed, _total| {
            if last_emit.elapsed().as_millis() >= 50 {
                let _ = app_for_task.emit(
                    "index-progress",
                    IndexProgress {
                        source_id: id_for_task.clone(),
                        indexed,
                        total,
                        line_count: 0,
                        done: false,
                    },
                );
                last_emit = std::time::Instant::now();
            }
        });
        let line_count = working_index.line_count();
        {
            let mut guard = entry_for_task.index.write();
            *guard = Arc::new(working_index);
        }
        {
            let mut done = entry_for_task.indexing_done.lock();
            *done = true;
        }
        let _ = app_for_task.emit(
            "index-progress",
            IndexProgress {
                source_id: id_for_task,
                indexed: total,
                total,
                line_count,
                done: true,
            },
        );
    });
}

fn canonicalize_path(p: &str) -> String {
    std::fs::canonicalize(p)
        .map(|c| c.to_string_lossy().into_owned())
        .unwrap_or_else(|_| p.to_string())
}

#[tauri::command]
pub fn open_file(
    path: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<SourceInfo> {
    let file = Arc::new(FileSource::open(&path)?);
    let entry = state.insert_file(file.clone());
    let source_id = entry.id.clone();
    let abs_path = canonicalize_path(&path);

    let info = SourceInfo {
        id: source_id.clone(),
        label: file.label.clone(),
        kind: SourceKind::File,
        total_lines: 0,
        bytes: file.bytes(),
        indexed: 0,
        live: false,
        path: Some(abs_path),
    };

    spawn_indexing(entry, app);
    Ok(info)
}

#[tauri::command]
pub fn open_command(
    label: String,
    cmdline: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<SourceInfo> {
    let cs = command::spawn(&label, &cmdline)?;
    let path = cs.path.clone();
    let file = Arc::new(FileSource::open(&path)?);
    // Use a friendlier label than the temp filename.
    let label_str = label.trim();
    let label_owned = if label_str.is_empty() {
        cmdline.trim().to_string()
    } else {
        label_str.to_string()
    };
    let kind = guess_command_kind(&cmdline);
    let entry = state.insert_with(file.clone(), kind, Some(cs.child));
    // The displayed label should follow the user's input, not the temp file.
    let info = SourceInfo {
        id: entry.id.clone(),
        label: label_owned,
        kind,
        total_lines: 0,
        bytes: file.bytes(),
        indexed: 0,
        live: true,
        path: None,
    };

    spawn_indexing(entry.clone(), app.clone());

    // Auto-start the live tail so streamed stdout shows up immediately.
    let app_for_tail = app.clone();
    let id_for_tail = entry.id.clone();
    let entry_for_tail = entry.clone();
    let handle = tail::start(entry_for_tail, move |info| {
        let _ = app_for_tail.emit(
            "lines-appended",
            LinesAppended {
                source_id: id_for_tail.clone(),
                added_lines: info.added_lines,
                total_lines: info.total_lines,
                total_bytes: info.total_bytes,
            },
        );
    })
    .map_err(|e| AppError::Other(format!("tail start: {e}")))?;
    *entry.tail.lock() = Some(handle);
    Ok(info)
}

fn guess_command_kind(cmdline: &str) -> SourceKind {
    let head = cmdline.split_whitespace().next().unwrap_or("");
    let bare = std::path::Path::new(head)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(head);
    match bare {
        "ssh" => SourceKind::Ssh,
        "kubectl" | "k" | "oc" => SourceKind::Kubectl,
        "journalctl" => SourceKind::Journalctl,
        _ => SourceKind::Stdin,
    }
}

#[tauri::command]
pub fn source_info(source_id: String, state: State<'_, AppState>) -> AppResult<SourceInfo> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let index = entry.index.read().clone();
    let live = entry.tail.lock().is_some();
    let kind = entry.kind;
    let label = entry.file.label.clone();
    let bytes = entry.file.bytes();
    let total_lines = index.line_count();
    let indexed = index.total_bytes;
    let path = if matches!(kind, SourceKind::File) {
        Some(canonicalize_path(&entry.file.path.display().to_string()))
    } else {
        None
    };
    Ok(SourceInfo {
        id: entry.id.clone(),
        label,
        kind,
        total_lines,
        bytes,
        indexed,
        live,
        path,
    })
}

fn build_raw_line(file: &FileSource, index: &crate::index::LineIndex, n: u64) -> Option<RawLine> {
    let bytes = file.raw_line(index, n)?;
    let raw = String::from_utf8_lossy(&bytes).into_owned();
    let p = parse::parse(&raw);
    Some(RawLine {
        line_number: n,
        raw,
        timestamp: p.timestamp,
        timestamp_str: p.timestamp_str,
        level: p.level,
        message: p.message,
    })
}

#[tauri::command]
pub fn get_lines(
    source_id: String,
    start: u64,
    count: u32,
    state: State<'_, AppState>,
) -> AppResult<Vec<RawLine>> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let index = entry.index.read().clone();
    let total = index.line_count();
    if start >= total {
        return Ok(vec![]);
    }
    let end = (start + count as u64).min(total);
    let mut out = Vec::with_capacity((end - start) as usize);
    for n in start..end {
        if let Some(line) = build_raw_line(&entry.file, &index, n) {
            out.push(line);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn apply_filter(
    source_id: String,
    query: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<FilterStatus> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let filter = Filter::parse(&query);
    let is_empty = filter.is_empty();
    let total = entry.index.read().line_count();
    let filter_id = state.next_filter_id();
    let session = FilterSession::new(filter_id, total);

    {
        let mut guard = entry.filter.lock();
        if let Some(prev) = guard.take() {
            prev.cancel.store(true, Ordering::Release);
        }
        *guard = Some(session.clone());
    }

    let status = FilterStatus {
        filter_id,
        scanned: 0,
        total,
        matches: if is_empty { total } else { 0 },
        done: is_empty,
        is_empty_filter: is_empty,
    };

    if !is_empty {
        let entry_for_task = entry.clone();
        let session_for_task = session.clone();
        let app_for_task = app.clone();
        let id_for_task = source_id.clone();
        std::thread::spawn(move || {
            let mut last_emit = std::time::Instant::now();
            search::run_scan(entry_for_task, session_for_task.clone(), filter, |p| {
                let force = p.done;
                if force || last_emit.elapsed().as_millis() >= 60 {
                    let _ = app_for_task.emit(
                        "filter-progress",
                        FilterProgress {
                            source_id: id_for_task.clone(),
                            filter_id: session_for_task.id,
                            scanned: p.scanned,
                            total: p.total,
                            matches: p.matches,
                            done: p.done,
                        },
                    );
                    last_emit = std::time::Instant::now();
                }
            });
        });
    } else {
        session.done.store(true, Ordering::Release);
        let _ = app.emit(
            "filter-progress",
            FilterProgress {
                source_id,
                filter_id,
                scanned: total,
                total,
                matches: total,
                done: true,
            },
        );
    }

    Ok(status)
}

#[tauri::command]
pub fn get_filtered_lines(
    source_id: String,
    filter_id: u64,
    start: u64,
    count: u32,
    state: State<'_, AppState>,
) -> AppResult<Vec<RawLine>> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let session_arc: Arc<FilterSession> = {
        let guard = entry.filter.lock();
        match guard.as_ref() {
            Some(s) if s.id == filter_id => s.clone(),
            _ => return Err(AppError::NotFound(format!("filter {filter_id}"))),
        }
    };
    let index = entry.index.read().clone();
    let matches = session_arc.matches.read();
    let total_matches = matches.len() as u64;
    if start >= total_matches {
        return Ok(vec![]);
    }
    let end = (start + count as u64).min(total_matches);
    let mut out = Vec::with_capacity((end - start) as usize);
    for off in start..end {
        let n = matches[off as usize];
        if let Some(line) = build_raw_line(&entry.file, &index, n) {
            out.push(line);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn close_source(source_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    if let Some(handle) = entry.tail.lock().take() {
        *handle.stop.lock() = true;
    }
    if let Some(prev) = entry.filter.lock().take() {
        prev.cancel.store(true, Ordering::Release);
    }
    if let Some(mut child) = entry.child_process.lock().take() {
        let _ = child.kill();
    }
    state.sources.remove(&source_id);
    Ok(())
}

#[tauri::command]
pub fn clear_filter(source_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let mut guard = entry.filter.lock();
    if let Some(prev) = guard.take() {
        prev.cancel.store(true, Ordering::Release);
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinesAppended {
    pub source_id: String,
    pub added_lines: u64,
    pub total_lines: u64,
    pub total_bytes: u64,
}

#[tauri::command]
pub fn start_tail(
    source_id: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<()> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    {
        let guard = entry.tail.lock();
        if guard.is_some() {
            return Ok(());
        }
    }
    let app_clone = app.clone();
    let id_clone = source_id.clone();
    let handle = tail::start(entry.clone(), move |info| {
        let _ = app_clone.emit(
            "lines-appended",
            LinesAppended {
                source_id: id_clone.clone(),
                added_lines: info.added_lines,
                total_lines: info.total_lines,
                total_bytes: info.total_bytes,
            },
        );
    })
    .map_err(|e| AppError::Other(format!("tail start: {e}")))?;
    *entry.tail.lock() = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn stop_tail(source_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    if let Some(handle) = entry.tail.lock().take() {
        *handle.stop.lock() = true;
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClusterProgress {
    pub source_id: String,
    pub scanned: u64,
    pub total: u64,
    pub pattern_count: u64,
    pub done: bool,
}

#[tauri::command]
pub fn cluster_source(
    source_id: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<()> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    if entry
        .cluster_in_progress
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(()); // already running
    }
    let entry_for_task = entry.clone();
    let app_for_task = app.clone();
    let id_for_task = source_id.clone();
    std::thread::spawn(move || {
        let index = entry_for_task.index.read().clone();
        let total = index.line_count();
        let mut tree = PatternTree::new();
        let mut last_emit = std::time::Instant::now();
        let report_every = (total / 100).max(8192);
        let mut last_report: u64 = 0;
        for n in 0..total {
            let Some(bytes) = entry_for_task.file.raw_line(&index, n) else {
                continue;
            };
            let raw = std::str::from_utf8(&bytes).unwrap_or("");
            let parsed = parse::parse(raw);
            // Prefer parsed.message when available (JSON), else raw
            let body = parsed.message.as_deref().unwrap_or(raw);
            tree.ingest(n, body, parsed.level);
            if n - last_report >= report_every && last_emit.elapsed().as_millis() >= 60 {
                let pattern_count = tree.pattern_count() as u64;
                let _ = app_for_task.emit(
                    "cluster-progress",
                    ClusterProgress {
                        source_id: id_for_task.clone(),
                        scanned: n + 1,
                        total,
                        pattern_count,
                        done: false,
                    },
                );
                last_emit = std::time::Instant::now();
                last_report = n;
            }
        }
        let views: Vec<PatternView> = tree.to_views();
        let pattern_count = views.len() as u64;
        *entry_for_task.patterns.write() = views;
        entry_for_task
            .cluster_in_progress
            .store(false, Ordering::Release);
        let _ = app_for_task.emit(
            "cluster-progress",
            ClusterProgress {
                source_id: id_for_task,
                scanned: total,
                total,
                pattern_count,
                done: true,
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub fn get_patterns(source_id: String, state: State<'_, AppState>) -> AppResult<Vec<PatternView>> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let views = entry.patterns.read().clone();
    Ok(views)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MergeProgress {
    pub id: u64,
    pub scanned: u64,
    pub total: u64,
    pub built: u64,
    pub done: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeLine {
    pub source_id: String,
    pub source_idx: u16,
    pub line_number: u64,
    pub timestamp: Option<i64>,
    pub timestamp_str: Option<String>,
    pub level: Option<Level>,
    pub raw: String,
    pub message: Option<String>,
}

#[tauri::command]
pub fn start_merge(
    source_ids: Vec<String>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<MergeStatus> {
    if source_ids.len() < 2 {
        return Err(AppError::InvalidRequest(
            "merge view needs at least 2 sources".into(),
        ));
    }
    let mut entries = Vec::with_capacity(source_ids.len());
    for id in &source_ids {
        let e = state
            .get(id)
            .ok_or_else(|| AppError::NotFound(id.clone()))?;
        entries.push(e);
    }

    let id = state.next_merge_id();
    let view = MergeView::new(id, source_ids.clone());

    {
        let mut g = state.merge.lock();
        if let Some(prev) = g.take() {
            prev.cancel.store(true, Ordering::Release);
        }
        *g = Some(view.clone());
    }

    let status = MergeStatus {
        id,
        sources: source_ids.clone(),
        built: 0,
        total_lines: 0,
        done: false,
    };

    let view_for_task = view.clone();
    let app_for_task = app.clone();
    std::thread::spawn(move || {
        let mut last_emit = std::time::Instant::now();
        merge::build(view_for_task.clone(), entries, |scanned, total| {
            if last_emit.elapsed().as_millis() >= 80 {
                let built = view_for_task.items.read().len() as u64;
                let _ = app_for_task.emit(
                    "merge-progress",
                    MergeProgress {
                        id: view_for_task.id,
                        scanned,
                        total,
                        built,
                        done: false,
                    },
                );
                last_emit = std::time::Instant::now();
            }
        });
        let built = view_for_task.items.read().len() as u64;
        let _ = app_for_task.emit(
            "merge-progress",
            MergeProgress {
                id: view_for_task.id,
                scanned: view_for_task.scanned.load(Ordering::Relaxed),
                total: view_for_task.total_lines.load(Ordering::Relaxed),
                built,
                done: true,
            },
        );
    });

    Ok(status)
}

#[tauri::command]
pub fn stop_merge(state: State<'_, AppState>) -> AppResult<()> {
    let mut g = state.merge.lock();
    if let Some(prev) = g.take() {
        prev.cancel.store(true, Ordering::Release);
    }
    Ok(())
}

#[tauri::command]
pub fn merge_status(state: State<'_, AppState>) -> AppResult<Option<MergeStatus>> {
    let g = state.merge.lock();
    let Some(view) = g.as_ref() else {
        return Ok(None);
    };
    let built = view.items.read().len() as u64;
    Ok(Some(MergeStatus {
        id: view.id,
        sources: view.sources.clone(),
        built,
        total_lines: view.total_lines.load(Ordering::Relaxed),
        done: view.done.load(Ordering::Acquire),
    }))
}

#[tauri::command]
pub fn get_merge_lines(
    start: u64,
    count: u32,
    state: State<'_, AppState>,
) -> AppResult<Vec<MergeLine>> {
    let view = {
        let g = state.merge.lock();
        g.as_ref().cloned()
    };
    let Some(view) = view else {
        return Err(AppError::InvalidRequest("no active merge view".into()));
    };
    let items = view.items.read();
    let total = items.len() as u64;
    if start >= total {
        return Ok(vec![]);
    }
    let end = (start + count as u64).min(total);
    let mut out = Vec::with_capacity((end - start) as usize);
    for off in start..end {
        let item = &items[off as usize];
        let src_id = match view.sources.get(item.source_idx as usize) {
            Some(s) => s.clone(),
            None => continue,
        };
        let Some(entry) = state.get(&src_id) else {
            continue;
        };
        let index = entry.index.read().clone();
        let Some(bytes) = entry.file.raw_line(&index, item.line_number) else {
            continue;
        };
        let raw = String::from_utf8_lossy(&bytes).into_owned();
        let p = parse::parse(&raw);
        out.push(MergeLine {
            source_id: src_id,
            source_idx: item.source_idx,
            line_number: item.line_number,
            timestamp: p.timestamp.or(Some(item.timestamp).filter(|t| *t != 0)),
            timestamp_str: p.timestamp_str,
            level: p.level,
            raw,
            message: p.message,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn ai_get_config(ai: State<'_, AiState>) -> AiConfigView {
    ai.view()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEntry {
    pub path: String,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub config_path: String,
    pub temp_dir: String,
    pub temp_files: Vec<StorageEntry>,
    pub temp_bytes: u64,
    pub source_count: usize,
    pub source_bytes: u64,
    pub source_lines: u64,
}

#[tauri::command]
pub fn storage_info(state: State<'_, AppState>) -> AppResult<StorageInfo> {
    let config_path = dirs::config_dir()
        .map(|mut p| {
            p.push("log-viewer");
            p.push("config.json");
            p
        })
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "(unknown)".into());

    let mut temp_dir_path = std::env::temp_dir();
    temp_dir_path.push("log-viewer");
    let temp_dir = temp_dir_path.display().to_string();

    let mut temp_files = Vec::new();
    let mut temp_bytes = 0u64;
    if let Ok(entries) = std::fs::read_dir(&temp_dir_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                temp_bytes += size;
                temp_files.push(StorageEntry {
                    path: path.display().to_string(),
                    size,
                });
            }
        }
    }
    temp_files.sort_by(|a, b| b.size.cmp(&a.size));

    let mut source_bytes = 0u64;
    let mut source_lines = 0u64;
    for entry in state.sources.iter() {
        let e = entry.value();
        source_bytes += e.file.bytes();
        source_lines += e.index.read().line_count();
    }

    Ok(StorageInfo {
        config_path,
        temp_dir,
        temp_files,
        temp_bytes,
        source_count: state.sources.len(),
        source_bytes,
        source_lines,
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Raw,
    Jsonl,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub lines_written: u64,
    pub bytes_written: u64,
}

/// Write the current view (filtered or unfiltered) to a file. Streams via a
/// BufWriter so even multi-GB exports stay flat on memory.
#[tauri::command]
pub fn export_slice(
    source_id: String,
    dest_path: String,
    format: ExportFormat,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    use std::io::{BufWriter, Write};
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let index = entry.index.read().clone();
    let session = entry.filter.lock().clone();

    let file = std::fs::File::create(&dest_path)?;
    let mut w = BufWriter::new(file);
    let mut lines_written: u64 = 0;
    let mut bytes_written: u64 = 0;

    let write_line = |w: &mut BufWriter<std::fs::File>,
                      n: u64,
                      bytes_written: &mut u64,
                      lines_written: &mut u64|
     -> AppResult<()> {
        let Some(bytes) = entry.file.raw_line(&index, n) else {
            return Ok(());
        };
        let raw = String::from_utf8_lossy(&bytes);
        match format {
            ExportFormat::Raw => {
                w.write_all(raw.as_bytes())?;
                w.write_all(b"\n")?;
                *bytes_written += bytes.len() as u64 + 1;
            }
            ExportFormat::Jsonl => {
                let p = parse::parse(&raw);
                let obj = serde_json::json!({
                    "line": n,
                    "raw": raw,
                    "timestamp": p.timestamp,
                    "timestampStr": p.timestamp_str,
                    "level": p.level,
                    "message": p.message,
                });
                let line = serde_json::to_string(&obj)
                    .map_err(|e| AppError::Other(format!("json: {e}")))?;
                w.write_all(line.as_bytes())?;
                w.write_all(b"\n")?;
                *bytes_written += line.len() as u64 + 1;
            }
        }
        *lines_written += 1;
        Ok(())
    };

    if let Some(s) = session.as_ref().filter(|s| !s.matches.read().is_empty()) {
        let matches = s.matches.read().clone();
        for n in matches.iter() {
            write_line(&mut w, *n, &mut bytes_written, &mut lines_written)?;
        }
    } else {
        let total = index.line_count();
        for n in 0..total {
            write_line(&mut w, n, &mut bytes_written, &mut lines_written)?;
        }
    }
    w.flush()?;
    Ok(ExportResult {
        lines_written,
        bytes_written,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirFileEvent {
    pub watch_path: String,
    pub file_path: String,
}

#[tauri::command]
pub fn start_dir_watch(
    path: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<()> {
    use notify::{EventKind, RecursiveMode, Watcher};
    use std::sync::atomic::{AtomicBool, Ordering as Ord};

    let watch_path = std::path::PathBuf::from(&path);
    if !watch_path.is_dir() {
        return Err(AppError::InvalidRequest(format!("not a directory: {path}")));
    }
    if state.dir_watches.contains_key(&path) {
        return Ok(());
    }
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .map_err(|e| AppError::Other(format!("watcher: {e}")))?;
    watcher
        .watch(&watch_path, RecursiveMode::NonRecursive)
        .map_err(|e| AppError::Other(format!("watch: {e}")))?;

    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();
    let app_clone = app.clone();
    let watch_path_str = path.clone();
    std::thread::spawn(move || loop {
        if stop_clone.load(Ord::Acquire) {
            return;
        }
        match rx.recv_timeout(std::time::Duration::from_millis(500)) {
            Ok(Ok(ev)) => {
                if matches!(ev.kind, EventKind::Create(_)) {
                    for p in ev.paths {
                        if p.is_file() {
                            let _ = app_clone.emit(
                                "dir-new-file",
                                DirFileEvent {
                                    watch_path: watch_path_str.clone(),
                                    file_path: p.display().to_string(),
                                },
                            );
                        }
                    }
                }
            }
            Ok(Err(_)) | Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => return,
        }
    });

    state
        .dir_watches
        .insert(path, crate::state::DirWatchHandle::new(stop, watcher));
    Ok(())
}

#[tauri::command]
pub fn stop_dir_watch(path: String, state: State<'_, AppState>) -> AppResult<()> {
    if let Some((_, handle)) = state.dir_watches.remove(&path) {
        handle
            .stop
            .store(true, std::sync::atomic::Ordering::Release);
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistogramProgress {
    pub source_id: String,
    pub scanned: u64,
    pub total: u64,
    pub done: bool,
    /// Final histogram payload — only present when done is true.
    pub histogram: Option<crate::histogram::Histogram>,
}

/// Kick off a histogram build on a background thread. Returns immediately;
/// the frontend listens for `histogram-progress` events. The final event has
/// `done=true` and includes the histogram payload. Cached results are sent
/// back synchronously as a one-shot done event so the caller can treat both
/// cached and freshly-built results identically.
#[tauri::command]
pub fn compute_histogram(
    source_id: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<()> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    // Fast path: cached result.
    if let Some(h) = entry.histogram.read().clone() {
        let _ = app.emit(
            "histogram-progress",
            HistogramProgress {
                source_id: source_id.clone(),
                scanned: h.total_lines,
                total: h.total_lines,
                done: true,
                histogram: Some((*h).clone()),
            },
        );
        return Ok(());
    }
    // De-dupe: avoid spawning a second compute for the same source.
    static IN_FLIGHT: once_cell::sync::Lazy<dashmap::DashSet<String>> =
        once_cell::sync::Lazy::new(dashmap::DashSet::new);
    if !IN_FLIGHT.insert(source_id.clone()) {
        return Ok(());
    }
    let entry_for_task = entry.clone();
    let app_for_task = app.clone();
    let id_for_task = source_id.clone();
    std::thread::spawn(move || {
        let _guard = ScopeGuard(Box::new(move || {
            IN_FLIGHT.remove(&id_for_task);
        }));
        let index = entry_for_task.index.read().clone();
        let mut last_emit = std::time::Instant::now();
        let app_inner = app_for_task.clone();
        let id_inner = entry_for_task.id.clone();
        let h = crate::histogram::build_with_progress(
            entry_for_task.file.clone(),
            index,
            |scanned, total| {
                if last_emit.elapsed().as_millis() >= 60 {
                    let _ = app_inner.emit(
                        "histogram-progress",
                        HistogramProgress {
                            source_id: id_inner.clone(),
                            scanned,
                            total,
                            done: false,
                            histogram: None,
                        },
                    );
                    last_emit = std::time::Instant::now();
                }
            },
        );
        if !h.buckets.is_empty() {
            *entry_for_task.histogram.write() = Some(Arc::new(h.clone()));
        }
        let _ = app_for_task.emit(
            "histogram-progress",
            HistogramProgress {
                source_id: entry_for_task.id.clone(),
                scanned: h.total_lines,
                total: h.total_lines,
                done: true,
                histogram: Some(h),
            },
        );
    });
    Ok(())
}

/// Tiny RAII guard so we always free the in-flight slot even if the worker
/// panics.
struct ScopeGuard(Box<dyn FnOnce() + Send>);
impl Drop for ScopeGuard {
    fn drop(&mut self) {
        let f = std::mem::replace(&mut self.0, Box::new(|| {}));
        f();
    }
}

#[tauri::command]
pub fn list_dir_watches(state: State<'_, AppState>) -> Vec<String> {
    state.dir_watches.iter().map(|e| e.key().clone()).collect()
}

#[tauri::command]
pub fn load_workspace(
    workspace: State<'_, crate::persistence::WorkspaceStore>,
) -> crate::persistence::WorkspaceState {
    workspace.snapshot()
}

#[tauri::command]
pub fn save_source_state(
    path: String,
    state: crate::persistence::SourceState,
    workspace: State<'_, crate::persistence::WorkspaceStore>,
) -> AppResult<()> {
    workspace.upsert_source(path, state)
}

#[tauri::command]
pub fn save_last_session(
    paths: Vec<String>,
    active: Option<String>,
    workspace: State<'_, crate::persistence::WorkspaceStore>,
) -> AppResult<()> {
    workspace.set_last_session(paths, active)
}

#[tauri::command]
pub fn clear_temp_files() -> AppResult<u32> {
    let mut temp_dir = std::env::temp_dir();
    temp_dir.push("log-viewer");
    let mut deleted = 0u32;
    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && std::fs::remove_file(&p).is_ok() {
                deleted += 1;
            }
        }
    }
    Ok(deleted)
}

#[tauri::command]
pub fn ai_set_provider_settings(
    provider: String,
    settings: ProviderSettingsUpdate,
    ai: State<'_, AiState>,
) -> AppResult<()> {
    ai.set_provider_settings(&provider, settings)
}

#[tauri::command]
pub fn ai_set_active_provider(provider: String, ai: State<'_, AiState>) -> AppResult<()> {
    ai.set_active(&provider)
}

/// Cap `s` at `max` bytes without splitting a UTF-8 character.
fn truncate_at_char_boundary(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

fn sample_lines(entry: &Arc<crate::state::SourceEntry>, max: usize) -> Vec<String> {
    let index = entry.index.read().clone();
    let total = index.line_count();
    if total == 0 {
        return vec![];
    }
    let stride = ((total as usize) / max.max(1)).max(1);
    let mut out = Vec::with_capacity(max);
    let mut n: u64 = 0;
    while (out.len() < max) && n < total {
        if let Some(bytes) = entry.file.raw_line(&index, n) {
            let s = String::from_utf8_lossy(&bytes).into_owned();
            let trimmed = if s.len() > 240 {
                format!("{}…", truncate_at_char_boundary(&s, 240))
            } else {
                s
            };
            out.push(trimmed);
        }
        n += stride as u64;
    }
    out
}

#[tauri::command]
pub async fn ai_nl_filter(
    source_id: String,
    prompt: String,
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
) -> AppResult<String> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let samples = sample_lines(&entry, 20);
    let user = format!(
        "Sample log lines from the source (sparsely sampled):\n\n{}\n\nRequest: {}",
        samples.join("\n"),
        prompt.trim()
    );
    let cfg = ai.snapshot();
    let text = ai::call_chat(
        &cfg,
        Speed::Fast,
        prompts::NL_FILTER_SYSTEM,
        &user,
        300,
        0.0,
    )
    .await?;
    Ok(text.trim().to_string())
}

#[tauri::command]
pub async fn ai_explain_line(
    source_id: String,
    line_number: u64,
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
) -> AppResult<String> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let index = entry.index.read().clone();
    let total = index.line_count();
    let lo = line_number.saturating_sub(5);
    let hi = (line_number + 6).min(total);
    let mut buf = String::new();
    for n in lo..hi {
        if let Some(bytes) = entry.file.raw_line(&index, n) {
            let line = String::from_utf8_lossy(&bytes);
            if n == line_number {
                buf.push_str(&format!(">>> {line} <<<\n"));
            } else {
                buf.push_str(&line);
                buf.push('\n');
            }
        }
    }
    let user = format!("Surrounding context (chronological):\n{buf}");
    let cfg = ai.snapshot();
    ai::call_chat(
        &cfg,
        Speed::Smart,
        prompts::EXPLAIN_LINE_SYSTEM,
        &user,
        400,
        0.2,
    )
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonFieldStat {
    pub name: String,
    pub samples: Vec<String>,
    pub occurrences: u64,
}

/// Scan up to `max_lines` of the source. For each line that looks like JSON,
/// record top-level keys + a few distinct sample values. Returns the fields
/// ranked by occurrence count, descending.
#[tauri::command]
pub fn discover_fields(
    source_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<JsonFieldStat>> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let index = entry.index.read().clone();
    let total = index.line_count();
    let max_lines: u64 = 1000;
    let stride = (total / max_lines).max(1);
    let mut fields: std::collections::HashMap<String, (u64, std::collections::HashSet<String>)> =
        std::collections::HashMap::new();
    let mut n: u64 = 0;
    let mut scanned: u64 = 0;
    while scanned < max_lines && n < total {
        if let Some(bytes) = entry.file.raw_line(&index, n) {
            let raw = std::str::from_utf8(&bytes).unwrap_or("");
            let trimmed = raw.trim_start();
            if trimmed.starts_with('{') {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    if let Some(obj) = v.as_object() {
                        for (k, val) in obj.iter() {
                            let entry = fields.entry(k.clone()).or_default();
                            entry.0 += 1;
                            if entry.1.len() < 6 {
                                let s = match val {
                                    serde_json::Value::String(s) => {
                                        s.chars().take(60).collect::<String>()
                                    }
                                    serde_json::Value::Number(n) => n.to_string(),
                                    serde_json::Value::Bool(b) => b.to_string(),
                                    serde_json::Value::Null => "null".to_string(),
                                    _ => "{…}".to_string(),
                                };
                                entry.1.insert(s);
                            }
                        }
                    }
                }
            }
        }
        scanned += 1;
        n += stride;
    }
    let mut out: Vec<JsonFieldStat> = fields
        .into_iter()
        .map(|(name, (occurrences, samples))| JsonFieldStat {
            name,
            occurrences,
            samples: samples.into_iter().collect(),
        })
        .collect();
    out.sort_by(|a, b| b.occurrences.cmp(&a.occurrences));
    Ok(out)
}

/// Explain a contiguous selection of lines. The user usually picks 1–N rows
/// in the viewer (multi-select via shift-click or auto-grouped multi-line
/// messages) and asks the model to summarize what they mean. We include a
/// small chronological window of context around the selection so the model
/// sees what came right before / after.
#[tauri::command]
pub async fn ai_explain_lines(
    source_id: String,
    line_numbers: Vec<u64>,
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
) -> AppResult<String> {
    if line_numbers.is_empty() {
        return Err(AppError::InvalidRequest("no lines selected".into()));
    }
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let index = entry.index.read().clone();
    let total = index.line_count();
    let mut sel: Vec<u64> = line_numbers.into_iter().filter(|n| *n < total).collect();
    sel.sort_unstable();
    sel.dedup();
    if sel.is_empty() {
        return Err(AppError::InvalidRequest("selection out of range".into()));
    }
    let min = *sel.first().unwrap();
    let max = *sel.last().unwrap();
    let lo = min.saturating_sub(3);
    let hi = (max + 4).min(total);
    let selected: std::collections::HashSet<u64> = sel.iter().copied().collect();
    let mut buf = String::new();
    for n in lo..hi {
        if let Some(bytes) = entry.file.raw_line(&index, n) {
            let line = String::from_utf8_lossy(&bytes);
            if selected.contains(&n) {
                buf.push_str(&format!(">>> {line} <<<\n"));
            } else {
                buf.push_str(&line);
                buf.push('\n');
            }
        }
    }
    let user = format!(
        "User-selected lines (marked with >>>), shown with a small chronological context window:\n\n{buf}"
    );
    let cfg = ai.snapshot();
    ai::call_chat(
        &cfg,
        Speed::Smart,
        prompts::EXPLAIN_LINE_SYSTEM,
        &user,
        600,
        0.2,
    )
    .await
}

/// Root-cause analysis: take a wider context (100 lines before, 20 after) and
/// ask the model to identify the chain of events leading to the target.
#[tauri::command]
pub async fn ai_root_cause(
    source_id: String,
    line_number: u64,
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
) -> AppResult<String> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let index = entry.index.read().clone();
    let total = index.line_count();
    let lo = line_number.saturating_sub(100);
    let hi = (line_number + 21).min(total);
    let mut buf = String::new();
    for n in lo..hi {
        if let Some(bytes) = entry.file.raw_line(&index, n) {
            let line = String::from_utf8_lossy(&bytes);
            if n == line_number {
                buf.push_str(">>> ");
                buf.push_str(&line);
                buf.push_str(" <<<\n");
            } else {
                buf.push_str(&line);
                buf.push('\n');
            }
        }
    }
    let user = format!("Surrounding events (chronological; target marked with >>>):\n\n{buf}");
    let cfg = ai.snapshot();
    ai::call_chat(
        &cfg,
        Speed::Smart,
        prompts::ROOT_CAUSE_SYSTEM,
        &user,
        800,
        0.2,
    )
    .await
}

/// Root-cause analysis across a multi-line selection. We bracket the chosen
/// rows with a wider context window (100 lines before the earliest selected
/// row, 20 after the latest) so the model has enough chronology to trace the
/// chain of events.
#[tauri::command]
pub async fn ai_root_cause_lines(
    source_id: String,
    line_numbers: Vec<u64>,
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
) -> AppResult<String> {
    if line_numbers.is_empty() {
        return Err(AppError::InvalidRequest("no lines selected".into()));
    }
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let index = entry.index.read().clone();
    let total = index.line_count();
    let mut sel: Vec<u64> = line_numbers.into_iter().filter(|n| *n < total).collect();
    sel.sort_unstable();
    sel.dedup();
    if sel.is_empty() {
        return Err(AppError::InvalidRequest("selection out of range".into()));
    }
    let min = *sel.first().unwrap();
    let max = *sel.last().unwrap();
    let lo = min.saturating_sub(100);
    let hi = (max + 21).min(total);
    let selected: std::collections::HashSet<u64> = sel.iter().copied().collect();
    let mut buf = String::new();
    for n in lo..hi {
        if let Some(bytes) = entry.file.raw_line(&index, n) {
            let line = String::from_utf8_lossy(&bytes);
            if selected.contains(&n) {
                buf.push_str(">>> ");
                buf.push_str(&line);
                buf.push_str(" <<<\n");
            } else {
                buf.push_str(&line);
                buf.push('\n');
            }
        }
    }
    let user = format!(
        "Surrounding events (chronological; selected target lines marked with >>>):\n\n{buf}"
    );
    let cfg = ai.snapshot();
    ai::call_chat(
        &cfg,
        Speed::Smart,
        prompts::ROOT_CAUSE_SYSTEM,
        &user,
        1000,
        0.2,
    )
    .await
}

/// Given several example lines, ask the model to produce a regex that
/// matches the same shape. Useful for going from selection → filter without
/// writing the regex by hand.
#[tauri::command]
pub async fn ai_regex_from_examples(
    examples: Vec<String>,
    ai: State<'_, AiState>,
) -> AppResult<String> {
    if examples.is_empty() {
        return Err(AppError::InvalidRequest("no examples provided".into()));
    }
    let user = format!(
        "Generate a single regular expression that matches lines in the same family as these examples. Use \\S+ / \\d+ for token-shaped variables. Output ONLY the regex, no slashes, no explanation.\n\nExamples:\n{}",
        examples
            .iter()
            .take(8)
            .map(|s| {
                let trimmed = if s.len() > 240 {
                    format!("{}…", truncate_at_char_boundary(s, 240))
                } else {
                    s.clone()
                };
                format!("- {trimmed}")
            })
            .collect::<Vec<_>>()
            .join("\n")
    );
    let cfg = ai.snapshot();
    let raw = ai::call_chat(
        &cfg,
        Speed::Fast,
        "You translate a set of example log lines into a single PCRE regex that matches their shape. Use \\S+ or \\d+ for variable tokens; literal text for shared words. Output only the regex.",
        &user,
        300,
        0.0,
    )
    .await?;
    // Strip any wrapping slashes or backticks the model may have included.
    let cleaned = raw.trim().trim_matches('`').trim_matches('/').to_string();
    Ok(cleaned)
}

#[tauri::command]
pub async fn ai_summarize_patterns(
    source_id: String,
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
) -> AppResult<String> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let views = entry.patterns.read().clone();
    if views.is_empty() {
        return Err(AppError::InvalidRequest(
            "no patterns yet — open the Patterns tab to compute them first".into(),
        ));
    }
    let mut lines = String::new();
    for v in views.iter().take(50) {
        let lvl = v
            .level
            .map(|l| format!("{l:?}"))
            .unwrap_or_else(|| "-".into());
        lines.push_str(&format!("{} — {} — {}\n", v.template, v.count, lvl));
    }
    let user = format!("Pattern table:\n{lines}");
    let cfg = ai.snapshot();
    ai::call_chat(&cfg, Speed::Smart, prompts::ANOMALY_SYSTEM, &user, 600, 0.3).await
}

// ---------- Chat: seed + dispatcher ----------
//
// The static one-shot AI commands above (`ai_explain_line`, `ai_root_cause`, …)
// are kept for backward compatibility, but the interactive UX prefers the
// seed → chat flow:
//   1. Frontend asks the backend for a `ChatSeed` — system prompt + the first
//      user message, both built from source/context state on the Rust side.
//   2. Frontend stores the conversation locally and calls `ai_chat` for each
//      turn (the initial seed turn plus any follow-ups), threading the full
//      history back so the model can answer in context.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatSeed {
    pub system: String,
    pub user: String,
    pub speed: Speed,
    pub max_tokens: u32,
    pub temperature: f32,
}

/// Build the seed for "Explain this line / these lines" using a small window
/// of surrounding chronological context. If `line_numbers` has a single
/// entry we use the tighter 5-before / 5-after window (matches the original
/// one-shot prompt); for multi-line selections we use 3-before / 3-after
/// around the min/max selected indices.
#[tauri::command]
pub fn ai_seed_explain(
    source_id: String,
    line_numbers: Vec<u64>,
    state: State<'_, AppState>,
) -> AppResult<ChatSeed> {
    if line_numbers.is_empty() {
        return Err(AppError::InvalidRequest("no lines selected".into()));
    }
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let index = entry.index.read().clone();
    let total = index.line_count();
    let mut sel: Vec<u64> = line_numbers.into_iter().filter(|n| *n < total).collect();
    sel.sort_unstable();
    sel.dedup();
    if sel.is_empty() {
        return Err(AppError::InvalidRequest("selection out of range".into()));
    }
    let min = *sel.first().unwrap();
    let max = *sel.last().unwrap();
    let pad: u64 = if sel.len() == 1 { 5 } else { 3 };
    let lo = min.saturating_sub(pad);
    let hi = (max + pad + 1).min(total);
    let selected: std::collections::HashSet<u64> = sel.iter().copied().collect();
    let mut buf = String::new();
    for n in lo..hi {
        if let Some(bytes) = entry.file.raw_line(&index, n) {
            let line = String::from_utf8_lossy(&bytes);
            if selected.contains(&n) {
                buf.push_str(&format!(">>> {line} <<<\n"));
            } else {
                buf.push_str(&line);
                buf.push('\n');
            }
        }
    }
    let label = if sel.len() == 1 { "line" } else { "lines" };
    let user = format!(
        "Target {label} marked with >>>, shown with chronological context:\n\n{buf}\n\nExplain what the target means in this context."
    );
    Ok(ChatSeed {
        system: prompts::EXPLAIN_LINE_SYSTEM.into(),
        user,
        speed: Speed::Smart,
        max_tokens: if sel.len() == 1 { 500 } else { 700 },
        temperature: 0.2,
    })
}

/// Build the seed for root-cause analysis. Uses a much wider context window
/// (100 lines before / 20 after) so the model can trace causation.
#[tauri::command]
pub fn ai_seed_root_cause(
    source_id: String,
    line_numbers: Vec<u64>,
    state: State<'_, AppState>,
) -> AppResult<ChatSeed> {
    if line_numbers.is_empty() {
        return Err(AppError::InvalidRequest("no lines selected".into()));
    }
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let index = entry.index.read().clone();
    let total = index.line_count();
    let mut sel: Vec<u64> = line_numbers.into_iter().filter(|n| *n < total).collect();
    sel.sort_unstable();
    sel.dedup();
    if sel.is_empty() {
        return Err(AppError::InvalidRequest("selection out of range".into()));
    }
    let min = *sel.first().unwrap();
    let max = *sel.last().unwrap();
    let lo = min.saturating_sub(100);
    let hi = (max + 21).min(total);
    let selected: std::collections::HashSet<u64> = sel.iter().copied().collect();
    let mut buf = String::new();
    for n in lo..hi {
        if let Some(bytes) = entry.file.raw_line(&index, n) {
            let line = String::from_utf8_lossy(&bytes);
            if selected.contains(&n) {
                buf.push_str(">>> ");
                buf.push_str(&line);
                buf.push_str(" <<<\n");
            } else {
                buf.push_str(&line);
                buf.push('\n');
            }
        }
    }
    let user = format!(
        "Surrounding events (chronological; target lines marked with >>>):\n\n{buf}\n\nTrace the chain of events leading to the target."
    );
    Ok(ChatSeed {
        system: prompts::ROOT_CAUSE_SYSTEM.into(),
        user,
        speed: Speed::Smart,
        max_tokens: 1000,
        temperature: 0.2,
    })
}

/// Build the seed for "Summarize anomalies" across the current pattern table.
#[tauri::command]
pub fn ai_seed_summarize_patterns(
    source_id: String,
    state: State<'_, AppState>,
) -> AppResult<ChatSeed> {
    let entry = state
        .get(&source_id)
        .ok_or_else(|| AppError::NotFound(source_id.clone()))?;
    let views = entry.patterns.read().clone();
    if views.is_empty() {
        return Err(AppError::InvalidRequest(
            "no patterns yet — open the Patterns tab to compute them first".into(),
        ));
    }
    let mut lines = String::new();
    for v in views.iter().take(50) {
        let lvl = v
            .level
            .map(|l| format!("{l:?}"))
            .unwrap_or_else(|| "-".into());
        lines.push_str(&format!("{} — {} — {}\n", v.template, v.count, lvl));
    }
    let user = format!("Pattern table:\n{lines}");
    Ok(ChatSeed {
        system: prompts::ANOMALY_SYSTEM.into(),
        user,
        speed: Speed::Smart,
        max_tokens: 800,
        temperature: 0.3,
    })
}

/// Generic chat dispatcher used by the frontend for both the seed turn and
/// subsequent follow-ups. The full conversation is replayed each call so the
/// model always has the original log context in view (prompt-caching on the
/// system block keeps repeat calls cheap).
#[tauri::command]
pub async fn ai_chat(
    system: String,
    messages: Vec<ChatMessage>,
    speed: Speed,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    ai: State<'_, AiState>,
) -> AppResult<String> {
    if messages.is_empty() {
        return Err(AppError::InvalidRequest("messages cannot be empty".into()));
    }
    let cfg = ai.snapshot();
    ai::call_chat_multi(
        &cfg,
        speed,
        &system,
        &messages,
        max_tokens.unwrap_or(800),
        temperature.unwrap_or(0.2),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::truncate_at_char_boundary;

    #[test]
    fn truncate_respects_char_boundaries() {
        assert_eq!(truncate_at_char_boundary("short", 240), "short");
        assert_eq!(truncate_at_char_boundary("abcdef", 3), "abc");
        // 'é' is 2 bytes; a cut at byte 2 would land inside it.
        assert_eq!(truncate_at_char_boundary("aéz", 2), "a");
        // 239 ASCII bytes followed by a 3-byte char straddling byte 240.
        let s = format!("{}€tail", "x".repeat(239));
        assert_eq!(truncate_at_char_boundary(&s, 240).len(), 239);
    }
}
