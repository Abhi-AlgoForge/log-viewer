import { For, Show, createEffect, createSignal, on, onMount } from "solid-js";
import {
  sessionStore,
  setSession,
  setActiveSource,
  activeSource,
  toggleBookmark,
  setBookmarkNote,
  setPatterns,
  removeSource,
  setMergeSelected,
  setMergeStatus,
  selectedForMerge,
  colorForSource,
  MERGE_VIEW_ID,
} from "../state/session";
import { api } from "../services/api";
import { applyFilterToActive } from "../services/filter";
import { Icon } from "./Icon";
import { Checkbox } from "./Checkbox";
import { Chat } from "./Chat";

const TABS = [
  { id: "sources", label: "Sources", grow: 1 },
  { id: "patterns", label: "Patterns", grow: 1 },
  { id: "bookmarks", label: "Bookmarks", grow: 1.4 },
  { id: "ai", label: "AI", grow: 0.5 },
] as const;

export function Sidebar() {
  return (
    <aside
      class="flex w-[280px] shrink-0 flex-col border-r border-[var(--color-border-soft)] bg-[var(--color-bg-panel)]"
      data-tour="sidebar"
    >
      {/* Segmented tab control */}
      <div class="m-3 mb-2 flex shrink-0 items-center rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-base)] p-1">
        <For each={TABS}>
          {(t) => (
            <button
              class="rounded-md py-1.5 text-[13px] font-medium transition-colors"
              style={{ flex: `${t.grow} 1 0%` }}
              classList={{
                "bg-[var(--color-bg-elev-2)] text-[var(--color-text-primary)] shadow-[var(--shadow-card)]":
                  sessionStore.sidebarTab === t.id,
                "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]":
                  sessionStore.sidebarTab !== t.id,
              }}
              onClick={() => setSession("sidebarTab", t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>
      <div class="flex-1 overflow-y-auto px-3 pb-3 text-[13px] text-[var(--color-text-secondary)]">
        {sessionStore.sidebarTab === "sources" && <SourcesPane />}
        {sessionStore.sidebarTab === "patterns" && <PatternsPane />}
        {sessionStore.sidebarTab === "bookmarks" && <BookmarksPane />}
        {sessionStore.sidebarTab === "ai" && <AiPane />}
      </div>
    </aside>
  );
}

function SectionEmpty(props: { children: any }) {
  return (
    <div class="rounded-lg border border-dashed border-[var(--color-border-soft)] p-4 text-center text-[13px] text-[var(--color-text-muted)]">
      {props.children}
    </div>
  );
}

function SourcesPane() {
  async function close(id: string) {
    try {
      await api.closeSource(id);
    } catch (e) {
      console.error("close source failed", e);
    }
    removeSource(id);
  }

  async function startMerge() {
    const ids = selectedForMerge();
    if (ids.length < 2) return;
    try {
      const status = await api.startMerge(ids);
      setMergeStatus(status);
      setActiveSource(MERGE_VIEW_ID);
    } catch (e) {
      console.error("start merge failed", e);
    }
  }

  async function stopMerge() {
    try {
      await api.stopMerge();
    } catch {
      /* ignore */
    }
    setMergeStatus(null);
    if (sessionStore.activeSourceId === MERGE_VIEW_ID) {
      const next = sessionStore.sources[0]?.id ?? null;
      setActiveSource(next);
    }
  }

  return (
    <div class="flex flex-col gap-2">
      <Show when={sessionStore.mergeStatus}>
        <div
          class="group flex items-center gap-2 rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3"
          classList={{
            "ring-2 ring-[var(--color-accent)]/40":
              sessionStore.activeSourceId === MERGE_VIEW_ID,
          }}
        >
          <button
            class="min-w-0 flex-1 text-left"
            onClick={() => setActiveSource(MERGE_VIEW_ID)}
          >
            <div class="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">
              Merged view
            </div>
            <div class="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
              {sessionStore.mergeStatus!.sources.length} sources ·{" "}
              {sessionStore.mergeStatus!.built.toLocaleString()} rows
              {!sessionStore.mergeStatus!.done && " · building…"}
            </div>
          </button>
          <button
            class="icon-btn shrink-0 hover:!text-[var(--color-level-error)]"
            title="Stop merge"
            onClick={stopMerge}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </Show>

      <Show when={selectedForMerge().length >= 2 && !sessionStore.mergeStatus}>
        <button
          class="rounded-lg border border-dashed border-[var(--color-accent)]/60 bg-[var(--color-accent-soft)] px-3 py-2.5 text-[13px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] hover:border-[var(--color-accent)]"
          onClick={startMerge}
        >
          Merge {selectedForMerge().length} sources by time →
        </button>
      </Show>

      <Show
        when={sessionStore.sources.length > 0}
        fallback={
          <SectionEmpty>
            No sources open. Click <b>Open file</b> or <b>Command</b> above.
          </SectionEmpty>
        }
      >
        <For each={sessionStore.sources}>
          {(s) => (
            <div
              class="group flex items-stretch overflow-hidden rounded-lg border bg-[var(--color-bg-elev)] transition-colors"
              classList={{
                "border-[var(--color-accent)]/50 bg-[var(--color-bg-elev-2)]":
                  s.id === sessionStore.activeSourceId,
                "border-[var(--color-border-soft)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]":
                  s.id !== sessionStore.activeSourceId,
              }}
            >
              <div
                class="flex shrink-0 items-center px-3"
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={!!sessionStore.mergeSelected[s.id]}
                  onChange={(next) => setMergeSelected(s.id, next)}
                  title="Include in merge view"
                />
              </div>
              <button
                class="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-2 text-left"
                onClick={() => setActiveSource(s.id)}
                title={s.label}
              >
                <span
                  class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ "background-color": colorForSource(s.id) }}
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 truncate">
                    <span class="truncate text-[14px] font-medium text-[var(--color-text-primary)]">
                      {s.label}
                    </span>
                    <Show when={s.live}>
                      <span
                        class="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-success)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-success)]"
                        title="Live"
                      >
                        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-success)]" />
                        LIVE
                      </span>
                    </Show>
                  </div>
                  <div class="mt-0.5 text-[11px] text-[var(--color-text-faint)]">
                    {s.kind} · {s.totalLines.toLocaleString()} lines
                  </div>
                </div>
              </button>
              <button
                class="icon-btn mr-1.5 self-center opacity-0 transition-opacity hover:!text-[var(--color-level-error)] group-hover:opacity-100"
                title="Close source"
                onClick={(e) => {
                  e.stopPropagation();
                  close(s.id);
                }}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

function PatternsPane() {
  const src = () => activeSource();
  const cluster = () => (src() ? sessionStore.clusters[src()!.id] : undefined);

  createEffect(
    on(
      () => [sessionStore.sidebarTab, sessionStore.activeSourceId] as const,
      async ([tab, sid]) => {
        if (tab !== "patterns" || !sid) return;
        const c = sessionStore.clusters[sid];
        if (c && (c.patterns.length > 0 || !c.done)) return;
        try {
          await api.clusterSource(sid);
        } catch (e) {
          console.error("cluster trigger failed", e);
        }
      },
    ),
  );

  createEffect(
    on(
      () => {
        const sid = sessionStore.activeSourceId;
        return sid ? sessionStore.clusters[sid]?.done : undefined;
      },
      async (done) => {
        const sid = sessionStore.activeSourceId;
        if (!sid || !done) return;
        try {
          const patterns = await api.getPatterns(sid);
          setPatterns(sid, patterns);
        } catch (e) {
          console.error("get patterns failed", e);
        }
      },
    ),
  );

  return (
    <div class="flex flex-col gap-2">
      <Show when={!src()}>
        <SectionEmpty>Open a source to see patterns.</SectionEmpty>
      </Show>
      <Show when={src() && cluster() && !cluster()!.done}>
        <div class="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
          Clustering… {Math.round(((cluster()!.scanned || 0) / Math.max(1, cluster()!.total)) * 100)}%
          {" · "}
          {cluster()!.patternCount.toLocaleString()} templates so far
        </div>
      </Show>
      <Show when={src() && cluster() && cluster()!.done && cluster()!.patterns.length === 0}>
        <SectionEmpty>No patterns detected.</SectionEmpty>
      </Show>
      <For each={cluster()?.patterns ?? []}>
        {(p) => (
          <button
            class="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] p-3 text-left hover:border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"
            onClick={() => applyFilterToActive(`/${p.regex}/`)}
            title={p.regex}
          >
            <div class="flex items-baseline justify-between gap-2">
              <span class="truncate text-[13px] font-mono text-[var(--color-text-primary)]">
                {p.template}
              </span>
              <span class="shrink-0 rounded-full bg-[var(--color-bg-elev-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
                {p.count.toLocaleString()}
              </span>
            </div>
            <Show when={p.level}>
              <span class="mt-1 inline-block text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                {p.level}
              </span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}

function AiPane() {
  const [hasKey, setHasKey] = createSignal(false);
  const [chatTick, setChatTick] = createSignal(0);

  onMount(async () => {
    try {
      const cfg = await api.aiGetConfig();
      const active = cfg.providers?.[cfg.activeProvider as keyof typeof cfg.providers];
      setHasKey(!!active?.apiKey);
    } catch (e) {
      console.error(e);
    }
  });

  // The chat is keyed on activeSource + tick so the user can re-run the
  // anomaly summary on demand without having to switch sources.
  const conversationId = () => {
    const sid = activeSource()?.id ?? "";
    return `anomaly:${sid}:${chatTick()}`;
  };

  const seed = () => {
    const sid = activeSource()?.id;
    if (!sid) throw new Error("Open a source first.");
    return api.aiSeedSummarizePatterns(sid);
  };

  return (
    <div class="flex flex-col gap-3">
      <Show
        when={hasKey()}
        fallback={
          <SectionEmpty>
            Set your AI provider API key in <b>Settings</b> (⚙) to enable AI features.
          </SectionEmpty>
        }
      >
        <div class="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] p-3 text-[13px] text-[var(--color-text-muted)]">
          Use <b class="text-[var(--color-text-primary)]">✨ Ask</b> in the toolbar for
          natural-language filters, the Details panel's{" "}
          <b class="text-[var(--color-text-primary)]">Explain</b> /{" "}
          <b class="text-[var(--color-text-primary)]">Root cause</b> for individual
          lines or selections, and the chat below for anomaly summaries across
          patterns. Follow-up questions stay in context.
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[12px] uppercase tracking-wider text-[var(--color-text-faint)]">
            Anomaly chat
          </span>
          <button
            class="rounded px-2 py-0.5 text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
            disabled={!activeSource()}
            onClick={() => setChatTick((t) => t + 1)}
            title="Start a fresh conversation"
          >
            New chat
          </button>
        </div>
        <Show
          when={activeSource()}
          fallback={
            <SectionEmpty>Open a source to ask about its anomalies.</SectionEmpty>
          }
        >
          <Chat
            conversationId={conversationId()}
            seed={seed}
            followUpPlaceholder="Ask about these patterns…"
          />
        </Show>
      </Show>
    </div>
  );
}

function BookmarksPane() {
  const src = () => activeSource();
  const bookmarks = () => (src() ? sessionStore.bookmarks[src()!.id] ?? [] : []);
  return (
    <div class="flex flex-col gap-1.5">
      <Show when={!src()}>
        <SectionEmpty>Open a source to bookmark lines.</SectionEmpty>
      </Show>
      <Show when={src() && bookmarks().length === 0}>
        <SectionEmpty>
          Select a line and press <kbd>B</kbd> to bookmark.
        </SectionEmpty>
      </Show>
      <For each={bookmarks()}>
        {(b) => (
          <div class="group flex flex-col overflow-hidden rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] hover:border-[var(--color-border)]">
            <div class="flex items-stretch">
              <button
                class="flex-1 truncate px-3 py-2 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                onClick={() => setSession("selectedLine", b.line)}
                title={`Jump to line ${b.line + 1}`}
              >
                <span class="text-[var(--color-text-faint)]">Line</span>{" "}
                {(b.line + 1).toLocaleString()}
              </button>
              <button
                class="icon-btn mr-1.5 self-center opacity-0 transition-opacity hover:!text-[var(--color-level-error)] group-hover:opacity-100"
                title="Remove bookmark"
                onClick={() => toggleBookmark(src()!.id, b.line)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <input
              class="border-t border-[var(--color-border-soft)] bg-transparent px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] placeholder:text-[var(--color-text-faint)] focus:bg-[var(--color-bg-hover)] focus:outline-none"
              placeholder="Add a note…"
              value={b.note ?? ""}
              onChange={(e) => setBookmarkNote(src()!.id, b.line, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
              }}
            />
          </div>
        )}
      </For>
    </div>
  );
}
