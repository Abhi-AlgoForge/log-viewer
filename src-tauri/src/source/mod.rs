//! Log source abstractions.
//!
//! A `Source` produces a stream of bytes that get parsed into log lines.
//! Implementations: file, stdin, ssh, kubectl, journalctl, cloudwatch, gcp.
//! Phase 1 only implements `file`.

pub mod command;
pub mod file;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    File,
    Stdin,
    Ssh,
    Kubectl,
    Journalctl,
    Cloudwatch,
    Gcp,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub id: String,
    pub label: String,
    pub kind: SourceKind,
    pub total_lines: u64,
    pub bytes: u64,
    pub indexed: u64,
    pub live: bool,
    /// Absolute path on disk for file sources. None for command/stdin
    /// sources (their temp file path isn't useful externally). Used by the
    /// workspace store as the key for bookmarks + filter memory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}
