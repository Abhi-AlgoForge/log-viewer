//! Multi-source timeline merge.
//!
//! A `MergeView` is a snapshot — given a set of source ids, we walk each
//! source's line index once, parse the timestamp on each line, and produce a
//! sorted `Vec<MergeItem>` that the viewer virtualizes over. Lines without
//! detectable timestamps inherit the previous line's timestamp from the same
//! source so a JSON line followed by a continuation line stays grouped.
//!
//! Memory: 20 bytes per merged line. 1M lines ≈ 20 MB. For larger sets we
//! could chunk + page on disk; out of scope for v0.1.

use crate::parse;
use crate::state::SourceEntry;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct MergeItem {
    pub source_idx: u16,
    pub line_number: u64,
    pub timestamp: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MergeStatus {
    pub id: u64,
    pub sources: Vec<String>,
    pub built: u64,
    pub total_lines: u64,
    pub done: bool,
}

pub struct MergeView {
    pub id: u64,
    pub sources: Vec<String>,
    pub items: parking_lot::RwLock<Vec<MergeItem>>,
    pub scanned: AtomicU64,
    pub total_lines: AtomicU64,
    pub done: AtomicBool,
    pub cancel: AtomicBool,
}

impl MergeView {
    pub fn new(id: u64, sources: Vec<String>) -> Arc<Self> {
        Arc::new(Self {
            id,
            sources,
            items: parking_lot::RwLock::new(Vec::new()),
            scanned: AtomicU64::new(0),
            total_lines: AtomicU64::new(0),
            done: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
        })
    }
}

pub fn build(view: Arc<MergeView>, entries: Vec<Arc<SourceEntry>>, mut report: impl FnMut(u64, u64)) {
    let mut total: u64 = 0;
    for e in &entries {
        total = total.saturating_add(e.index.read().line_count());
    }
    view.total_lines.store(total, Ordering::Relaxed);

    // Per-source running timestamps so untimestamped lines inherit recent
    // timestamps from their own stream.
    let mut last_ts: Vec<i64> = vec![0; entries.len()];
    let mut all: Vec<MergeItem> = Vec::with_capacity(total as usize);
    let mut scanned: u64 = 0;
    let report_every: u64 = (total / 100).max(8192);
    let mut last_report: u64 = 0;
    let mut emitted_any_ts = false;

    for (idx, entry) in entries.iter().enumerate() {
        let index = entry.index.read().clone();
        let lines = index.line_count();
        for n in 0..lines {
            if view.cancel.load(Ordering::Relaxed) {
                return;
            }
            scanned += 1;
            let Some(bytes) = entry.file.raw_line(&index, n) else { continue };
            let raw = std::str::from_utf8(&bytes).unwrap_or("");
            let p = parse::parse(raw);
            let ts = if let Some(t) = p.timestamp {
                emitted_any_ts = true;
                last_ts[idx] = t;
                t
            } else {
                last_ts[idx]
            };
            all.push(MergeItem {
                source_idx: idx as u16,
                line_number: n,
                timestamp: ts,
            });
            if scanned - last_report >= report_every {
                view.scanned.store(scanned, Ordering::Relaxed);
                report(scanned, total);
                last_report = scanned;
            }
        }
    }

    // Sort by timestamp, breaking ties by (source_idx, line_number) so the
    // order within a source is preserved for equal timestamps.
    all.sort_by(|a, b| {
        a.timestamp
            .cmp(&b.timestamp)
            .then_with(|| a.source_idx.cmp(&b.source_idx))
            .then_with(|| a.line_number.cmp(&b.line_number))
    });

    // If no source had any timestamps, the order is meaningless — fall back to
    // just concatenating each source's lines in input order.
    if !emitted_any_ts {
        all.sort_by(|a, b| {
            a.source_idx
                .cmp(&b.source_idx)
                .then_with(|| a.line_number.cmp(&b.line_number))
        });
    }

    *view.items.write() = all;
    view.scanned.store(scanned, Ordering::Relaxed);
    view.done.store(true, Ordering::Release);
    report(scanned, total);
}
