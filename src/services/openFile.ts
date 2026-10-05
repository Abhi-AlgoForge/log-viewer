import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import {
  addSource,
  setActiveSource,
  setFollowing,
  pushToast,
  pushRecentFile,
  setSession,
} from "../state/session";
import { getPersistedSourceState } from "./persistence";
import { applyFilterToActive } from "./filter";

export async function pickAndOpenFile() {
  let picked: string | null = null;
  try {
    const result = await openDialog({
      multiple: false,
      title: "Open file",
      filters: [
        {
          name: "Logs and documents",
          extensions: ["log", "txt", "out", "err", "ndjson", "jsonl", "json", "md", "markdown"],
        },
        { name: "Compressed logs", extensions: ["gz", "zst", "zstd", "bz2"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!result || typeof result !== "string") return;
    picked = result;
  } catch (e) {
    pushToast("error", "Couldn't open the file picker", String(e));
    return;
  }

  await openPath(picked);
}

/// Open a specific file path without going through the dialog. Used by
/// drag-drop, the recent-files list, and the CLI launcher.
export async function openPath(path: string) {
  let info;
  try {
    info = await api.openFile(path);
  } catch (e) {
    pushToast("error", `Couldn't open ${shortName(path)}`, String(e));
    return;
  }
  pushRecentFile(path);
  addSource(info);
  setActiveSource(info.id);
  setFollowing(info.id, true);

  // Hydrate persisted state for this source (bookmarks + last filter).
  if (info.path) {
    const persisted = getPersistedSourceState(info.path);
    if (persisted) {
      if (persisted.bookmarks.length > 0) {
        setSession(
          "bookmarks",
          info.id,
          persisted.bookmarks.map((b) => ({
            line: b.line,
            ...(b.note ? { note: b.note } : {}),
          })),
        );
      }
      if (persisted.lastFilter) {
        setSession("filterQuery", persisted.lastFilter);
        // applyFilterToActive runs against the current activeSourceId, which
        // we just set above. Fire-and-forget so open isn't blocked.
        void applyFilterToActive(persisted.lastFilter);
      }
    }
  }
  try {
    await api.startTail(info.id);
  } catch (e) {
    pushToast("info", "Live tail unavailable", String(e));
  }
  try {
    const fresh = await api.sourceInfo(info.id);
    addSource(fresh);
  } catch (e) {
    console.warn("source info refresh failed", e);
  }
}

function shortName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
