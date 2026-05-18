//! Sparse line index.
//!
//! For each line we store a single u64 byte offset (the start of the line).
//! Newline scan uses memchr's SIMD-accelerated routines, so indexing a 1 GB
//! plain-text file is bounded by disk IO, not CPU.
//!
//! Memory cost: ~8 bytes per line. 10M lines = 80 MB — acceptable for v0.1.
//! Future: switch to delta-encoded blocks if files routinely exceed 100M lines.

use memchr::memchr_iter;

#[derive(Debug, Default, Clone)]
pub struct LineIndex {
    pub offsets: Vec<u64>,
    pub total_bytes: u64,
}

impl LineIndex {
    pub fn new() -> Self {
        Self { offsets: vec![0], total_bytes: 0 }
    }

    /// Clone for use as a base when appending new bytes (live tail).
    /// Equivalent to `.clone()` but named for the call site's intent.
    pub fn clone_for_extend(&self) -> Self {
        self.clone()
    }

    /// Scan a byte slice starting at `base_offset` and append the resulting
    /// line-start offsets. The very first line of the source must already be
    /// represented by an initial `0` entry (see `new`).
    pub fn extend_from_slice(&mut self, base_offset: u64, bytes: &[u8]) {
        for pos in memchr_iter(b'\n', bytes) {
            let next_start = base_offset + pos as u64 + 1;
            self.offsets.push(next_start);
        }
        self.total_bytes = base_offset + bytes.len() as u64;
    }

    /// Number of complete lines. A trailing line without a newline still counts
    /// as a line (its end is `total_bytes`).
    pub fn line_count(&self) -> u64 {
        let last_start = *self.offsets.last().unwrap_or(&0);
        if self.total_bytes > last_start {
            self.offsets.len() as u64
        } else {
            self.offsets.len().saturating_sub(1) as u64
        }
    }

    /// Returns (start, end_exclusive) byte range for `line_no` (0-based).
    pub fn line_range(&self, line_no: u64) -> Option<(u64, u64)> {
        let idx = line_no as usize;
        let start = *self.offsets.get(idx)?;
        let end = self
            .offsets
            .get(idx + 1)
            .copied()
            .unwrap_or(self.total_bytes);
        if end < start {
            return None;
        }
        Some((start, end))
    }
}
