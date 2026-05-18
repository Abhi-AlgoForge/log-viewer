import { For, Show, createEffect, createSignal, on } from "solid-js";
import { api, type HistogramBucketDTO } from "../services/api";
import { requestScrollTo, sessionStore, setSession } from "../state/session";
import { Icon } from "./Icon";
import { formatDateTime } from "../utils/format";

const LEVEL_ORDER = ["fatal", "error", "warn", "info", "debug", "trace", "unknown"];
const LEVEL_VAR: Record<string, string> = {
  fatal: "var(--color-level-fatal)",
  error: "var(--color-level-error)",
  warn: "var(--color-level-warn)",
  info: "var(--color-level-info)",
  debug: "var(--color-level-debug)",
  trace: "var(--color-level-trace)",
  unknown: "var(--color-text-faint)",
};

export function VerticalHistogram(props: { sourceId: string }) {
  const [hover, setHover] = createSignal<{ index: number; bucket: HistogramBucketDTO } | null>(null);

  const state = () => sessionStore.histograms[props.sourceId];
  const data = () => state()?.data ?? null;
  const computing = () => state() !== undefined && !state()!.done;

  // Kick off compute when the source changes. The result arrives via the
  // histogram-progress event listener in App.tsx.
  createEffect(
    on(
      () => props.sourceId,
      () => {
        setHover(null);
        if (!state()) {
          void api.computeHistogram(props.sourceId).catch((e) =>
            console.warn("computeHistogram", e),
          );
        }
      },
    ),
  );

  // Also retry when indexing finishes — the first compute may have raced an
  // empty index.
  createEffect(() => {
    const src = sessionStore.sources.find((s) => s.id === props.sourceId);
    if (!src) return;
    const indexingDone = src.indexed >= src.bytes && src.bytes > 0;
    const hasUsableData = !!data() && data()!.buckets.length > 0;
    if (indexingDone && !hasUsableData && !computing()) {
      // Reset so compute_histogram cache check on backend fires fresh.
      setSession("histograms", props.sourceId, undefined);
      void api.computeHistogram(props.sourceId).catch(() => {});
    }
  });

  const maxCount = () => {
    const d = data();
    if (!d) return 0;
    let m = 0;
    for (const b of d.buckets) if (b.total > m) m = b.total;
    return m;
  };

  const visibleBuckets = () => data()?.buckets.filter((b) => b.total > 0) ?? [];

  function bucketWidth(b: HistogramBucketDTO): number {
    const max = maxCount();
    if (max <= 0 || b.total === 0) return 0;
    const scaled = Math.sqrt(b.total / max);
    return Math.max(6, Math.round(scaled * 100));
  }

  function onBucketClick(b: HistogramBucketDTO) {
    if (b.total === 0) return;
    requestScrollTo(props.sourceId, b.firstLine);
  }

  const collapsed = () => sessionStore.histogramCollapsed;

  return (
    <aside
      class="relative flex shrink-0 flex-col border-l border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] transition-[width] duration-150"
      classList={{
        "w-12": collapsed(),
        "w-[52px]": !collapsed(),
      }}
    >
      <div class="flex h-7 shrink-0 items-center justify-center border-b border-[var(--color-border-soft)]">
        <button
          class="icon-btn"
          title={collapsed() ? "Expand histogram" : "Collapse histogram"}
          onClick={() => setSession("histogramCollapsed", !collapsed())}
        >
          <Icon name={collapsed() ? "back" : "close"} size={12} />
        </button>
      </div>
      <Show
        when={!collapsed()}
        fallback={
          <button
            class="flex flex-1 cursor-pointer items-center justify-center text-[10px] text-[var(--color-text-faint)] [writing-mode:vertical-rl]"
            title="Expand histogram"
            onClick={() => setSession("histogramCollapsed", false)}
          >
            volume
          </button>
        }
      >
        <div class="flex flex-1 flex-col gap-[2px] p-1">
          <Show
            when={data()}
            fallback={
              <div class="flex flex-1 items-center justify-center px-1 text-center text-[10px] text-[var(--color-text-faint)]">
                <Show when={computing()} fallback={<span>—</span>}>
                  {Math.round(((state()?.scanned ?? 0) / Math.max(1, state()?.total ?? 1)) * 100)}%
                </Show>
              </div>
            }
          >
            <Show
              when={visibleBuckets().length > 0}
              fallback={
                <div class="flex flex-1 items-center justify-center px-1 text-center text-[10px] text-[var(--color-text-faint)]">
                  No timestamps
                </div>
              }
            >
              <For each={visibleBuckets()}>
                {(b, i) => (
                  <div
                    class="relative flex h-full min-h-[2px] flex-1 cursor-pointer items-stretch overflow-hidden hover:opacity-90"
                    onMouseEnter={() => setHover({ index: i(), bucket: b })}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onBucketClick(b)}
                  >
                    <div
                      class="flex h-full items-stretch"
                      style={{ width: `${bucketWidth(b)}%` }}
                    >
                      <For each={LEVEL_ORDER}>
                        {(lvl) => {
                          const count = b.byLevel[lvl] ?? 0;
                          if (count === 0) return null;
                          const portion = (count / b.total) * 100;
                          return (
                            <div
                              style={{
                                width: `${portion}%`,
                                "background-color": LEVEL_VAR[lvl] ?? LEVEL_VAR.unknown,
                                "min-width": "1px",
                              }}
                            />
                          );
                        }}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
      <Show when={!collapsed() && hover() && data()}>
        <div
          class="pointer-events-none absolute right-full z-30 mr-2 whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elev-2)] px-2 py-1 text-[11px] shadow-[var(--shadow-elev)]"
          style={{
            top: tooltipTop(),
            transform: "translateY(-50%)",
          }}
        >
          <div class="font-mono text-[var(--color-text-primary)]">
            {formatDateTime(hover()!.bucket.startMs)}
          </div>
          <div class="text-[var(--color-text-muted)]">
            {hover()!.bucket.total.toLocaleString()} lines
            <Show when={data()?.sampled}>
              <span class="ml-1 text-[var(--color-text-faint)]">(sampled 1/{data()!.stride})</span>
            </Show>
          </div>
          <For each={LEVEL_ORDER}>
            {(lvl) => {
              const c = hover()!.bucket.byLevel[lvl] ?? 0;
              if (c === 0) return null;
              return (
                <div class="flex items-center gap-1.5">
                  <span
                    class="inline-block h-2 w-2 rounded-sm"
                    style={{ "background-color": LEVEL_VAR[lvl] ?? LEVEL_VAR.unknown }}
                  />
                  <span class="uppercase">{lvl}</span>
                  <span class="text-[var(--color-text-muted)]">{c.toLocaleString()}</span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </aside>
  );

  function tooltipTop(): string {
    const h = hover();
    const len = visibleBuckets().length;
    if (!h || len === 0) return "0";
    const stripHeightFraction = (h.index + 0.5) / len;
    return `calc(28px + (100% - 28px) * ${stripHeightFraction})`;
  }
}
