import { createStore, produce } from "solid-js/store";
import type {
  HistogramDTO,
  LogLevel,
  MergeStatusDTO,
  PatternViewDTO,
  SourceInfoDTO,
} from "../services/api";

export type { LogLevel };

export interface SourceInfo extends SourceInfoDTO {}

export interface ClusterState {
  done: boolean;
  scanned: number;
  total: number;
  patternCount: number;
  patterns: PatternViewDTO[];
}

export interface HistogramState {
  done: boolean;
  scanned: number;
  total: number;
  data: HistogramDTO | null;
}

export interface FilterSession {
  sourceId: string;
  filterId: number;
  query: string;
  scanned: number;
  total: number;
  matches: number;
  done: boolean;
  isEmptyFilter: boolean;
}

// "merge:" is a sentinel id for the active merge view; activeSourceId can
// either point to a real source id (e.g. "src-3") or this sentinel.
export const MERGE_VIEW_ID = "merge:active";

export type ViewMode = "logs" | "settings" | "diff";
export type SettingsSection = "ai" | "appearance" | "keybindings" | "storage" | "about";
export type LogOrder = "asc" | "desc";

export type TextIntensity = "soft" | "normal" | "bright";

export type LevelColorMap = Record<LogLevel, string>;

export interface AppearanceConfig {
  // Density / typography — user-preference, not theme-controlled
  lineHeight: number;
  letterSpacing: number;
  fontSize: number;
  fontFamily: string;
  /// How many lines one mouse-wheel notch should scroll the log viewer.
  /// Set to 0 to fall back to the OS / webview default.
  scrollLinesPerWheel: number;
  /// Whether the vertical time-histogram strip is rendered next to the viewer.
  /// Independent of the per-session collapsed state — turning this off hides
  /// the strip entirely.
  showHistogram: boolean;
  // Theme-controlled
  themeId: string; // "custom" when user has diverged from any preset
  accentColor: string;
  selectedColor: string;
  textIntensity: TextIntensity;
  levelColors: LevelColorMap;
}

export interface Theme {
  id: string;
  name: string;
  /// Subset of appearance fields the theme controls. Density fields are
  /// intentionally not included so they survive theme switches.
  appearance: Pick<
    AppearanceConfig,
    "accentColor" | "selectedColor" | "textIntensity" | "levelColors"
  >;
}

export const THEMES: Theme[] = [
  {
    id: "github-dark",
    name: "GitHub Dark",
    appearance: {
      accentColor: "#1f6feb",
      selectedColor: "rgba(31, 111, 235, 0.18)",
      textIntensity: "soft",
      levelColors: {
        trace: "#6e7681",
        debug: "#8b949e",
        info: "#58a6ff",
        warn: "#d29922",
        error: "#f85149",
        fatal: "#da3633",
      },
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    appearance: {
      accentColor: "#bd93f9",
      selectedColor: "rgba(189, 147, 249, 0.22)",
      textIntensity: "normal",
      levelColors: {
        trace: "#6272a4",
        debug: "#8be9fd",
        info: "#50fa7b",
        warn: "#f1fa8c",
        error: "#ff5555",
        fatal: "#ff79c6",
      },
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    appearance: {
      accentColor: "#7aa2f7",
      selectedColor: "rgba(122, 162, 247, 0.20)",
      textIntensity: "soft",
      levelColors: {
        trace: "#565f89",
        debug: "#7dcfff",
        info: "#9ece6a",
        warn: "#e0af68",
        error: "#f7768e",
        fatal: "#db4b4b",
      },
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    appearance: {
      accentColor: "#268bd2",
      selectedColor: "rgba(38, 139, 210, 0.22)",
      textIntensity: "normal",
      levelColors: {
        trace: "#586e75",
        debug: "#93a1a1",
        info: "#268bd2",
        warn: "#b58900",
        error: "#dc322f",
        fatal: "#6c71c4",
      },
    },
  },
  {
    id: "monokai",
    name: "Monokai",
    appearance: {
      accentColor: "#f92672",
      selectedColor: "rgba(249, 38, 114, 0.18)",
      textIntensity: "normal",
      levelColors: {
        trace: "#75715e",
        debug: "#66d9ef",
        info: "#a6e22e",
        warn: "#fd971f",
        error: "#f92672",
        fatal: "#e22b6f",
      },
    },
  },
];

const FIRST_THEME = THEMES[0];

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  lineHeight: 22,
  letterSpacing: 0,
  fontSize: 13,
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  scrollLinesPerWheel: 3,
  showHistogram: true,
  themeId: FIRST_THEME.id,
  accentColor: FIRST_THEME.appearance.accentColor,
  selectedColor: FIRST_THEME.appearance.selectedColor,
  textIntensity: FIRST_THEME.appearance.textIntensity,
  levelColors: { ...FIRST_THEME.appearance.levelColors },
};

export const SELECTED_COLOR_PRESETS: { label: string; value: string }[] = [
  { label: "Blue", value: "rgba(31, 111, 235, 0.18)" },
  { label: "Cyan", value: "rgba(56, 189, 248, 0.18)" },
  { label: "Green", value: "rgba(63, 185, 80, 0.18)" },
  { label: "Purple", value: "rgba(168, 85, 247, 0.20)" },
  { label: "Amber", value: "rgba(210, 153, 34, 0.20)" },
  { label: "Neutral", value: "rgba(139, 148, 158, 0.20)" },
];

export const FONT_PRESETS: { label: string; value: string }[] = [
  { label: "JetBrains Mono", value: '"JetBrains Mono", ui-monospace, monospace' },
  { label: "Fira Code", value: '"Fira Code", ui-monospace, monospace' },
  { label: "Cascadia Code", value: '"Cascadia Code", "Cascadia Mono", ui-monospace, monospace' },
  { label: "Consolas", value: '"Consolas", "Lucida Console", ui-monospace, monospace' },
  { label: "Menlo / Monaco", value: '"Menlo", "Monaco", ui-monospace, monospace' },
  { label: "System mono", value: "ui-monospace, SFMono-Regular, monospace" },
];

export const TEXT_INTENSITY: Record<TextIntensity, { label: string; color: string }> = {
  soft: { label: "Soft", color: "#a3aebb" },
  normal: { label: "Normal", color: "#c9d1d9" },
  bright: { label: "Bright", color: "#e6edf3" },
};

function loadAppearance(): AppearanceConfig {
  try {
    const raw = localStorage.getItem("log-viewer.appearance");
    if (!raw) return cloneDefault();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return cloneDefault();
    const merged: AppearanceConfig = {
      ...DEFAULT_APPEARANCE,
      ...parsed,
      // Guard nested objects against partial / corrupted data.
      levelColors: {
        ...DEFAULT_APPEARANCE.levelColors,
        ...(parsed.levelColors && typeof parsed.levelColors === "object"
          ? parsed.levelColors
          : {}),
      },
    };
    // Belt-and-braces: ensure every required string field is a string.
    if (typeof merged.accentColor !== "string") merged.accentColor = DEFAULT_APPEARANCE.accentColor;
    if (typeof merged.selectedColor !== "string") merged.selectedColor = DEFAULT_APPEARANCE.selectedColor;
    if (typeof merged.fontFamily !== "string") merged.fontFamily = DEFAULT_APPEARANCE.fontFamily;
    if (typeof merged.themeId !== "string") merged.themeId = DEFAULT_APPEARANCE.themeId;
    return merged;
  } catch (e) {
    console.warn("loadAppearance failed; using defaults", e);
    try {
      localStorage.removeItem("log-viewer.appearance");
    } catch {
      /* ignore */
    }
    return cloneDefault();
  }
}

function cloneDefault(): AppearanceConfig {
  return {
    ...DEFAULT_APPEARANCE,
    levelColors: { ...DEFAULT_APPEARANCE.levelColors },
  };
}

function loadKeybindingsAtStart(): Record<string, string> {
  try {
    const raw = localStorage.getItem("log-viewer.keybindings");
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const RECENT_FILES_LIMIT = 10;

function loadRecentFiles(): string[] {
  try {
    const raw = localStorage.getItem("log-viewer.recentFiles");
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, RECENT_FILES_LIMIT) : [];
  } catch {
    return [];
  }
}

export function pushRecentFile(path: string) {
  const cur = sessionStore.recentFiles.filter((p) => p !== path);
  const next = [path, ...cur].slice(0, RECENT_FILES_LIMIT);
  setSession("recentFiles", next);
  try {
    localStorage.setItem("log-viewer.recentFiles", JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function removeRecentFile(path: string) {
  const next = sessionStore.recentFiles.filter((p) => p !== path);
  setSession("recentFiles", next);
  try {
    localStorage.setItem("log-viewer.recentFiles", JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function loadSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem("log-viewer.savedViews");
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persistSavedViews() {
  try {
    localStorage.setItem("log-viewer.savedViews", JSON.stringify(sessionStore.savedViews));
  } catch {
    /* ignore */
  }
}

export function saveCurrentAsView(name: string, query: string, scope?: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const id = `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const next: SavedView = {
    id,
    name: trimmed,
    query,
    createdAt: Date.now(),
    ...(scope && scope !== "any" ? { scope } : {}),
  };
  setSession("savedViews", [...sessionStore.savedViews, next]);
  persistSavedViews();
}

/// Heuristic scope tag for a source — used to suggest a default scope when
/// the user saves a view, and to filter the menu.
export function scopeForActiveSource(): string {
  const active = sessionStore.sources.find((s) => s.id === sessionStore.activeSourceId);
  if (!active) return "any";
  const path = active.path?.toLowerCase() ?? active.label.toLowerCase();
  if (path.endsWith(".json") || path.endsWith(".jsonl") || path.endsWith(".ndjson")) return "json";
  if (path.includes("cbs")) return "cbs";
  if (path.endsWith(".log") || path.endsWith(".txt")) return "log";
  return "any";
}

export function viewMatchesActive(v: SavedView): boolean {
  if (!v.scope || v.scope === "any") return true;
  return scopeForActiveSource() === v.scope;
}

export function removeSavedView(id: string) {
  setSession(
    "savedViews",
    sessionStore.savedViews.filter((v) => v.id !== id),
  );
  persistSavedViews();
}

export function renameSavedView(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  setSession(
    "savedViews",
    sessionStore.savedViews.map((v) => (v.id === id ? { ...v, name: trimmed } : v)),
  );
  persistSavedViews();
}

export function triggerAction(id: string) {
  const cur = sessionStore.actionTriggers[id] ?? 0;
  setSession("actionTriggers", id, cur + 1);
}

// Any change to one of these flips the theme indicator to "Custom" — the
// user's mental model is "if anything below the theme picker changes, I'm in
// custom territory now". Themes themselves only set the color subset; density
// fields persist across theme switches.
const THEME_TRACKED_KEYS: (keyof AppearanceConfig)[] = [
  "accentColor",
  "selectedColor",
  "textIntensity",
  "levelColors",
  "lineHeight",
  "letterSpacing",
  "fontSize",
  "fontFamily",
];

export type ToastTone = "info" | "success" | "error";

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

export interface Bookmark {
  line: number;
  note?: string;
}

export interface SavedView {
  id: string;
  name: string;
  query: string;
  createdAt: number;
  /// "any" matches everywhere. Otherwise the view is hidden when the active
  /// source doesn't match the scope. Heuristic match is path-extension based.
  scope?: string;
}

interface SessionState {
  view: ViewMode;
  settingsSection: SettingsSection;
  appearance: AppearanceConfig;
  toasts: Toast[];
  logOrder: LogOrder;
  diff: { leftSourceId: string | null; rightSourceId: string | null; syncScroll: boolean };
  keybindings: Record<string, string>;
  // Bumped to request global UI actions (focus filter, open command, etc.).
  // Components opt-in by reading the matching counter in an effect.
  actionTriggers: Record<string, number>;
  recentFiles: string[];
  savedViews: SavedView[];
  sources: SourceInfo[];
  activeSourceId: string | null;
  filterQuery: string;
  filters: Record<string, FilterSession | undefined>;
  bookmarks: Record<string, Bookmark[] | undefined>;
  // follow-tail toggle per source
  following: Record<string, boolean>;
  // monotonic counter bumped each time the active source appends new lines —
  // viewer subscribes to drive auto-scroll
  tailTick: number;
  clusters: Record<string, ClusterState | undefined>;
  histograms: Record<string, HistogramState | undefined>;
  // sources selected for the timeline merge view
  mergeSelected: Record<string, boolean>;
  mergeStatus: MergeStatusDTO | null;
  selectedLine: number | null;
  /// Lines added via shift-click. Used for "generate filter from selection".
  multiSelection: number[];
  /// Request the viewer to scroll a specific line into view. `tick` is bumped
  /// to retrigger even when the same line is requested twice in a row.
  scrollTarget: { sourceId: string; line: number; tick: number } | null;
  /// Collapsed state of the right-side histogram strip — independent of the
  /// global appearance.showHistogram setting (this is per-session UI state).
  histogramCollapsed: boolean;
  helpOpen: boolean;
  /// One-time welcome shown on first launch. localStorage-backed so it
  /// never reappears once dismissed.
  showWelcome: boolean;
  /// Guided spotlight tour. Step is the index into TOUR_STEPS; -1 means
  /// the tour is not running.
  tourStep: number;
  detailsOpen: boolean;
  sidebarTab: "sources" | "patterns" | "bookmarks" | "ai";
}

const [sessionStore, setSession] = createStore<SessionState>({
  view: "logs",
  settingsSection: "ai",
  appearance: loadAppearance(),
  toasts: [],
  logOrder: "asc",
  diff: { leftSourceId: null, rightSourceId: null, syncScroll: true },
  keybindings: loadKeybindingsAtStart(),
  actionTriggers: {},
  recentFiles: loadRecentFiles(),
  savedViews: loadSavedViews(),
  sources: [],
  multiSelection: [],
  scrollTarget: null,
  histogramCollapsed: false,
  helpOpen: false,
  showWelcome: localStorage.getItem("log-viewer.welcomeDismissed") !== "1",
  tourStep: -1,
  activeSourceId: null,
  filterQuery: "",
  filters: {},
  bookmarks: {},
  following: {},
  tailTick: 0,
  clusters: {},
  histograms: {},
  mergeSelected: {},
  mergeStatus: null,
  selectedLine: null,
  detailsOpen: false,
  sidebarTab: "sources",
});

export { sessionStore, setSession };

export function addSource(s: SourceInfo) {
  const existing = sessionStore.sources.find((x) => x.id === s.id);
  if (existing) {
    // Merge — protect against a late `sourceInfo` response overwriting a
    // newer `index-progress` event with stale (smaller) counts. Preserve
    // the path if already set (sourceInfo refresh may omit it).
    const merged: SourceInfo = {
      ...existing,
      ...s,
      path: s.path ?? existing.path,
      totalLines: Math.max(existing.totalLines ?? 0, s.totalLines ?? 0),
      indexed: Math.max(existing.indexed ?? 0, s.indexed ?? 0),
      bytes: Math.max(existing.bytes ?? 0, s.bytes ?? 0),
    };
    setSession(
      "sources",
      (arr) => arr.map((x) => (x.id === s.id ? merged : x)),
    );
  } else {
    setSession("sources", (arr) => [...arr, s]);
  }
}

export function removeSource(id: string) {
  setSession(
    "sources",
    produce((arr) => {
      const ix = arr.findIndex((x) => x.id === id);
      if (ix >= 0) arr.splice(ix, 1);
    }),
  );
  setSession("filters", id, undefined);
  setSession("clusters", id, undefined);
  setSession("bookmarks", id, undefined);
  setSession("following", id, false);
  if (sessionStore.activeSourceId === id) {
    const next = sessionStore.sources[0]?.id ?? null;
    setSession("activeSourceId", next);
    setSession("selectedLine", null);
    setSession("filterQuery", "");
  }
}

export function setActiveSource(id: string | null) {
  setSession("activeSourceId", id);
  setSession("selectedLine", null);
  setSession("multiSelection", []);
  setSession("filterQuery", "");
}

export function toggleMultiSelection(line: number) {
  const cur = sessionStore.multiSelection;
  if (cur.includes(line)) {
    setSession("multiSelection", cur.filter((l) => l !== line));
  } else {
    setSession("multiSelection", [...cur, line].sort((a, b) => a - b));
  }
}

export function clearMultiSelection() {
  setSession("multiSelection", []);
}

let scrollTick = 0;
export function requestScrollTo(sourceId: string, line: number) {
  scrollTick++;
  setSession("scrollTarget", { sourceId, line, tick: scrollTick });
  setSession("selectedLine", line);
}

export function updateSourceProgress(
  id: string,
  indexed: number,
  totalLines: number,
) {
  setSession(
    "sources",
    produce((arr) => {
      const s = arr.find((x) => x.id === id);
      if (s) {
        s.indexed = indexed;
        if (totalLines > 0) s.totalLines = totalLines;
      }
    }),
  );
}

export function setFilterSession(s: FilterSession) {
  setSession("filters", s.sourceId, s);
}

export function updateFilterProgress(
  sourceId: string,
  filterId: number,
  scanned: number,
  total: number,
  matches: number,
  done: boolean,
) {
  const cur = sessionStore.filters[sourceId];
  if (!cur || cur.filterId !== filterId) return;
  setSession("filters", sourceId, {
    ...cur,
    scanned,
    total,
    matches,
    done,
  });
}

export function clearFilterFor(sourceId: string) {
  setSession("filters", sourceId, undefined);
}

export function activeSource(): SourceInfo | undefined {
  return sessionStore.sources.find((s) => s.id === sessionStore.activeSourceId);
}

export function activeFilter(): FilterSession | undefined {
  const id = sessionStore.activeSourceId;
  return id ? sessionStore.filters[id] : undefined;
}

export function sourceById(id: string | null | undefined): SourceInfo | undefined {
  if (!id) return undefined;
  return sessionStore.sources.find((s) => s.id === id);
}

export function filterFor(id: string | null | undefined): FilterSession | undefined {
  if (!id) return undefined;
  return sessionStore.filters[id];
}

export function toggleBookmark(sourceId: string, line: number) {
  const cur = sessionStore.bookmarks[sourceId];
  if (!cur || cur.length === 0) {
    setSession("bookmarks", sourceId, [{ line }]);
    return;
  }
  if (cur.some((b) => b.line === line)) {
    setSession("bookmarks", sourceId, cur.filter((b) => b.line !== line));
  } else {
    setSession(
      "bookmarks",
      sourceId,
      [...cur, { line }].sort((a, b) => a.line - b.line),
    );
  }
}

export function isBookmarked(sourceId: string, line: number): boolean {
  const arr = sessionStore.bookmarks[sourceId];
  return !!arr && arr.some((b) => b.line === line);
}

export function setBookmarkNote(sourceId: string, line: number, note: string) {
  const cur = sessionStore.bookmarks[sourceId];
  if (!cur) return;
  const ix = cur.findIndex((b) => b.line === line);
  if (ix < 0) return;
  const trimmed = note.trim();
  const updated = [...cur];
  updated[ix] = { line, ...(trimmed ? { note: trimmed } : {}) };
  setSession("bookmarks", sourceId, updated);
}

export function setMergeSelected(sourceId: string, on: boolean) {
  setSession("mergeSelected", sourceId, on);
}

export function selectedForMerge(): string[] {
  return sessionStore.sources
    .filter((s) => sessionStore.mergeSelected[s.id])
    .map((s) => s.id);
}

export function setMergeStatus(s: MergeStatusDTO | null) {
  setSession("mergeStatus", s);
}

export function updateMergeProgress(
  id: number,
  total: number,
  built: number,
  done: boolean,
) {
  const cur = sessionStore.mergeStatus;
  if (!cur || cur.id !== id) return;
  setSession("mergeStatus", { ...cur, built, totalLines: total || cur.totalLines, done });
}

// Deterministic color from a source id (stable across sessions for the same id).
export function colorForSource(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 60%)`;
}

function persistAppearance(value: AppearanceConfig) {
  try {
    localStorage.setItem("log-viewer.appearance", JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function setAppearance(patch: Partial<AppearanceConfig>) {
  const themeTouched = THEME_TRACKED_KEYS.some((k) => k in patch);
  const next: AppearanceConfig = {
    ...sessionStore.appearance,
    ...patch,
    // Flip to "custom" the moment the user diverges from the active preset —
    // unless the patch itself explicitly sets themeId (theme picker).
    themeId: "themeId" in patch
      ? (patch.themeId as string)
      : themeTouched
        ? "custom"
        : sessionStore.appearance.themeId,
  };
  setSession("appearance", next);
  persistAppearance(next);
}

export function applyTheme(themeId: string) {
  const theme = THEMES.find((t) => t.id === themeId);
  if (!theme) return;
  const next: AppearanceConfig = {
    ...sessionStore.appearance,
    ...theme.appearance,
    levelColors: { ...theme.appearance.levelColors },
    themeId: theme.id,
  };
  setSession("appearance", next);
  persistAppearance(next);
}

export function setLevelColor(level: LogLevel, color: string) {
  setAppearance({
    levelColors: { ...sessionStore.appearance.levelColors, [level]: color },
  });
}

let nextToastId = 1;

export function pushToast(tone: ToastTone, title: string, body?: string, durationMs = 6000) {
  const id = nextToastId++;
  setSession("toasts", (arr) => [...arr, { id, tone, title, body }]);
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}

export function dismissToast(id: number) {
  setSession("toasts", (arr) => arr.filter((t) => t.id !== id));
}

export function toggleLogOrder() {
  setSession("logOrder", sessionStore.logOrder === "asc" ? "desc" : "asc");
}

export function setFollowing(sourceId: string, on: boolean) {
  setSession("following", sourceId, on);
}

export function isFollowing(sourceId: string): boolean {
  return sessionStore.following[sourceId] ?? false;
}

export function updateClusterProgress(
  sourceId: string,
  scanned: number,
  total: number,
  patternCount: number,
  done: boolean,
) {
  const cur = sessionStore.clusters[sourceId];
  setSession("clusters", sourceId, {
    done,
    scanned,
    total,
    patternCount,
    patterns: cur?.patterns ?? [],
  });
}

export function updateHistogramProgress(
  sourceId: string,
  scanned: number,
  total: number,
  done: boolean,
  data: HistogramDTO | null,
) {
  const cur = sessionStore.histograms[sourceId];
  setSession("histograms", sourceId, {
    done,
    scanned,
    total,
    data: data ?? cur?.data ?? null,
  });
}

export function setPatterns(sourceId: string, patterns: PatternViewDTO[]) {
  const cur = sessionStore.clusters[sourceId];
  setSession("clusters", sourceId, {
    done: cur?.done ?? true,
    scanned: cur?.scanned ?? 0,
    total: cur?.total ?? 0,
    patternCount: patterns.length,
    patterns,
  });
}

export function onLinesAppendedFor(
  sourceId: string,
  totalLines: number,
  totalBytes: number,
) {
  setSession(
    "sources",
    produce((arr) => {
      const s = arr.find((x) => x.id === sourceId);
      if (s) {
        s.totalLines = totalLines;
        s.indexed = totalBytes;
        s.bytes = totalBytes;
      }
    }),
  );
  // Invalidate filter — a follow-up scan is required to incorporate new lines.
  setSession("filters", sourceId, undefined);
  if (sessionStore.activeSourceId === sourceId) {
    setSession("tailTick", (t) => t + 1);
  }
}
