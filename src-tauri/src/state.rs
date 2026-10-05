//! Application state — sources and their indexes, keyed by source id.

use crate::cluster::PatternView;
use crate::index::LineIndex;
use crate::merge::MergeView;
use crate::search::FilterSession;
use crate::source::file::FileSource;
use crate::source::SourceKind;
use crate::tail::TailHandle;
use dashmap::DashMap;
use parking_lot::{Mutex, RwLock};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Default)]
pub struct AppState {
    pub sources: DashMap<String, Arc<SourceEntry>>,
    pub merge: Mutex<Option<Arc<MergeView>>>,
    pub dir_watches: DashMap<String, DirWatchHandle>,
    next_id: AtomicU64,
    next_filter_id: AtomicU64,
    next_merge_id: AtomicU64,
}

pub struct DirWatchHandle {
    pub stop: Arc<std::sync::atomic::AtomicBool>,
    _watcher: notify::RecommendedWatcher,
}

impl DirWatchHandle {
    pub fn new(
        stop: Arc<std::sync::atomic::AtomicBool>,
        watcher: notify::RecommendedWatcher,
    ) -> Self {
        Self {
            stop,
            _watcher: watcher,
        }
    }
}

pub struct SourceEntry {
    pub id: String,
    pub file: Arc<FileSource>,
    pub index: RwLock<Arc<LineIndex>>,
    pub indexing_done: Mutex<bool>,
    pub filter: Mutex<Option<Arc<FilterSession>>>,
    pub tail: Mutex<Option<TailHandle>>,
    pub patterns: RwLock<Vec<PatternView>>,
    pub cluster_in_progress: AtomicBool,
    pub child_process: Mutex<Option<std::process::Child>>,
    pub kind: SourceKind,
    pub histogram: RwLock<Option<Arc<crate::histogram::Histogram>>>,
}

impl AppState {
    pub fn next_id(&self) -> String {
        let n = self.next_id.fetch_add(1, Ordering::Relaxed);
        format!("src-{n}")
    }

    pub fn next_filter_id(&self) -> u64 {
        self.next_filter_id.fetch_add(1, Ordering::Relaxed)
    }

    pub fn next_merge_id(&self) -> u64 {
        self.next_merge_id.fetch_add(1, Ordering::Relaxed)
    }

    pub fn insert_file(&self, file: Arc<FileSource>) -> Arc<SourceEntry> {
        self.insert_with(file, SourceKind::File, None)
    }

    pub fn insert_with(
        &self,
        file: Arc<FileSource>,
        kind: SourceKind,
        child: Option<std::process::Child>,
    ) -> Arc<SourceEntry> {
        let id = self.next_id();
        let entry = Arc::new(SourceEntry {
            id: id.clone(),
            file,
            index: RwLock::new(Arc::new(LineIndex::new())),
            indexing_done: Mutex::new(false),
            filter: Mutex::new(None),
            tail: Mutex::new(None),
            patterns: RwLock::new(Vec::new()),
            cluster_in_progress: AtomicBool::new(false),
            child_process: Mutex::new(child),
            kind,
            histogram: RwLock::new(None),
        });
        self.sources.insert(id, entry.clone());
        entry
    }

    pub fn get(&self, id: &str) -> Option<Arc<SourceEntry>> {
        self.sources.get(id).map(|e| Arc::clone(&*e))
    }
}
