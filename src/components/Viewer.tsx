import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  sessionStore,
  sourceById,
  filterFor,
  setSession,
  isBookmarked,
  isFollowing,
  colorForSource,
  removeRecentFile,
  toggleMultiSelection,
  TEXT_INTENSITY,
  MERGE_VIEW_ID,
} from "../state/session";
import { openPath } from "../services/openFile";
import type { LogLevel, RawLineDTO } from "../services/api";
import { api } from "../services/api";
import { filterHighlightRegex } from "../services/filter";
import { TokenizedMessage } from "./TokenizedMessage";
import { ProgressBanner } from "./ProgressBanner";
import { startTour } from "./Tour";
import { formatHms } from "../utils/format";

const FETCH_WINDOW = 256;

const LEVEL_COLOR: Record<LogLevel, string> = {
  trace: "text-[var(--color-level-trace)]",
  debug: "text-[var(--color-level-debug)]",
  info: "text-[var(--color-level-info)]",
  warn: "text-[var(--color-level-warn)]",
  error: "text-[var(--color-level-error)]",
  fatal: "text-[var(--color-level-fatal)]",
};

const LEVEL_BG: Record<LogLevel, string> = {
  trace: "",
  debug: "",
  info: "",
  warn: "bg-[color-mix(in_oklab,var(--color-level-warn)_10%,transparent)]",
  error: "bg-[color-mix(in_oklab,var(--color-level-error)_12%,transparent)]",
  fatal: "bg-[color-mix(in_oklab,var(--color-level-fatal)_18%,transparent)]",
};

type CachedLine = RawLineDTO & {
  sourceId?: string;
  /// Level used for the row background tint — equal to `level` for normal
  /// rows, inherited from the most recent structured line above when this
  /// row is a continuation (e.g. stack-trace frames with no timestamp).
  effectiveLevel?: LogLevel | null;
};

/// Window-granular cache with LRU eviction. Each fetched window is keyed by
/// its aligned offset. `windowOrder` tracks access for eviction. `fetched`
/// stays as a derived merged-range array for the existing `isFetched` check
/// (callers expect range-based semantics for partial-window fetches near
/// end-of-file).
interface LineCache {
  lines: Map<number, CachedLine>;
  windows: Set<number>;
  windowOrder: number[];
  fetched: Array<[number, number]>;
}

const MAX_CACHE_WINDOWS = 60;

function newCache(): LineCache {
  return { lines: new Map(), windows: new Set(), windowOrder: [], fetched: [] };
}

function isFetched(cache: LineCache, line: number): boolean {
  for (const [s, e] of cache.fetched) {
    if (line >= s && line < e) return true;
  }
  return false;
}

function rebuildFetched(cache: LineCache) {
  // Sort windows, emit merged ranges. Used after any window add/evict so
  // isFetched stays consistent without manual range math at the call site.
  const sorted = Array.from(cache.windows).sort((a, b) => a - b);
  const merged: Array<[number, number]> = [];
  for (const w of sorted) {
    const end = w + FETCH_WINDOW;
    const last = merged[merged.length - 1];
    if (last && w <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([w, end]);
  }
  cache.fetched = merged;
}

function recordFetched(cache: LineCache, start: number, _endIgnored: number) {
  // Promote this window to most-recent.
  cache.windowOrder = cache.windowOrder.filter((w) => w !== start);
  cache.windowOrder.push(start);
  cache.windows.add(start);
  // Evict oldest windows past the budget. The currently-visible windows are
  // also most-recently touched, so this is unlikely to nuke what the user is
  // looking at.
  while (cache.windowOrder.length > MAX_CACHE_WINDOWS) {
    const oldest = cache.windowOrder.shift();
    if (oldest === undefined) break;
    cache.windows.delete(oldest);
    for (let i = oldest; i < oldest + FETCH_WINDOW; i++) {
      cache.lines.delete(i);
    }
  }
  rebuildFetched(cache);
}

/// Prefer the original timestamp text (preserves microseconds, timezone,
/// arbitrary format). Fall back to the parsed epoch when the source had no
/// extractable timestamp string (e.g. epoch-only logs).
function displayTime(line: RawLineDTO | undefined): string {
  if (!line) return "";
  if (line.timestampStr) {
    const t = line.timestampStr;
    // Strip date prefix so the column shows just the time portion.
    const tIdx = t.indexOf("T");
    const spIdx = t.indexOf(" ");
    const sep = tIdx >= 0 ? tIdx : spIdx;
    return sep >= 0 ? t.slice(sep + 1) : t;
  }
  return formatHms(line.timestamp);
}

export function Viewer() {
  return (
    <div class="relative flex min-w-0 flex-1 flex-col bg-[var(--color-bg-base)]">
      <Show
        when={sessionStore.activeSourceId}
        fallback={<EmptyState />}
      >
        <ActiveViewer sourceId={sessionStore.activeSourceId!} />
      </Show>
    </div>
  );
}

/// Public entry for embedding a viewer with an explicit source id (used by
/// diff mode). Skips the empty-state UI — the caller decides what to show
/// when there's no source.
export function SourceViewer(props: { sourceId: string }) {
  return <ActiveViewer sourceId={props.sourceId} />;
}

function EmptyState() {
  function dismissWelcome() {
    setSession("showWelcome", false);
    try {
      localStorage.setItem("log-viewer.welcomeDismissed", "1");
    } catch {
      /* ignore */
    }
  }
  return (
    <div class="flex h-full items-center justify-center p-6">
      <div class="w-full max-w-md text-center">
        <Show when={sessionStore.showWelcome}>
          <div class="mb-4 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] p-5 text-left">
            <div class="mb-2 text-[15px] font-semibold text-[var(--color-text-primary)]">
              👋 Welcome to Log Viewer
            </div>
            <p class="mb-3 text-[13px] text-[var(--color-text-secondary)]">
              Take a quick spotlight tour of every feature (~30s) or jump straight in.
            </p>
            <div class="flex gap-2">
              <button
                class="btn-base btn-primary flex-1 justify-center"
                onClick={() => {
                  startTour();
                  dismissWelcome();
                }}
              >
                Start tour
              </button>
              <button class="btn-base flex-1 justify-center" onClick={dismissWelcome}>
                Skip
              </button>
            </div>
          </div>
        </Show>
        <div class="mb-2 text-[15px] font-medium text-[var(--color-text-primary)]">
          Open a log to begin
        </div>
        <div class="mb-6 text-[13px] text-[var(--color-text-muted)]">
          Drag a file onto this window, use <b>Open file</b> in the toolbar, or
          stream from a process with <b>Command</b>.
        </div>
        <Show when={sessionStore.recentFiles.length > 0}>
          <div class="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] p-3 text-left">
            <div class="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
              <span>Recent</span>
              <button
                class="hover:text-[var(--color-text-primary)]"
                onClick={() => {
                  for (const p of [...sessionStore.recentFiles]) removeRecentFile(p);
                }}
              >
                Clear
              </button>
            </div>
            <ul class="flex flex-col gap-px">
              <For each={sessionStore.recentFiles}>
                {(path) => (
                  <li class="group flex items-stretch rounded-md hover:bg-[var(--color-bg-hover)]">
                    <button
                      class="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[13px] text-[var(--color-text-secondary)]"
                      title={path}
                      onClick={() => openPath(path)}
                    >
                      <span class="truncate font-mono">{shortPath(path)}</span>
                    </button>
                    <button
                      class="icon-btn shrink-0 opacity-0 group-hover:opacity-100 hover:!text-[var(--color-level-error)]"
                      title="Forget"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecentFile(path);
                      }}
                    >
                      <span class="text-[14px]">×</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </div>
    </div>
  );
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/);
  if (parts.length <= 3) return p;
  return `…${parts.length > 3 ? "/" : ""}${parts.slice(-3).join("/")}`;
}

function ActiveViewer(props: { sourceId: string }) {
  let scrollEl!: HTMLDivElement;
  const [cacheVersion, setCacheVersion] = createSignal(0);
  const [maxTimeChars, setMaxTimeChars] = createSignal(8);
  let cache = newCache();
  let inFlight = new Set<number>();

  const isMerge = () => props.sourceId === MERGE_VIEW_ID;

  const highlight = createMemo(() => {
    const f = filterFor(props.sourceId);
    if (!f || f.isEmptyFilter) return null;
    return filterHighlightRegex(f.query);
  });

  const modeKey = () => {
    if (isMerge()) return `merge::${sessionStore.mergeStatus?.id ?? 0}::${sessionStore.logOrder}`;
    const f = filterFor(props.sourceId);
    return `${props.sourceId}::${f && !f.isEmptyFilter ? f.filterId : "all"}::${sessionStore.logOrder}`;
  };

  const rowCount = () => {
    if (isMerge()) return sessionStore.mergeStatus?.built ?? 0;
    const f = filterFor(props.sourceId);
    if (f && !f.isEmptyFilter) return f.matches;
    return sourceById(props.sourceId)?.totalLines ?? 0;
  };

  // Number of digits needed for the largest line number. Defined after
  // rowCount because createMemo evaluates synchronously and would otherwise
  // hit the temporal dead zone.
  const numCols = createMemo(() => {
    const total = rowCount();
    return total > 0 ? Math.max(3, String(total).length) : 3;
  });

  // Derive the run-length range of the selected line: walks back from the
  // selection until it finds a "parent" row (one with a timestamp or level)
  // then forward until the next parent. This lets continuation lines (stack
  // traces, multi-line messages) highlight as one block. Falls back to a
  // single-row range when surrounding cache isn't loaded yet.
  const selectedBlock = createMemo<{ start: number; end: number } | null>(() => {
    void cacheVersion();
    if (isMerge()) return null;
    const sel = sessionStore.selectedLine;
    if (sel == null) return null;
    const get = (n: number) => cache.lines.get(n);
    const isParent = (n: number) => {
      const l = get(n);
      if (!l) return false;
      return l.level != null || l.timestamp != null;
    };
    const isContinuation = (n: number) => {
      const l = get(n);
      if (!l) return false;
      return (
        l.level == null && l.timestamp == null && l.raw.trim().length > 0
      );
    };
    // Walk backward to find the parent row of the selection.
    let start = sel;
    while (start > 0 && get(start) && isContinuation(start)) start--;
    // Walk forward from the parent to find the next parent (or until cache
    // ends / non-continuation row appears).
    let end = start + 1;
    while (get(end) && isContinuation(end)) end++;
    if (!isParent(start) && end === start + 1) {
      return { start: sel, end: sel + 1 };
    }
    return { start, end };
  });

  const virtualizer = createVirtualizer({
    get count() {
      return rowCount();
    },
    getScrollElement: () => scrollEl,
    estimateSize: () => sessionStore.appearance.lineHeight,
    overscan: 40,
  });

  // Remeasure when row height changes (rare — settings slider).
  createEffect(() => {
    void sessionStore.appearance.lineHeight;
    virtualizer.measure();
  });

  async function fetchWindow(vstart: number) {
    const aligned = Math.floor(vstart / FETCH_WINDOW) * FETCH_WINDOW;
    if (inFlight.has(aligned)) return;
    if (isFetched(cache, aligned)) return;
    inFlight.add(aligned);
    try {
      const desc = sessionStore.logOrder === "desc";
      const total = rowCount();
      // Map virtual window [aligned, aligned+WIN) onto a real backend range.
      // For asc: identity. For desc: mirror around `total`, fetch the
      // corresponding ascending slice, then place results in reverse into the
      // virtual range.
      let realStart = aligned;
      let realCount = FETCH_WINDOW;
      if (desc && total > 0) {
        const endExclusive = Math.min(total, total - aligned);
        realStart = Math.max(0, endExclusive - FETCH_WINDOW);
        realCount = Math.max(0, endExclusive - realStart);
      }
      let fetched: CachedLine[] = [];
      if (isMerge()) {
        const lines = await api.getMergeLines(realStart, realCount);
        fetched = lines.map((l) => ({
          lineNumber: l.lineNumber,
          raw: l.raw,
          timestamp: l.timestamp,
          timestampStr: l.timestampStr,
          level: l.level,
          message: l.message,
          sourceId: l.sourceId,
        }));
      } else {
        const f = filterFor(props.sourceId);
        const isFiltered = !!(f && !f.isEmptyFilter);
        const lines = isFiltered
          ? await api.getFilteredLines(props.sourceId, f!.filterId, realStart, realCount)
          : await api.getLines(props.sourceId, realStart, realCount);
        fetched = lines;
      }
      // Propagate level across continuation lines (stack-trace style) so the
      // BG tint covers the whole error block, not just its first line. Walks
      // in chronological order regardless of display direction.
      let inherited: LogLevel | null = null;
      for (const l of fetched) {
        const isContinuation =
          l.timestamp == null && l.level == null && l.raw.trim().length > 0;
        if (l.level != null) {
          (l as CachedLine).effectiveLevel = l.level;
          inherited = l.level;
        } else if (isContinuation && inherited != null) {
          (l as CachedLine).effectiveLevel = inherited;
        } else {
          (l as CachedLine).effectiveLevel = null;
          if (l.timestamp != null) inherited = null;
        }
      }
      // Place in cache: in desc, last fetched line becomes first virtual row.
      if (desc && total > 0) {
        fetched.forEach((l, i) => {
          const v = aligned + (fetched.length - 1 - i);
          cache.lines.set(v, l);
        });
      } else {
        fetched.forEach((l, i) => cache.lines.set(aligned + i, l));
      }
      recordFetched(cache, aligned, aligned + fetched.length);
      // Grow the time column to fit the widest timestamp we've seen.
      let widest = maxTimeChars();
      for (const l of fetched) {
        const t = displayTime(l).length;
        if (t > widest) widest = t;
      }
      if (widest > maxTimeChars()) setMaxTimeChars(widest);
      setCacheVersion((v) => v + 1);
    } catch (e) {
      console.error("get lines failed", e);
    } finally {
      inFlight.delete(aligned);
    }
  }

  createEffect(() => {
    cacheVersion();
    rowCount();
    const items = virtualizer.getVirtualItems();
    if (items.length === 0) return;
    const first = items[0].index;
    const last = items[items.length - 1].index;
    const needed = new Set<number>();
    for (let line = first; line <= last; line += FETCH_WINDOW) {
      const aligned = Math.floor(line / FETCH_WINDOW) * FETCH_WINDOW;
      if (!isFetched(cache, aligned)) needed.add(aligned);
    }
    const lastAligned = Math.floor(last / FETCH_WINDOW) * FETCH_WINDOW;
    if (!isFetched(cache, lastAligned)) needed.add(lastAligned);
    untrack(() => {
      for (const w of needed) fetchWindow(w);
    });
  });

  createEffect(() => {
    void modeKey();
    // Mutate in place — Rows hold the cache reference via props, so a
    // reassignment to a new object would leave them showing stale data.
    cache.lines.clear();
    cache.windows.clear();
    cache.windowOrder.length = 0;
    cache.fetched.length = 0;
    inFlight.clear();
    setMaxTimeChars(8); // reset to baseline for the new source/filter
    setCacheVersion((v) => v + 1);
    if (scrollEl) scrollEl.scrollTop = 0;
  });

  createEffect(() => {
    void sessionStore.tailTick;
    const total = rowCount();
    if (total === 0) return;
    const desc = sessionStore.logOrder === "desc";
    if (desc) {
      // In desc mode, appending new lines shifts every virtual index. Easiest
      // correct thing: nuke the cache and let the visible window refetch.
      cache.lines.clear();
      cache.windows.clear();
      cache.windowOrder.length = 0;
      cache.fetched.length = 0;
      inFlight.clear();
    } else {
      const tailStart = Math.floor((total - 1) / FETCH_WINDOW) * FETCH_WINDOW;
      cache.windows.delete(tailStart);
      cache.windowOrder = cache.windowOrder.filter((w) => w !== tailStart);
      for (const k of Array.from(cache.lines.keys())) {
        if (k >= tailStart) cache.lines.delete(k);
      }
      rebuildFetched(cache);
    }
    setCacheVersion((v) => v + 1);
    if (!isMerge() && isFollowing(props.sourceId) && scrollEl) {
      queueMicrotask(() => {
        if (desc) scrollEl.scrollTop = 0;
        else scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    }
  });

  onCleanup(() => inFlight.clear());

  // Scroll-to-line requests from the histogram (or other sources).
  createEffect(() => {
    const target = sessionStore.scrollTarget;
    if (!target || target.sourceId !== props.sourceId) return;
    void target.tick;
    queueMicrotask(() => {
      virtualizer.scrollToIndex(target.line, { align: "center" });
    });
  });

  return (
    <div
      class="flex min-h-0 min-w-0 flex-1 flex-col"
      style={{
        "--num-col": `calc(${numCols()}ch + 16px)`,
        "--time-col": `calc(${maxTimeChars()}ch + 24px)`,
      }}
    >
      <Show when={!isMerge()}>
        <ProgressBanner sourceId={props.sourceId} />
      </Show>
      <ColumnHeader showSource={isMerge()} />
      <div
        ref={scrollEl}
        data-viewer-scroll
        class="min-h-0 flex-1 overflow-auto"
        style={{
          "font-family": sessionStore.appearance.fontFamily,
          "font-size": `${sessionStore.appearance.fontSize}px`,
          "line-height": `${sessionStore.appearance.lineHeight}px`,
          "letter-spacing": `${sessionStore.appearance.letterSpacing}px`,
          color: TEXT_INTENSITY[sessionStore.appearance.textIntensity].color,
        }}
        onWheel={(e) => {
          try {
            const lines = Number(sessionStore.appearance?.scrollLinesPerWheel ?? 0);
            if (!Number.isFinite(lines) || lines <= 0) return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            const lineH = Number(sessionStore.appearance?.lineHeight ?? 22) || 22;
            const delta = (e.deltaY / 100) * lines * lineH;
            if (!Number.isFinite(delta)) return;
            e.preventDefault();
            scrollEl.scrollTop += delta;
          } catch (err) {
            console.warn("wheel override failed", err);
          }
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%",
            "min-width": "max-content",
          }}
        >
          <For each={virtualizer.getVirtualItems()}>
            {(vrow) => (
              <Row
                vrow={vrow}
                sourceId={props.sourceId}
                cache={cache}
                cacheVersion={cacheVersion}
                showSource={isMerge()}
                highlight={highlight()}
                selectedBlock={selectedBlock()}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function ColumnHeader(props: { showSource: boolean }) {
  return (
    <div class="flex h-7 shrink-0 items-center border-b border-[var(--color-border)] bg-[var(--color-bg-panel)] font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
      <span class="inline-block w-3 shrink-0 select-none" />
      {props.showSource && (
        <span class="inline-block w-3 shrink-0 select-none" title="Source color" />
      )}
      <span
        class="inline-block shrink-0 select-none overflow-hidden border-r border-[var(--color-border-soft)] pr-2 text-right"
        style={{ width: "var(--num-col)" }}
      >
        #
      </span>
      <span
        class="inline-block shrink-0 select-none overflow-hidden border-r border-[var(--color-border-soft)] px-3"
        style={{ width: "var(--time-col)" }}
      >
        time
      </span>
      <span class="inline-block w-16 shrink-0 select-none overflow-hidden border-r border-[var(--color-border-soft)] px-3">level</span>
      <span class="inline-block select-none overflow-hidden pl-3">message</span>
    </div>
  );
}

interface RowProps {
  vrow: { index: number; start: number; size: number };
  sourceId: string;
  cache: LineCache;
  cacheVersion: () => number;
  showSource: boolean;
  highlight: RegExp | null;
  selectedBlock: { start: number; end: number } | null;
}

function Row(props: RowProps) {
  const line = () => {
    props.cacheVersion();
    return props.cache.lines.get(props.vrow.index);
  };
  const lineNo = () => line()?.lineNumber ?? props.vrow.index;
  const selected = () => {
    if (props.showSource) return false;
    const block = props.selectedBlock;
    if (block) return lineNo() >= block.start && lineNo() < block.end;
    return sessionStore.selectedLine === lineNo();
  };
  const inMultiSel = () =>
    !props.showSource && sessionStore.multiSelection.includes(lineNo());
  const bookmarked = () =>
    !props.showSource && isBookmarked(props.sourceId, lineNo());
  const level = () => line()?.level ?? null;
  // Background tint inherits across continuation lines so multi-line stack
  // traces get the same colored band as their header.
  const bgLevel = () => line()?.effectiveLevel ?? line()?.level ?? null;
  const sourceLabel = () => {
    const sid = line()?.sourceId;
    if (!sid) return null;
    return sessionStore.sources.find((s) => s.id === sid)?.label ?? sid;
  };
  const rowClass = () => {
    const lvl = bgLevel();
    const sel = selected();
    // Don't apply the level background tint when selected — selected color wins.
    const bg = sel ? "" : lvl ? LEVEL_BG[lvl] : "";
    return `flex cursor-pointer items-center ${bg} hover:bg-[var(--color-bg-hover)]`;
  };
  const rowStyle = () => {
    const base: Record<string, string> = {
      position: "absolute",
      top: "0",
      left: "0",
      transform: `translateY(${props.vrow.start}px)`,
      height: `${props.vrow.size}px`,
      width: "100%",
    };
    if (selected()) {
      base["background-color"] = sessionStore.appearance.selectedColor;
      base["box-shadow"] = `inset 2px 0 0 var(--color-accent)`;
    } else if (inMultiSel()) {
      base["background-color"] = "color-mix(in oklab, var(--color-accent) 10%, transparent)";
      base["box-shadow"] = `inset 2px 0 0 var(--color-accent)`;
    }
    return base;
  };
  const levelClass = () => {
    const lvl = level();
    return `inline-block w-16 shrink-0 select-none overflow-hidden border-r border-[var(--color-border-soft)] px-3 text-[11px] uppercase ${lvl ? LEVEL_COLOR[lvl] : "text-[var(--color-text-faint)]"}`;
  };

  return (
    <div
      style={rowStyle()}
      class={rowClass()}
      onClick={(e) => {
        if (e.shiftKey && !props.showSource) {
          toggleMultiSelection(lineNo());
        } else {
          setSession("selectedLine", lineNo());
        }
      }}
    >
      <span
        class="inline-block w-3 shrink-0 select-none text-center"
        classList={{ "text-[var(--color-level-warn)]": bookmarked() }}
        title={bookmarked() ? "Bookmarked" : ""}
      >
        {bookmarked() ? "★" : ""}
      </span>
      {props.showSource && (
        <span
          class="inline-flex w-3 shrink-0 items-center justify-center"
          title={sourceLabel() ?? ""}
        >
          <span
            class="inline-block h-2 w-2 rounded-full"
            style={{
              "background-color": line()?.sourceId
                ? colorForSource(line()!.sourceId!)
                : "transparent",
            }}
          />
        </span>
      )}
      <span
        class="inline-block shrink-0 select-none overflow-hidden border-r border-[var(--color-border-soft)] pr-2 text-right text-[var(--color-text-faint)]"
        style={{ width: "var(--num-col)" }}
      >
        {lineNo() + 1}
      </span>
      <span
        class="inline-block shrink-0 select-none overflow-hidden border-r border-[var(--color-border-soft)] px-3 text-[var(--color-text-muted)]"
        style={{ width: "var(--time-col)" }}
      >
        {displayTime(line())}
      </span>
      <span class={levelClass()}>{level() ?? ""}</span>
      <span class="overflow-hidden whitespace-pre pl-3">
        <TokenizedMessage
          text={line()?.message ?? line()?.raw ?? " "}
          highlight={props.highlight}
        />
      </span>
    </div>
  );
}
