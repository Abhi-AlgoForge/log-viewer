//! Per-source time histogram. Bucket counts by log level so the UI can render
//! a stacked sparkline for "log volume over time".

use crate::index::LineIndex;
use crate::parse::{self, Level};
use crate::source::file::FileSource;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistogramBucket {
    pub start_ms: i64,
    pub total: u64,
    /// Per-level counts. Keys are the same case the Level enum serializes to
    /// (`"info"`, `"warn"`, …).
    pub by_level: HashMap<String, u64>,
    /// First line number that landed in this bucket — used for click-to-seek.
    pub first_line: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Histogram {
    pub bucket_ms: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub buckets: Vec<HistogramBucket>,
    pub no_timestamp: u64,
    pub total_lines: u64,
    /// True when we sampled every Nth line instead of walking the whole file.
    /// Counts are scaled up by `stride` so the shape matches a full scan.
    pub sampled: bool,
    pub stride: u64,
}

const TARGET_BUCKETS: usize = 200;
/// Above this line count we switch to sampling — walking every Nth line and
/// multiplying counts to compensate. Keeps histogram build bounded.
const SAMPLE_THRESHOLD: u64 = 500_000;

pub fn build_with_progress(
    file: Arc<FileSource>,
    index: Arc<LineIndex>,
    mut on_progress: impl FnMut(u64, u64),
) -> Histogram {
    // Decide stride: 1 for small files (full scan), larger for big files
    // (sampling). Stride of `S` means we visit every Sth line and multiply
    // counts by S so the shape stays faithful.
    let total_lines = index.line_count();
    let stride: u64 = if total_lines > SAMPLE_THRESHOLD {
        (total_lines / SAMPLE_THRESHOLD).max(1)
    } else {
        1
    };
    let sampled = stride > 1;
    let total = index.line_count();
    if total == 0 {
        return Histogram {
            bucket_ms: 0,
            start_ms: 0,
            end_ms: 0,
            buckets: vec![],
            no_timestamp: 0,
            total_lines: 0,
            sampled: false,
            stride: 1,
        };
    }
    // Pass 1: find timestamp range. Progress reported as "first 50%" so the
    // bar moves through both passes smoothly.
    let mut min_ts: Option<i64> = None;
    let mut max_ts: Option<i64> = None;
    let mut with_ts: u64 = 0;
    let mut no_ts: u64 = 0;
    // Number of lines actually visited per pass (after applying stride).
    let visit_total = total.div_ceil(stride);
    let pass_total = visit_total.saturating_mul(2);
    let report_every = (visit_total / 100).max(2048);
    let mut visited: u64 = 0;
    let mut last_report: u64 = 0;
    let mut n: u64 = 0;
    while n < total {
        if let Some(bytes) = file.raw_line(&index, n) {
            let raw = std::str::from_utf8(&bytes).unwrap_or("");
            let p = parse::parse(raw);
            match p.timestamp {
                Some(t) => {
                    min_ts = Some(min_ts.map(|m| m.min(t)).unwrap_or(t));
                    max_ts = Some(max_ts.map(|m| m.max(t)).unwrap_or(t));
                    with_ts += 1;
                }
                None => no_ts += 1,
            }
        }
        visited += 1;
        n = n.saturating_add(stride);
        if visited - last_report >= report_every {
            on_progress(visited, pass_total);
            last_report = visited;
        }
    }
    let (start_ms, end_ms) = match (min_ts, max_ts) {
        (Some(a), Some(b)) if b >= a => (a, b),
        _ => {
            return Histogram {
                bucket_ms: 0,
                start_ms: 0,
                end_ms: 0,
                buckets: vec![],
                no_timestamp: no_ts,
                total_lines: total,
                sampled,
                stride,
            }
        }
    };
    let span = (end_ms - start_ms).max(1);
    let bucket_ms = (span / TARGET_BUCKETS as i64).max(1);
    let num_buckets = ((span / bucket_ms) as usize + 1).max(1);
    let mut buckets: Vec<HistogramBucket> = (0..num_buckets)
        .map(|i| HistogramBucket {
            start_ms: start_ms + (i as i64) * bucket_ms,
            total: 0,
            by_level: HashMap::new(),
            first_line: u64::MAX,
        })
        .collect();
    let _ = with_ts;
    // Pass 2: bucket. Counts are scaled by `stride` so the shape matches a
    // full scan even when sampling.
    let mut visited2: u64 = 0;
    let mut last_report2: u64 = 0;
    let mut n: u64 = 0;
    while n < total {
        if let Some(bytes) = file.raw_line(&index, n) {
            let raw = std::str::from_utf8(&bytes).unwrap_or("");
            let p = parse::parse(raw);
            if let Some(t) = p.timestamp {
                let mut idx = ((t - start_ms) / bucket_ms) as usize;
                if idx >= buckets.len() {
                    idx = buckets.len() - 1;
                }
                let b = &mut buckets[idx];
                b.total = b.total.saturating_add(stride);
                if b.first_line == u64::MAX {
                    b.first_line = n;
                }
                let key = match p.level {
                    Some(Level::Trace) => "trace",
                    Some(Level::Debug) => "debug",
                    Some(Level::Info) => "info",
                    Some(Level::Warn) => "warn",
                    Some(Level::Error) => "error",
                    Some(Level::Fatal) => "fatal",
                    None => "unknown",
                };
                *b.by_level.entry(key.to_string()).or_insert(0) += stride;
            }
        }
        visited2 += 1;
        n = n.saturating_add(stride);
        if visited2 - last_report2 >= report_every {
            on_progress(visit_total + visited2, pass_total);
            last_report2 = visited2;
        }
    }
    // Replace sentinel first_line with 0 for empty buckets so the UI can sort
    // them visually without dealing with u64::MAX.
    for b in buckets.iter_mut() {
        if b.first_line == u64::MAX {
            b.first_line = 0;
        }
    }
    Histogram {
        bucket_ms,
        start_ms,
        end_ms,
        buckets,
        no_timestamp: no_ts,
        total_lines: total,
        sampled,
        stride,
    }
}
