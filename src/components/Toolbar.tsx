import { Show, createEffect, createSignal, on } from "solid-js";
import {
  sessionStore,
  setSession,
  isFollowing,
  setFollowing,
  toggleLogOrder,
  pushToast,
} from "../state/session";
import { onActionTrigger } from "../services/actions";
import { pickAndOpenFile } from "../services/openFile";
import { api } from "../services/api";
import { applyFilterToActive } from "../services/filter";
import { OpenCommandPanel } from "./OpenCommandPanel";
import { AskAiPanel } from "./AskAiPanel";
import { Icon } from "./Icon";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { SavedViewsMenu } from "./SavedViewsMenu";

const DEBOUNCE_MS = 180;

export function Toolbar() {
  const [pending, setPending] = createSignal(false);
  const [openCmd, setOpenCmd] = createSignal(false);
  const [openAsk, setOpenAsk] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let filterInputEl!: HTMLInputElement;

  onActionTrigger("focusFilter", () => filterInputEl?.focus());
  onActionTrigger("openFile", () => handleOpen());
  onActionTrigger("openCommand", () => setOpenCmd(true));
  onActionTrigger("askAi", () => {
    if (sessionStore.activeSourceId) setOpenAsk(true);
  });

  async function handleOpen() {
    try {
      await pickAndOpenFile();
    } catch (e) {
      console.error("open failed", e);
    }
  }

  function scheduleApply(query: string) {
    setPending(true);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(async () => {
      await applyFilterToActive(query);
      setPending(false);
    }, DEBOUNCE_MS);
  }

  createEffect(
    on(
      () => sessionStore.activeSourceId,
      () => {
        const q = sessionStore.filterQuery;
        if (q && sessionStore.activeSourceId) applyFilterToActive(q);
      },
    ),
  );

  async function watchDirectory() {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (!picked || typeof picked !== "string") return;
      await api.startDirWatch(picked);
      pushToast(
        "success",
        "Watching directory",
        `New files in ${picked} will open automatically.`,
      );
    } catch (e) {
      pushToast("error", "Couldn't watch directory", String(e));
    }
  }

  async function exportSlice() {
    const sid = sessionStore.activeSourceId;
    if (!sid) return;
    try {
      const dest = await saveDialog({
        title: "Export current view",
        defaultPath: "log-slice.log",
        filters: [
          { name: "Plain text", extensions: ["log", "txt"] },
          { name: "JSON lines", extensions: ["jsonl"] },
        ],
      });
      if (!dest) return;
      const format = dest.toLowerCase().endsWith(".jsonl") ? "jsonl" : "raw";
      const result = await api.exportSlice(sid, dest, format);
      pushToast("success", `Exported ${result.linesWritten.toLocaleString()} lines`, dest);
    } catch (e) {
      pushToast("error", "Export failed", String(e));
    }
  }

  async function toggleFollow() {
    const sid = sessionStore.activeSourceId;
    if (!sid) return;
    const next = !isFollowing(sid);
    setFollowing(sid, next);
    try {
      if (next) await api.startTail(sid);
      else await api.stopTail(sid);
    } catch (e) {
      console.error("tail toggle failed", e);
    }
  }

  return (
    <div class="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] px-4">
      {/* Source actions */}
      <div class="flex items-center gap-1.5">
        <button class="btn-base" onClick={handleOpen} data-tour="open-file">
          <span class="text-base leading-none">📂</span>
          <span>Open file</span>
        </button>
        <button
          class="btn-base"
          onClick={() => setOpenCmd(true)}
          title="Stream stdout from ssh / kubectl / journalctl / any command"
          data-tour="open-command"
        >
          <span class="text-base leading-none">⌘</span>
          <span>Command</span>
        </button>
        <Show when={openCmd()}>
          <OpenCommandPanel onClose={() => setOpenCmd(false)} />
        </Show>
        <button
          class="btn-base"
          title="Watch a folder and auto-open new files as they appear"
          onClick={watchDirectory}
          data-tour="watch-dir"
        >
          <span class="text-base leading-none">📁</span>
          <span>Watch dir</span>
        </button>
      </div>

      <div class="mx-2 h-7 w-px bg-[var(--color-border-soft)]" />

      {/* Filter — primary affordance, takes the bulk of the width */}
      <div class="relative flex flex-1 items-center" data-tour="filter">
        <span class="pointer-events-none absolute left-3 text-[var(--color-text-faint)]">⌕</span>
        <input
          ref={filterInputEl}
          class="h-10 w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] pl-9 pr-20 font-mono text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)] focus:bg-[var(--color-bg-base)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)]"
          placeholder="Filter   level:error   since:5m   /regex/   substring"
          value={sessionStore.filterQuery}
          onInput={(e) => {
            const v = e.currentTarget.value;
            setSession("filterQuery", v);
            scheduleApply(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSession("filterQuery", "");
              scheduleApply("");
              e.currentTarget.blur();
            } else if (e.key === "Enter") {
              if (timer !== undefined) clearTimeout(timer);
              applyFilterToActive(sessionStore.filterQuery);
            }
          }}
        />
        <Show when={pending()}>
          <span class="absolute right-3 text-xs text-[var(--color-text-faint)]">…</span>
        </Show>
      </div>

      <span data-tour="saved-views">
        <SavedViewsMenu
          current={sessionStore.filterQuery}
          disabled={!sessionStore.activeSourceId}
        />
      </span>
      <button
        class="btn-base"
        title="Translate natural language into a filter"
        onClick={() => setOpenAsk(true)}
        disabled={!sessionStore.activeSourceId}
        data-tour="ask-ai"
      >
        <span>✨</span>
        <span>Ask</span>
      </button>
      <Show when={openAsk()}>
        <AskAiPanel onClose={() => setOpenAsk(false)} />
      </Show>

      <div class="mx-2 h-7 w-px bg-[var(--color-border-soft)]" />

      {/* View toggles */}
      <div class="flex items-center gap-1.5">
        <button
          class="btn-base"
          title={
            sessionStore.logOrder === "desc"
              ? "Newest first — click for oldest first"
              : "Oldest first — click for newest first"
          }
          onClick={toggleLogOrder}
          data-tour="order"
        >
          <Icon name={sessionStore.logOrder === "desc" ? "arrow-up" : "arrow-down"} size={14} />
          <span>{sessionStore.logOrder === "desc" ? "Newest" : "Oldest"}</span>
        </button>
        <button
          class="btn-base"
          classList={{
            "btn-primary":
              !!sessionStore.activeSourceId && isFollowing(sessionStore.activeSourceId),
          }}
          onClick={toggleFollow}
          title="Follow tail — auto-scroll to new lines"
          disabled={!sessionStore.activeSourceId}
          data-tour="follow"
        >
          <span
            class="inline-block h-2 w-2 rounded-full"
            classList={{
              "bg-white":
                !!sessionStore.activeSourceId && isFollowing(sessionStore.activeSourceId),
              "bg-[var(--color-text-faint)]":
                !sessionStore.activeSourceId || !isFollowing(sessionStore.activeSourceId),
            }}
          />
          <span>Follow</span>
        </button>
        <button
          class="btn-base"
          title="Export current view to a file"
          onClick={exportSlice}
          disabled={!sessionStore.activeSourceId}
          data-tour="export"
        >
          Export…
        </button>
        <button
          class="btn-base"
          classList={{ "btn-primary": sessionStore.view === "diff" }}
          title="Diff two sources side-by-side"
          onClick={() => setSession("view", sessionStore.view === "diff" ? "logs" : "diff")}
          disabled={sessionStore.sources.length < 1}
          data-tour="diff"
        >
          Diff
        </button>
        <button
          class="btn-base"
          classList={{ "btn-primary": sessionStore.detailsOpen }}
          onClick={() => setSession("detailsOpen", (v) => !v)}
          title="Toggle details panel"
          data-tour="details"
        >
          Details
        </button>
        <button
          class="btn-base btn-icon"
          classList={{ "btn-primary": sessionStore.view === "settings" }}
          title="Settings"
          onClick={() => setSession("view", sessionStore.view === "settings" ? "logs" : "settings")}
          data-tour="settings"
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
