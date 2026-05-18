import { For, Show } from "solid-js";
import { filterFor, sessionStore, sourceById } from "../state/session";
import { formatBytes } from "../utils/format";

interface Task {
  id: string;
  label: string;
  percent: number;
  detail: string;
  tone: "indexing" | "filter" | "cluster";
}

/// Stacked progress bar that surfaces any background work in flight for the
/// active source — indexing, filter scan, clustering. Each task is a thin
/// animated bar with its current count and percent.
export function ProgressBanner(props: { sourceId: string }) {
  const tasks = (): Task[] => {
    const out: Task[] = [];
    const s = sourceById(props.sourceId);
    if (s && s.bytes > 0 && s.indexed < s.bytes) {
      out.push({
        id: "indexing",
        label: "Indexing",
        percent: Math.min(99, (s.indexed / s.bytes) * 100),
        detail: `${s.totalLines.toLocaleString()} lines · ${formatBytes(s.indexed)} / ${formatBytes(s.bytes)}`,
        tone: "indexing",
      });
    }
    const f = filterFor(props.sourceId);
    if (f && !f.isEmptyFilter && !f.done) {
      const percent = f.total > 0 ? (f.scanned / f.total) * 100 : 0;
      out.push({
        id: "filter",
        label: "Scanning filter",
        percent: Math.min(99, percent),
        detail: `${f.matches.toLocaleString()} matches`,
        tone: "filter",
      });
    }
    const c = sessionStore.clusters[props.sourceId];
    if (c && !c.done) {
      const percent = c.total > 0 ? (c.scanned / c.total) * 100 : 0;
      out.push({
        id: "cluster",
        label: "Clustering",
        percent: Math.min(99, percent),
        detail: `${c.patternCount.toLocaleString()} templates`,
        tone: "cluster",
      });
    }
    const hist = sessionStore.histograms[props.sourceId];
    if (hist && !hist.done) {
      const percent = hist.total > 0 ? (hist.scanned / hist.total) * 100 : 0;
      out.push({
        id: "histogram",
        label: "Building histogram",
        percent: Math.min(99, percent),
        detail: `${hist.scanned.toLocaleString()} / ${hist.total.toLocaleString()} lines`,
        tone: "cluster",
      });
    }
    return out;
  };

  return (
    <Show when={tasks().length > 0}>
      <div class="flex shrink-0 flex-col gap-1 border-b border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] px-3 py-2">
        <For each={tasks()}>
          {(t) => <TaskRow task={t} />}
        </For>
      </div>
    </Show>
  );
}

function TaskRow(props: { task: Task }) {
  return (
    <div class="flex items-center gap-3">
      <div class="flex w-40 shrink-0 items-baseline gap-2 text-[12px]">
        <span class="font-medium text-[var(--color-text-primary)]">{props.task.label}</span>
        <span class="font-mono text-[11px] text-[var(--color-text-faint)]">
          {props.task.percent.toFixed(0)}%
        </span>
      </div>
      <div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-bg-elev)]">
        <div
          class="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-150"
          style={{ width: `${props.task.percent}%` }}
        />
      </div>
      <div class="w-44 shrink-0 truncate text-right text-[11px] text-[var(--color-text-muted)]">
        {props.task.detail}
      </div>
    </div>
  );
}

