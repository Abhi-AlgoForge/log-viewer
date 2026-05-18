import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import {
  activeFilter,
  activeSource,
  sessionStore,
  setSession,
  clearMultiSelection,
  pushToast,
} from "../state/session";
import { api, type RawLineDTO, type JsonFieldStatDTO } from "../services/api";
import { applyFilterToActive } from "../services/filter";
import { Icon } from "./Icon";
import { Chat } from "./Chat";

type ChatKind = "explain" | "root";
type ChatScope = "line" | "selection";

export function DetailsPanel() {
  const [line, setLine] = createSignal<RawLineDTO | null>(null);
  const [busy, setBusy] = createSignal<"regex" | "fields" | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [fields, setFields] = createSignal<JsonFieldStatDTO[] | null>(null);
  const [activeChat, setActiveChat] = createSignal<{
    kind: ChatKind;
    scope: ChatScope;
  } | null>(null);

  // Close the chat panel when the user moves to a different line / selection
  // so the next seed call hydrates the fresh context. The Chat itself re-seeds
  // when its `conversationId` changes, but we close here too so the buttons
  // visually un-press.
  createEffect(
    on(
      () => [
        sessionStore.activeSourceId,
        sessionStore.selectedLine,
        sessionStore.multiSelection.join(","),
      ] as const,
      () => setActiveChat(null),
    ),
  );

  createEffect(
    on(
      () => [sessionStore.activeSourceId, sessionStore.selectedLine] as const,
      async ([sid, ln]) => {
        setError(null);
        if (!sid || ln == null) {
          setLine(null);
          return;
        }
        try {
          const arr = await api.getLines(sid, ln, 1);
          setLine(arr[0] ?? null);
        } catch (e) {
          console.error(e);
          setLine(null);
        }
      },
    ),
  );

  // Reset fields cache on source change.
  createEffect(
    on(
      () => sessionStore.activeSourceId,
      () => setFields(null),
    ),
  );

  async function regexFromSelection() {
    const sid = sessionStore.activeSourceId;
    if (!sid) return;
    const selected = sessionStore.multiSelection;
    if (selected.length < 1) return;
    setBusy("regex");
    setError(null);
    try {
      const linesAll = await Promise.all(
        selected.map((n) => api.getLines(sid, n, 1).then((arr) => arr[0]?.raw ?? "")),
      );
      const examples = linesAll.filter((s) => s.length > 0);
      const regex = (await api.aiRegexFromExamples(examples)).trim();
      if (!regex) {
        setError("Couldn't derive a regex from those examples.");
        return;
      }
      await applyFilterToActive(`/${regex}/`);
      clearMultiSelection();
      pushToast("success", "Filter applied", `/${regex}/`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function discoverFields() {
    const sid = sessionStore.activeSourceId;
    if (!sid) return;
    setBusy("fields");
    setError(null);
    try {
      const list = await api.discoverFields(sid);
      setFields(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  function toggleChat(kind: ChatKind, scope: ChatScope) {
    const cur = activeChat();
    if (cur && cur.kind === kind && cur.scope === scope) {
      setActiveChat(null);
    } else {
      setActiveChat({ kind, scope });
    }
  }

  // Seed factory for the active chat. Captures the current source + selection
  // at call time so the Chat component can refetch when the conversation
  // identity changes.
  const chatSeed = createMemo(() => {
    const cur = activeChat();
    if (!cur) return null;
    const sid = sessionStore.activeSourceId;
    if (!sid) return null;
    const lineNumbers =
      cur.scope === "selection"
        ? [...sessionStore.multiSelection]
        : sessionStore.selectedLine != null
          ? [sessionStore.selectedLine]
          : [];
    if (lineNumbers.length === 0) return null;
    const conversationId = `${cur.kind}:${cur.scope}:${sid}:${lineNumbers.join(",")}`;
    const seed =
      cur.kind === "explain"
        ? () => api.aiSeedExplain(sid, lineNumbers)
        : () => api.aiSeedRootCause(sid, lineNumbers);
    return { conversationId, seed, kind: cur.kind };
  });

  return (
    <aside class="flex w-[440px] shrink-0 flex-col border-l border-[var(--color-border-soft)] bg-[var(--color-bg-panel)]">
      <div class="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border-soft)] px-4">
        <div class="flex items-baseline gap-2">
          <span class="text-[14px] font-semibold text-[var(--color-text-primary)]">
            Details
          </span>
          <Show when={line()}>
            <span class="text-[12px] text-[var(--color-text-faint)]">
              Line {(line()!.lineNumber + 1).toLocaleString()}
            </span>
          </Show>
        </div>
        <button
          class="icon-btn"
          onClick={() => setSession("detailsOpen", false)}
          title="Close details"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div class="flex flex-1 flex-col gap-3 overflow-y-auto p-4 text-[13px]">
        {/* Multi-selection actions */}
        <Show when={sessionStore.multiSelection.length >= 1}>
          <div class="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] p-3">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-[12px] font-medium text-[var(--color-accent)]">
                {sessionStore.multiSelection.length} line
                {sessionStore.multiSelection.length === 1 ? "" : "s"} selected
              </span>
              <button
                class="icon-btn"
                title="Clear selection"
                onClick={clearMultiSelection}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="btn-base btn-primary justify-center"
                classList={{
                  "ring-2 ring-[var(--color-accent)]":
                    activeChat()?.kind === "explain" &&
                    activeChat()?.scope === "selection",
                }}
                onClick={() => toggleChat("explain", "selection")}
                title="Summarize what these lines mean together (asks follow-ups too)"
              >
                ✨ Explain
              </button>
              <button
                class="btn-base btn-primary justify-center"
                classList={{
                  "ring-2 ring-[var(--color-accent)]":
                    activeChat()?.kind === "root" &&
                    activeChat()?.scope === "selection",
                }}
                onClick={() => toggleChat("root", "selection")}
                title="Trace the chain of events across the selection"
              >
                🔍 Root cause
              </button>
            </div>
            <button
              class="btn-base mt-2 w-full justify-center"
              onClick={regexFromSelection}
              disabled={busy() === "regex" || sessionStore.multiSelection.length < 1}
            >
              {busy() === "regex" ? "Generating…" : "Generate filter from selection"}
            </button>
            <Show
              when={
                chatSeed() && activeChat()?.scope === "selection"
              }
            >
              <div class="mt-3">
                <Chat
                  conversationId={chatSeed()!.conversationId}
                  seed={chatSeed()!.seed}
                  accent={
                    chatSeed()!.kind === "root"
                      ? "var(--color-accent)"
                      : undefined
                  }
                  followUpPlaceholder="Ask a follow-up about these lines…"
                />
              </div>
            </Show>
            <Show when={error()}>
              <div class="mt-2 rounded-md border border-[var(--color-level-error)]/40 bg-[var(--color-level-error)]/10 px-3 py-2 text-[12px] text-[var(--color-level-error)]">
                {error()}
              </div>
            </Show>
            <div class="mt-2 text-[11px] text-[var(--color-text-muted)]">
              Tip: <kbd>Shift</kbd>+click rows to add more lines.
            </div>
          </div>
        </Show>

        <Show
          when={line()}
          fallback={
            <Show when={sessionStore.multiSelection.length === 0}>
              <div class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--color-border-soft)] p-6 text-center text-[var(--color-text-muted)]">
                Select a line to inspect, or shift-click rows to build a selection.
              </div>
            </Show>
          }
        >
          <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span class="rounded-full bg-[var(--color-bg-elev)] px-2.5 py-0.5 text-[var(--color-text-muted)]">
              {activeSource()?.label}
            </span>
            <Show when={line()!.level}>
              <span class="rounded-full bg-[var(--color-bg-elev)] px-2.5 py-0.5 font-medium uppercase text-[var(--color-text-secondary)]">
                {line()!.level}
              </span>
            </Show>
            <Show when={activeFilter()?.isEmptyFilter === false}>
              <span class="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[var(--color-accent)]">
                filtered
              </span>
            </Show>
          </div>

          <div>
            <SectionHeader>Raw</SectionHeader>
            <div class="mt-1.5 max-h-60 overflow-auto rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] p-3 font-mono text-[12px] leading-relaxed text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
              {line()!.raw}
            </div>
          </div>

          <Show when={line()!.timestamp != null || line()!.message}>
            <div class="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] p-3">
              <Show when={line()!.timestamp != null}>
                <Row
                  label="Timestamp"
                  value={new Date(line()!.timestamp!).toISOString()}
                  mono
                />
              </Show>
              <Show when={line()!.level}>
                <Row label="Level" value={line()!.level!} />
              </Show>
              <Show when={line()!.message}>
                <Row label="Message" value={line()!.message!} />
              </Show>
            </div>
          </Show>

          <div>
            <SectionHeader>AI</SectionHeader>
            <div class="mt-1.5 grid grid-cols-2 gap-2">
              <button
                class="btn-base btn-primary justify-center"
                classList={{
                  "ring-2 ring-[var(--color-accent)]":
                    activeChat()?.kind === "explain" &&
                    activeChat()?.scope === "line",
                }}
                onClick={() => toggleChat("explain", "line")}
                title="Explain this line, then ask follow-up questions"
              >
                ✨ Explain
              </button>
              <button
                class="btn-base btn-primary justify-center"
                classList={{
                  "ring-2 ring-[var(--color-accent)]":
                    activeChat()?.kind === "root" && activeChat()?.scope === "line",
                }}
                onClick={() => toggleChat("root", "line")}
                title="Trace the chain of events that led to this line"
              >
                🔍 Root cause
              </button>
            </div>
            <Show
              when={
                chatSeed() && activeChat()?.scope === "line"
              }
            >
              <div class="mt-2">
                <Chat
                  conversationId={chatSeed()!.conversationId}
                  seed={chatSeed()!.seed}
                  accent={
                    chatSeed()!.kind === "root"
                      ? "var(--color-accent)"
                      : undefined
                  }
                  followUpPlaceholder="Ask a follow-up about this line…"
                />
              </div>
            </Show>
          </div>
        </Show>

        {/* JSON field discovery */}
        <div>
          <div class="flex items-center justify-between">
            <SectionHeader>Fields</SectionHeader>
            <button
              class="rounded px-2 py-0.5 text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
              onClick={discoverFields}
              disabled={busy() === "fields" || !activeSource()}
            >
              {busy() === "fields" ? "Scanning…" : fields() ? "Rescan" : "Scan JSON fields"}
            </button>
          </div>
          <Show when={fields()}>
            <Show
              when={fields()!.length > 0}
              fallback={
                <div class="mt-1.5 text-[12px] text-[var(--color-text-muted)]">
                  No JSON fields detected in the first ~1000 lines.
                </div>
              }
            >
              <ul class="mt-1.5 flex flex-col gap-1.5">
                <For each={fields()!.slice(0, 30)}>
                  {(f) => (
                    <li class="rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] p-2">
                      <div class="flex items-baseline justify-between">
                        <span class="font-mono text-[12px] text-[var(--color-text-primary)]">
                          {f.name}
                        </span>
                        <span class="text-[11px] text-[var(--color-text-faint)]">
                          {f.occurrences} hits
                        </span>
                      </div>
                      <div class="mt-1 flex flex-wrap gap-1">
                        <For each={f.samples.slice(0, 5)}>
                          {(v) => (
                            <button
                              class="rounded-full bg-[var(--color-bg-elev-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-accent)]"
                              title={`Filter by "${v}"`}
                              onClick={() => applyFilterToActive(`"${f.name}":"${v}"`)}
                            >
                              {v}
                            </button>
                          )}
                        </For>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </div>
    </aside>
  );
}

function SectionHeader(props: { children: any }) {
  return (
    <h3 class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
      {props.children}
    </h3>
  );
}

function Row(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div class="flex items-start gap-3 py-1 first:pt-0 last:pb-0">
      <span class="w-20 shrink-0 text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
        {props.label}
      </span>
      <span
        class={`min-w-0 flex-1 break-words text-[12px] text-[var(--color-text-primary)] ${
          props.mono ? "font-mono" : ""
        }`}
      >
        {props.value}
      </span>
    </div>
  );
}
