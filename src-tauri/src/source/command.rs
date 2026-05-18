//! Command source: spawn an external program and stream its stdout into a
//! local file. Once written, the file is opened through the normal file
//! source pipeline so all of indexing, filtering, clustering, and live tail
//! Just Work — the regular file watcher picks up appended bytes as the
//! subprocess writes.
//!
//! This is how we expose SSH (`ssh user@host tail -f /var/log/app.log`),
//! kubectl (`kubectl logs -f pod -n ns`), and journalctl
//! (`journalctl -f -o json`) without a bespoke source per protocol.

use crate::error::{AppError, AppResult};
use std::fs::{create_dir_all, File};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct CommandSource {
    pub path: PathBuf,
    pub child: Child,
}

pub fn spawn(label: &str, cmdline: &str) -> AppResult<CommandSource> {
    let args = shell_words::split(cmdline)
        .map_err(|e| AppError::InvalidRequest(format!("parse command: {e}")))?;
    if args.is_empty() {
        return Err(AppError::InvalidRequest("empty command".into()));
    }

    let mut dir: PathBuf = std::env::temp_dir();
    dir.push("log-viewer");
    create_dir_all(&dir)?;
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let safe_label = label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();
    let mut path = dir;
    path.push(format!("{pid}-{id}-{safe_label}.log"));

    // Pre-create the file so the watcher and open_file pick it up immediately.
    File::create(&path)?;

    let mut child = Command::new(&args[0])
        .args(&args[1..])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| AppError::Other(format!("spawn `{}`: {e}", args[0])))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("no stdout pipe".into()))?;
    let stderr = child.stderr.take();
    let path_for_writer = path.clone();
    std::thread::spawn(move || {
        let mut file = match std::fs::OpenOptions::new().append(true).open(&path_for_writer) {
            Ok(f) => f,
            Err(_) => return,
        };
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if writeln!(file, "{line}").is_err() {
                break;
            }
        }
    });
    // Forward stderr lines into the same file, prefixed so they're visible.
    if let Some(stderr) = stderr {
        let path_for_err = path.clone();
        std::thread::spawn(move || {
            let mut file = match std::fs::OpenOptions::new().append(true).open(&path_for_err) {
                Ok(f) => f,
                Err(_) => return,
            };
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = writeln!(file, "[stderr] {line}");
            }
        });
    }

    Ok(CommandSource { path, child })
}
