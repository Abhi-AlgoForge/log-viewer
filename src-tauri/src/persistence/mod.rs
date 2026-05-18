//! Workspace persistence — bookmarks, per-source filter memory, last-session
//! file list. One JSON file under `<config>/log-viewer/workspace.json`.
//!
//! Sources are keyed by absolute file path. Command sources are ephemeral
//! (their key would be the temp file path, which changes every run) and are
//! never persisted.

use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkSer {
    pub line: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceState {
    #[serde(default)]
    pub bookmarks: Vec<BookmarkSer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    /// Keyed by absolute source path.
    #[serde(default)]
    pub sources: HashMap<String, SourceState>,
    /// Ordered list of file paths to restore on next launch.
    #[serde(default)]
    pub last_session: Vec<String>,
    /// Active source's path from the last session (so the restore picks the
    /// right one).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_active: Option<String>,
}

#[derive(Default)]
pub struct WorkspaceStore {
    pub state: Mutex<WorkspaceState>,
}

impl WorkspaceStore {
    pub fn load() -> Self {
        let state = read_workspace().unwrap_or_default();
        Self { state: Mutex::new(state) }
    }

    pub fn snapshot(&self) -> WorkspaceState {
        self.state.lock().clone()
    }

    pub fn upsert_source(&self, path: String, source_state: SourceState) -> AppResult<()> {
        {
            let mut g = self.state.lock();
            g.sources.insert(path, source_state);
        }
        write_workspace(&self.state.lock())
    }

    pub fn set_last_session(
        &self,
        paths: Vec<String>,
        active: Option<String>,
    ) -> AppResult<()> {
        {
            let mut g = self.state.lock();
            g.last_session = paths;
            g.last_active = active;
        }
        write_workspace(&self.state.lock())
    }
}

fn workspace_path() -> AppResult<PathBuf> {
    let mut p = dirs::config_dir().ok_or_else(|| AppError::Other("no config dir".into()))?;
    p.push("log-viewer");
    std::fs::create_dir_all(&p)?;
    p.push("workspace.json");
    Ok(p)
}

fn read_workspace() -> AppResult<WorkspaceState> {
    let p = workspace_path()?;
    if !p.exists() {
        return Ok(WorkspaceState::default());
    }
    let s = std::fs::read_to_string(&p)?;
    Ok(serde_json::from_str(&s).unwrap_or_default())
}

fn write_workspace(ws: &WorkspaceState) -> AppResult<()> {
    let p = workspace_path()?;
    let s = serde_json::to_string_pretty(ws)
        .map_err(|e| AppError::Other(format!("serialize workspace: {e}")))?;
    std::fs::write(&p, s)?;
    Ok(())
}
