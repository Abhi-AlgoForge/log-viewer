import { Show, createEffect, on, onMount, onCleanup } from "solid-js";
import { applyAppearanceVars } from "./services/theme";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { Viewer } from "./components/Viewer";
import { StatusBar } from "./components/StatusBar";
import { DetailsPanel } from "./components/DetailsPanel";
import { SettingsView } from "./components/SettingsView";
import { DiffView } from "./components/DiffView";
import { Toasts } from "./components/Toasts";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { VerticalHistogram } from "./components/Histogram";
import { KeybindingsHelp } from "./components/KeybindingsHelp";
import { Tour } from "./components/Tour";
import {
  sessionStore,
  addSource,
  updateSourceProgress,
  updateFilterProgress,
  toggleBookmark,
  onLinesAppendedFor,
  updateClusterProgress,
  updateMergeProgress,
  updateHistogramProgress,
  triggerAction,
  setSession,
  setFollowing,
  isFollowing,
  toggleLogOrder,
  clearFilterFor,
  MERGE_VIEW_ID,
} from "./state/session";
import { formatKey, findAction, defaultBindings, hasModifier, normalize } from "./services/keybindings";
import {
  api,
  onIndexProgress,
  onFilterProgress,
  onLinesAppended,
  onClusterProgress,
  onMergeProgress,
  onHistogramProgress,
} from "./services/api";
import { openPath } from "./services/openFile";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { initWorkspace, scheduleSaveLastSession, scheduleSaveSourceState } from "./services/persistence";
import "./App.css";

export default function App() {
  let unlistenIdx: (() => void) | undefined;
  let unlistenFlt: (() => void) | undefined;
  let unlistenAppend: (() => void) | undefined;
  let unlistenCluster: (() => void) | undefined;
  let unlistenMerge: (() => void) | undefined;
  let unlistenHist: (() => void) | undefined;
  let unlistenDrop: (() => void) | undefined;
  let unlistenCli: (() => void) | undefined;
  let unlistenDirFile: (() => void) | undefined;

  function handleKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const inField = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
    const combo = formatKey(e);
    if (!combo) return;
    // Resolve effective bindings — defaults overlaid with user customizations.
    // Normalize entries from localStorage too, just in case.
    const userBindings: Record<string, string> = {};
    for (const [id, c] of Object.entries(sessionStore.keybindings)) {
      userBindings[id] = normalize(c);
    }
    const bindings = { ...defaultBindings(), ...userBindings };
    const action = findAction(bindings, combo);
    if (!action) return;

    // Inside a text field: only let modifier shortcuts and explicit clear
    // fire. Bare letter keys go to the input.
    if (inField && action !== "clearFilter" && !hasModifier(combo)) return;

    if (dispatchAction(action)) {
      e.preventDefault();
    }
  }

  function dispatchAction(actionId: string): boolean {
    const sid = sessionStore.activeSourceId;
    switch (actionId) {
      case "bookmark":
        if (sid && sessionStore.selectedLine != null) {
          toggleBookmark(sid, sessionStore.selectedLine);
        }
        return true;
      case "toggleDetails":
        setSession("detailsOpen", (v) => !v);
        return true;
      case "toggleFollow":
        if (sid) {
          const next = !isFollowing(sid);
          setFollowing(sid, next);
          if (next) {
            void api.startTail(sid).catch(() => {});
          } else {
            void api.stopTail(sid).catch(() => {});
          }
        }
        return true;
      case "toggleOrder":
        toggleLogOrder();
        return true;
      case "openSettings":
        setSession("view", sessionStore.view === "settings" ? "logs" : "settings");
        return true;
      case "clearFilter": {
        if (sessionStore.filterQuery !== "") {
          setSession("filterQuery", "");
          if (sid) {
            void api.clearFilter(sid).catch(() => {});
            clearFilterFor(sid);
          }
        }
        return true;
      }
      // The remaining actions need DOM access in another component — fire a
      // counter and let the owner subscribe.
      case "focusFilter":
      case "openFile":
      case "openCommand":
      case "askAi":
        triggerAction(actionId);
        return true;
      case "help":
        setSession("helpOpen", !sessionStore.helpOpen);
        return true;
    }
    return false;
  }

  onMount(async () => {
    // Load persisted workspace first so subsequent source opens can hydrate.
    const ws = await initWorkspace();

    unlistenIdx = await onIndexProgress((p) => {
      updateSourceProgress(p.sourceId, p.indexed, p.lineCount);
    });
    unlistenFlt = await onFilterProgress((p) => {
      updateFilterProgress(p.sourceId, p.filterId, p.scanned, p.total, p.matches, p.done);
    });
    unlistenAppend = await onLinesAppended((p) => {
      onLinesAppendedFor(p.sourceId, p.totalLines, p.totalBytes);
    });
    unlistenCluster = await onClusterProgress((p) => {
      updateClusterProgress(p.sourceId, p.scanned, p.total, p.patternCount, p.done);
    });
    unlistenMerge = await onMergeProgress((p) => {
      updateMergeProgress(p.id, p.total, p.built, p.done);
    });
    unlistenHist = await onHistogramProgress((p) => {
      updateHistogramProgress(p.sourceId, p.scanned, p.total, p.done, p.histogram);
    });
    try {
      const win = getCurrentWindow();
      unlistenDrop = await win.onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        const paths = (event.payload as { paths: string[] }).paths ?? [];
        for (const path of paths) {
          await openPath(path);
        }
      });
    } catch (e) {
      console.warn("drag-drop registration failed", e);
    }
    unlistenCli = await listen<string[]>("cli-open", async (e) => {
      for (const path of e.payload ?? []) {
        await openPath(path);
      }
    });
    unlistenDirFile = await listen<{ watchPath: string; filePath: string }>(
      "dir-new-file",
      async (e) => {
        if (e.payload?.filePath) await openPath(e.payload.filePath);
      },
    );
    window.addEventListener("keydown", handleKey);

    // Restore last session sources sequentially. Skips paths that no longer
    // exist (Rust open_file will toast the error and continue).
    if (ws.lastSession.length > 0) {
      for (const p of ws.lastSession) {
        await openPath(p);
      }
      if (ws.lastActive) {
        const match = sessionStore.sources.find((s) => s.path === ws.lastActive);
        if (match) setSession("activeSourceId", match.id);
      }
    }
  });

  // Push theme/level colors into CSS variables whenever appearance changes.
  createEffect(() => {
    applyAppearanceVars(sessionStore.appearance);
  });

  // Persist last-session paths whenever the open set or active source
  // changes. The save is debounced inside the service.
  createEffect(() => {
    void sessionStore.sources.length;
    void sessionStore.activeSourceId;
    scheduleSaveLastSession();
  });

  // Persist per-source bookmarks + filter when they change.
  createEffect(() => {
    for (const s of sessionStore.sources) {
      if (!s.path) continue;
      const bookmarks = sessionStore.bookmarks[s.id] ?? [];
      const filter = sessionStore.filters[s.id];
      scheduleSaveSourceState(s.path, {
        bookmarks: bookmarks.map((b) => ({
          line: b.line,
          ...(b.note ? { note: b.note } : {}),
        })),
        lastFilter:
          filter && !filter.isEmptyFilter ? filter.query : null,
      });
    }
  });

  // Refresh the active source whenever it changes — closes the race where the
  // backend's "indexing done" event fires before the frontend has added the
  // source to its store (tiny files where indexing completes in microseconds).
  // Skip for the merge pseudo-source. Fire-and-forget so a slow IPC call
  // can't block view navigation.
  createEffect(
    on(
      () => sessionStore.activeSourceId,
      (sid) => {
        if (!sid || sid === MERGE_VIEW_ID) return;
        void (async () => {
          try {
            const fresh = await api.sourceInfo(sid);
            addSource(fresh);
          } catch (e) {
            console.warn("refresh source info failed", e);
          }
        })();
      },
    ),
  );
  onCleanup(() => {
    unlistenIdx?.();
    unlistenFlt?.();
    unlistenAppend?.();
    unlistenCluster?.();
    unlistenMerge?.();
    unlistenHist?.();
    unlistenDrop?.();
    unlistenCli?.();
    unlistenDirFile?.();
    window.removeEventListener("keydown", handleKey);
  });

  return (
    <div class="flex h-full w-full flex-col bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      <Toolbar />
      <Show when={sessionStore.view === "logs"}>
        <div class="flex min-h-0 flex-1">
          <Sidebar />
          <main class="flex min-w-0 flex-1">
            <Viewer />
            <Show
              when={
                sessionStore.appearance.showHistogram &&
                sessionStore.activeSourceId &&
                sessionStore.activeSourceId !== "merge:active"
              }
            >
              <VerticalHistogram sourceId={sessionStore.activeSourceId!} />
            </Show>
            <Show when={sessionStore.detailsOpen}>
              <DetailsPanel />
            </Show>
          </main>
        </div>
      </Show>
      <Show when={sessionStore.view === "settings"}>
        <SettingsView />
      </Show>
      <Show when={sessionStore.view === "diff"}>
        <DiffView />
      </Show>
      <StatusBar />
      <Toasts />
      <LoadingOverlay />
      <Show when={sessionStore.helpOpen}>
        <KeybindingsHelp />
      </Show>
      <Tour />
    </div>
  );
}
