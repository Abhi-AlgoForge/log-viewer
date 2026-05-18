import { For, Show, createEffect, on } from "solid-js";
import { sessionStore, setSession, MERGE_VIEW_ID } from "../state/session";
import { SourceViewer } from "./Viewer";

/// Two-pane diff view. Each pane picks any open source independently.
/// Sync-scroll keeps the two panes proportional to each other when enabled.
export function DiffView() {
  let leftEl!: HTMLDivElement;
  let rightEl!: HTMLDivElement;
  let syncing = false;

  function attachSync() {
    const leftScroll = leftEl?.querySelector("[data-viewer-scroll]") as HTMLElement | null;
    const rightScroll = rightEl?.querySelector("[data-viewer-scroll]") as HTMLElement | null;
    if (!leftScroll || !rightScroll) return;
    const sync = (from: HTMLElement, to: HTMLElement) => {
      if (syncing) return;
      if (!sessionStore.diff.syncScroll) return;
      syncing = true;
      const fromMax = from.scrollHeight - from.clientHeight;
      const toMax = to.scrollHeight - to.clientHeight;
      if (fromMax > 0 && toMax > 0) {
        const ratio = from.scrollTop / fromMax;
        to.scrollTop = ratio * toMax;
      }
      requestAnimationFrame(() => {
        syncing = false;
      });
    };
    leftScroll.addEventListener("scroll", () => sync(leftScroll, rightScroll));
    rightScroll.addEventListener("scroll", () => sync(rightScroll, leftScroll));
  }

  // Re-attach when either pane's source changes (since SourceViewer remounts
  // ActiveViewer with a new scroll element).
  createEffect(
    on(
      () => [
        sessionStore.diff.leftSourceId,
        sessionStore.diff.rightSourceId,
      ] as const,
      () => queueMicrotask(attachSync),
    ),
  );

  // Auto-seed defaults from the open sources.
  createEffect(() => {
    const openIds = sessionStore.sources
      .map((s) => s.id)
      .filter((id) => id !== sessionStore.diff.leftSourceId);
    if (!sessionStore.diff.leftSourceId && sessionStore.sources[0]) {
      setSession("diff", "leftSourceId", sessionStore.sources[0].id);
    }
    if (!sessionStore.diff.rightSourceId && openIds[0]) {
      setSession("diff", "rightSourceId", openIds[0]);
    }
  });

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex h-10 shrink-0 items-center gap-3 border-b border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] px-3 text-[12px] text-[var(--color-text-muted)]">
        <span class="font-medium text-[var(--color-text-primary)]">Diff</span>
        <label class="flex items-center gap-1.5">
          <input
            type="checkbox"
            class="h-3 w-3 accent-[var(--color-accent)]"
            checked={sessionStore.diff.syncScroll}
            onChange={(e) => setSession("diff", "syncScroll", e.currentTarget.checked)}
          />
          Sync scroll
        </label>
        <span class="flex-1" />
        <button
          class="btn-base"
          onClick={() => setSession("view", "logs")}
        >
          Exit diff
        </button>
      </div>
      <div class="flex min-h-0 flex-1">
        <DiffPane
          side="left"
          ref={(el) => (leftEl = el)}
          sourceId={sessionStore.diff.leftSourceId}
        />
        <div class="w-px shrink-0 bg-[var(--color-border)]" />
        <DiffPane
          side="right"
          ref={(el) => (rightEl = el)}
          sourceId={sessionStore.diff.rightSourceId}
        />
      </div>
    </div>
  );
}

function DiffPane(props: {
  side: "left" | "right";
  ref: (el: HTMLDivElement) => void;
  sourceId: string | null;
}) {
  const key = props.side === "left" ? "leftSourceId" : "rightSourceId";
  const choices = () =>
    sessionStore.sources.filter((s) => s.id !== MERGE_VIEW_ID);

  return (
    <div ref={props.ref} class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] px-3 text-[12px]">
        <span class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
          {props.side === "left" ? "A" : "B"}
        </span>
        <select
          class="h-7 min-w-0 flex-1 rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-2 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
          value={props.sourceId ?? ""}
          onChange={(e) => setSession("diff", key, e.currentTarget.value || null)}
        >
          <option value="">— pick a source —</option>
          <For each={choices()}>
            {(s) => <option value={s.id}>{s.label}</option>}
          </For>
        </select>
      </div>
      <div class="flex min-h-0 min-w-0 flex-1" data-viewer-pane>
        <Show
          when={props.sourceId}
          fallback={
            <div class="flex h-full w-full items-center justify-center text-[12px] text-[var(--color-text-muted)]">
              Pick a source above.
            </div>
          }
        >
          <SourceViewer sourceId={props.sourceId!} />
        </Show>
      </div>
    </div>
  );
}
