import { api, type WorkspaceStateDTO, type SourceStateDTO } from "./api";
import { sessionStore } from "../state/session";

/// One-shot workspace snapshot loaded at app start. Cached so the source open
/// path can hydrate bookmarks + last filter synchronously.
let cached: WorkspaceStateDTO | null = null;

export async function initWorkspace(): Promise<WorkspaceStateDTO> {
  try {
    cached = await api.loadWorkspace();
  } catch (e) {
    console.warn("loadWorkspace failed", e);
    cached = { sources: {}, lastSession: [] };
  }
  return cached;
}

export function getPersistedSourceState(path: string): SourceStateDTO | null {
  if (!cached) return null;
  return cached.sources[path] ?? null;
}

/// Mark our in-memory cache so a subsequent restore reflects the latest
/// changes without re-fetching from disk.
function recordSourceLocally(path: string, state: SourceStateDTO) {
  if (!cached) cached = { sources: {}, lastSession: [] };
  cached.sources[path] = state;
}

const SAVE_DEBOUNCE_MS = 400;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/// Debounced save of a single source's state. Multiple rapid edits coalesce
/// into one disk write.
export function scheduleSaveSourceState(path: string, state: SourceStateDTO) {
  recordSourceLocally(path, state);
  const prev = pendingTimers.get(path);
  if (prev !== undefined) clearTimeout(prev);
  const t = setTimeout(() => {
    pendingTimers.delete(path);
    void api.saveSourceState(path, state).catch((e) =>
      console.warn("saveSourceState failed", e),
    );
  }, SAVE_DEBOUNCE_MS);
  pendingTimers.set(path, t);
}

let sessionSaveTimer: ReturnType<typeof setTimeout> | undefined;

export function scheduleSaveLastSession() {
  if (sessionSaveTimer !== undefined) clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = undefined;
    const paths = sessionStore.sources
      .map((s) => s.path)
      .filter((p): p is string => !!p);
    const active = sessionStore.sources.find(
      (s) => s.id === sessionStore.activeSourceId,
    )?.path ?? null;
    if (cached) {
      cached.lastSession = paths;
      cached.lastActive = active;
    }
    void api.saveLastSession(paths, active).catch((e) =>
      console.warn("saveLastSession failed", e),
    );
  }, SAVE_DEBOUNCE_MS);
}

export function workspaceSnapshot(): WorkspaceStateDTO | null {
  return cached;
}
