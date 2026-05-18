import { For, Show } from "solid-js";
import { filterFor, sessionStore, sourceById } from "../state/session";
import { formatBytes } from "../utils/format";

/// Centered modal-style loader. Shows while the active source has any heavy
/// long-running task in flight (indexing, filter scan, clustering, histogram).
/// Doesn't block input — `pointer-events-none` so users can still click
/// through if needed.
export function LoadingOverlay() {
  const tasks = () => {
    const sid = sessionStore.activeSourceId;
    if (!sid || sid === "merge:active") return [];
    const out: { label: string; percent: number; detail: string }[] = [];
    const s = sourceById(sid);
    if (s && s.bytes > 0 && s.indexed < s.bytes) {
      out.push({
        label: "Indexing",
        percent: Math.min(99, (s.indexed / s.bytes) * 100),
        detail: `${s.totalLines.toLocaleString()} lines · ${formatBytes(s.indexed)} / ${formatBytes(s.bytes)}`,
      });
    }
    const f = filterFor(sid);
    if (f && !f.isEmptyFilter && !f.done) {
      const p = f.total > 0 ? (f.scanned / f.total) * 100 : 0;
      out.push({
        label: "Scanning filter",
        percent: Math.min(99, p),
        detail: `${f.matches.toLocaleString()} matches`,
      });
    }
    const c = sessionStore.clusters[sid];
    if (c && !c.done) {
      const p = c.total > 0 ? (c.scanned / c.total) * 100 : 0;
      out.push({
        label: "Clustering",
        percent: Math.min(99, p),
        detail: `${c.patternCount.toLocaleString()} templates`,
      });
    }
    const h = sessionStore.histograms[sid];
    if (h && !h.done) {
      const p = h.total > 0 ? (h.scanned / h.total) * 100 : 0;
      out.push({
        label: "Building histogram",
        percent: Math.min(99, p),
        detail: `${h.scanned.toLocaleString()} / ${h.total.toLocaleString()} lines`,
      });
    }
    return out;
  };

  return (
    <Show when={tasks().length > 0}>
      <div class="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
        <div class="pointer-events-auto flex w-[420px] max-w-[90vw] flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)]/95 p-5 shadow-[var(--shadow-elev)] backdrop-blur-md">
          <div class="flex items-center gap-3">
            <Spinner />
            <div>
              <div class="text-[14px] font-semibold text-[var(--color-text-primary)]">
                Processing
              </div>
              <div class="text-[12px] text-[var(--color-text-muted)]">
                The viewer stays responsive — feel free to scroll while this finishes.
              </div>
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <For each={tasks()}>
              {(t) => (
                <div>
                  <div class="mb-1 flex items-baseline justify-between text-[12px]">
                    <span class="font-medium text-[var(--color-text-primary)]">{t.label}</span>
                    <span class="font-mono text-[11px] text-[var(--color-text-muted)]">
                      {t.percent.toFixed(0)}%
                    </span>
                  </div>
                  <div class="relative h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-elev)]">
                    <div
                      class="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-150"
                      style={{ width: `${t.percent}%` }}
                    />
                  </div>
                  <div class="mt-1 truncate text-[11px] text-[var(--color-text-faint)]">
                    {t.detail}
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}

function Spinner() {
  return (
    <div
      class="h-7 w-7 shrink-0 animate-spin rounded-full border-2 border-[var(--color-border)]"
      style={{ "border-top-color": "var(--color-accent)" }}
    />
  );
}

