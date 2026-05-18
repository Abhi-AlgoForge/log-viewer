import { Show } from "solid-js";
import { activeFilter, activeSource, sessionStore, MERGE_VIEW_ID } from "../state/session";
import { formatBytes } from "../utils/format";

function Pill(props: { children: any; tone?: "accent" | "warn" | "neutral" }) {
  const tone = props.tone ?? "neutral";
  const cls = {
    neutral: "bg-[var(--color-bg-elev)] text-[var(--color-text-muted)]",
    accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
    warn: "bg-[var(--color-level-warn)]/15 text-[var(--color-level-warn)]",
  }[tone];
  return (
    <span class={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {props.children}
    </span>
  );
}

export function StatusBar() {
  const isMerge = () => sessionStore.activeSourceId === MERGE_VIEW_ID;
  return (
    <div class="flex h-8 shrink-0 items-center gap-2 border-t border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] px-3 text-[12px] text-[var(--color-text-muted)]">
      <Show when={isMerge()} fallback={<SingleSourceStatus />}>
        <MergeStatus />
      </Show>
      <span class="flex-1" />
      <span class="text-[var(--color-text-faint)]">v0.1.0</span>
    </div>
  );
}

function SingleSourceStatus() {
  const s = () => activeSource();
  const f = () => activeFilter();
  return (
    <Show when={s()} fallback={<span>No source</span>}>
      <span class="font-medium text-[var(--color-text-secondary)]">{s()!.label}</span>
      <Pill>{formatBytes(s()!.bytes)}</Pill>
      <Pill>{s()!.totalLines.toLocaleString()} lines</Pill>
      <Show when={s()!.indexed < s()!.bytes}>
        <Pill tone="accent">
          indexing {Math.round((s()!.indexed / Math.max(1, s()!.bytes)) * 100)}%
        </Pill>
      </Show>
      <Show when={f() && !f()!.isEmptyFilter}>
        <Pill tone="accent">
          filter · {f()!.matches.toLocaleString()} matches
          {!f()!.done && f()!.total > 0
            ? ` · scanning ${Math.round((f()!.scanned / f()!.total) * 100)}%`
            : ""}
        </Pill>
      </Show>
    </Show>
  );
}

function MergeStatus() {
  const m = () => sessionStore.mergeStatus;
  return (
    <Show when={m()} fallback={<span>No merge active</span>}>
      <span class="font-medium text-[var(--color-text-secondary)]">Merged view</span>
      <Pill>{m()!.sources.length} sources</Pill>
      <Pill>{m()!.built.toLocaleString()} rows</Pill>
      <Show when={!m()!.done}>
        <Pill tone="accent">building…</Pill>
      </Show>
    </Show>
  );
}
