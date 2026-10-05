//! Local file source. Memory-mapped read with a sparse line-offset index.
//!
//! The mmap is held behind a RwLock<Arc<Mmap>> so the live-tail watcher can
//! re-map the file when it grows. Line-fetch APIs clone the requested bytes
//! out so callers never have to worry about the mapping moving under them.

use crate::error::AppResult;
use crate::index::LineIndex;
use memmap2::Mmap;
use parking_lot::RwLock;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub struct FileSource {
    #[allow(dead_code)] // surfaced in source listings (phase 3 multi-source)
    pub path: PathBuf,
    pub label: String,
    bytes: AtomicU64,
    mmap: RwLock<Arc<Mmap>>,
}

impl FileSource {
    pub fn open(path: impl AsRef<Path>) -> AppResult<Self> {
        let path = path.as_ref().to_path_buf();
        // If the file is compressed (.gz / .zst / .bz2), decompress into a
        // temp file under the OS temp dir and open that as the source. The
        // original filename is kept as the label so the user sees what they
        // opened, not the temp path.
        let (open_path, label) = maybe_decompress(&path)?;
        let file = File::open(&open_path)?;
        let bytes = file.metadata()?.len();
        let mmap = make_mmap(&file)?;
        Ok(Self {
            path: open_path,
            label,
            bytes: AtomicU64::new(bytes),
            mmap: RwLock::new(Arc::new(mmap)),
        })
    }

    pub fn bytes(&self) -> u64 {
        self.bytes.load(Ordering::Acquire)
    }

    pub fn snapshot(&self) -> Arc<Mmap> {
        self.mmap.read().clone()
    }

    /// Re-stat the file. If it has grown, re-map it and return the previous
    /// size so the caller can index just the new bytes. Returns `None` if the
    /// file did not grow (or shrank — log rotation; not handled in v0.1).
    pub fn refresh(&self) -> AppResult<Option<u64>> {
        let file = File::open(&self.path)?;
        let new_bytes = file.metadata()?.len();
        let old_bytes = self.bytes();
        if new_bytes <= old_bytes {
            return Ok(None);
        }
        let new_mmap = make_mmap(&file)?;
        *self.mmap.write() = Arc::new(new_mmap);
        self.bytes.store(new_bytes, Ordering::Release);
        Ok(Some(old_bytes))
    }

    /// Build the full line index from current contents. Yields progress to a
    /// callback every `chunk_bytes` bytes so the UI can show indexing %.
    pub fn build_index(&self, chunk_bytes: usize, mut progress: impl FnMut(u64, u64)) -> LineIndex {
        let snap = self.snapshot();
        let data: &[u8] = &snap;
        let total = data.len() as u64;
        let mut index = LineIndex::new();
        let mut pos: usize = 0;
        while pos < data.len() {
            let end = (pos + chunk_bytes).min(data.len());
            index.extend_from_slice(pos as u64, &data[pos..end]);
            pos = end;
            progress(pos as u64, total);
        }
        if data.is_empty() {
            index.total_bytes = 0;
        }
        index
    }

    /// Extend `index` with the bytes added since `prev_bytes`. Used by the
    /// live tailer.
    pub fn extend_index(&self, index: &mut LineIndex, prev_bytes: u64) {
        let snap = self.snapshot();
        let data: &[u8] = &snap;
        let total = data.len() as u64;
        if prev_bytes >= total {
            return;
        }
        let start = prev_bytes as usize;
        index.extend_from_slice(prev_bytes, &data[start..]);
    }

    pub fn raw_line(&self, index: &LineIndex, line_no: u64) -> Option<Vec<u8>> {
        let (start, end) = index.line_range(line_no)?;
        let mut s = start as usize;
        let mut e = end as usize;
        let snap = self.snapshot();
        if e > s && snap.get(e - 1) == Some(&b'\n') {
            e -= 1;
            if e > s && snap.get(e - 1) == Some(&b'\r') {
                e -= 1;
            }
        }
        // Strip the UTF-8 BOM from the first line. Windows logs (CBS, setup,
        // wevtutil exports) commonly start with EF BB BF, which would
        // otherwise break our timestamp/level regexes on line 0.
        if line_no == 0 && e >= s + 3 && snap.get(s..s + 3) == Some(b"\xef\xbb\xbf") {
            s += 3;
        }
        snap.get(s..e).map(|b| b.to_vec())
    }
}

fn make_mmap(file: &File) -> AppResult<Mmap> {
    let len = file.metadata()?.len();
    if len == 0 {
        // memmap on a zero-length file errors on some platforms; return a
        // dummy mapping over an empty temp file.
        let tmp = tempfile_one_byte()?;
        let m = unsafe { Mmap::map(&tmp)? };
        // Truncate the slice view by tracking len separately — the index has
        // total_bytes=0 so callers won't read it.
        return Ok(m);
    }
    Ok(unsafe { Mmap::map(file)? })
}

fn tempfile_one_byte() -> AppResult<File> {
    use std::io::Write;
    let mut p = std::env::temp_dir();
    p.push("log-viewer-empty.bin");
    let mut f = File::create(&p)?;
    f.write_all(&[0])?;
    Ok(File::open(&p)?)
}

/// If `path` has a known compression extension, stream-decompress it into a
/// temp file and return that path plus a human-friendly label derived from
/// the original name. Otherwise the path is returned unchanged.
fn maybe_decompress(path: &Path) -> AppResult<(PathBuf, String)> {
    let label = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("(unnamed)")
        .to_string();
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    let kind = match ext.as_deref() {
        Some("gz") => CompressionKind::Gzip,
        Some("zst") | Some("zstd") => CompressionKind::Zstd,
        Some("bz2") => CompressionKind::Bzip2,
        _ => return Ok((path.to_path_buf(), label)),
    };

    use std::io::{BufReader, BufWriter, Read};
    let src = File::open(path)?;
    let reader: Box<dyn Read> = match kind {
        CompressionKind::Gzip => Box::new(flate2::read::GzDecoder::new(BufReader::new(src))),
        CompressionKind::Zstd => Box::new(
            zstd::stream::read::Decoder::new(BufReader::new(src))
                .map_err(|e| crate::error::AppError::Other(format!("zstd: {e}")))?,
        ),
        CompressionKind::Bzip2 => Box::new(bzip2::read::BzDecoder::new(BufReader::new(src))),
    };

    let mut dir = std::env::temp_dir();
    dir.push("log-viewer");
    std::fs::create_dir_all(&dir)?;
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("decompressed");
    let pid = std::process::id();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut dest = dir;
    dest.push(format!("{pid}-{stamp}-{stem}"));
    let mut writer = BufWriter::new(File::create(&dest)?);
    std::io::copy(&mut BufReader::new(reader), &mut writer)?;
    drop(writer);
    Ok((dest, label))
}

enum CompressionKind {
    Gzip,
    Zstd,
    Bzip2,
}
