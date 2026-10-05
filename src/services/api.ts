import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface SourceInfoDTO {
  id: string;
  label: string;
  kind: "file" | "stdin" | "ssh" | "kubectl" | "journalctl" | "cloudwatch" | "gcp";
  totalLines: number;
  bytes: number;
  indexed: number;
  live: boolean;
  path?: string | null;
}

export interface BookmarkSerDTO {
  line: number;
  note?: string;
}

export interface SourceStateDTO {
  bookmarks: BookmarkSerDTO[];
  lastFilter?: string | null;
}

export interface WorkspaceStateDTO {
  sources: Record<string, SourceStateDTO>;
  lastSession: string[];
  lastActive?: string | null;
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface RawLineDTO {
  lineNumber: number;
  raw: string;
  timestamp: number | null;
  timestampStr: string | null;
  level: LogLevel | null;
  message: string | null;
}

export interface IndexProgressDTO {
  sourceId: string;
  indexed: number;
  total: number;
  lineCount: number;
  done: boolean;
}

export interface FilterProgressDTO {
  sourceId: string;
  filterId: number;
  scanned: number;
  total: number;
  matches: number;
  done: boolean;
}

export interface FilterStatusDTO {
  filterId: number;
  scanned: number;
  total: number;
  matches: number;
  done: boolean;
  isEmptyFilter: boolean;
}

export interface LinesAppendedDTO {
  sourceId: string;
  addedLines: number;
  totalLines: number;
  totalBytes: number;
}

export interface ClusterProgressDTO {
  sourceId: string;
  scanned: number;
  total: number;
  patternCount: number;
  done: boolean;
}

export interface PatternViewDTO {
  id: number;
  template: string;
  regex: string;
  count: number;
  sampleLines: number[];
  level: LogLevel | null;
}

export interface MergeStatusDTO {
  id: number;
  sources: string[];
  built: number;
  totalLines: number;
  done: boolean;
}

export interface MergeProgressDTO {
  id: number;
  scanned: number;
  total: number;
  built: number;
  done: boolean;
}

export type AiProviderId = "anthropic" | "openai" | "deepseek";

/// Redacted provider settings as returned by the backend — the stored key
/// itself never reaches the frontend, only whether one is set.
export interface ProviderSettingsDTO {
  hasKey?: boolean;
  baseUrl?: string | null;
  fastModel?: string | null;
  smartModel?: string | null;
}

/// Settings write. A null/missing `apiKey` keeps the stored key; `clearKey`
/// removes it.
export interface ProviderSettingsUpdateDTO {
  apiKey?: string | null;
  clearKey?: boolean;
  baseUrl?: string | null;
  fastModel?: string | null;
  smartModel?: string | null;
}

export interface AiConfigDTO {
  activeProvider: AiProviderId | string;
  providers: Partial<Record<AiProviderId, ProviderSettingsDTO>>;
}

export interface StorageEntryDTO {
  path: string;
  size: number;
}

export interface StorageInfoDTO {
  configPath: string;
  tempDir: string;
  tempFiles: StorageEntryDTO[];
  tempBytes: number;
  sourceCount: number;
  sourceBytes: number;
  sourceLines: number;
}

export interface JsonFieldStatDTO {
  name: string;
  samples: string[];
  occurrences: number;
}

export interface AiChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSeedDTO {
  system: string;
  user: string;
  speed: "fast" | "smart";
  maxTokens: number;
  temperature: number;
}

export interface HistogramBucketDTO {
  startMs: number;
  total: number;
  byLevel: Record<string, number>;
  firstLine: number;
}

export interface HistogramDTO {
  bucketMs: number;
  startMs: number;
  endMs: number;
  buckets: HistogramBucketDTO[];
  noTimestamp: number;
  totalLines: number;
  sampled: boolean;
  stride: number;
}

export interface HistogramProgressDTO {
  sourceId: string;
  scanned: number;
  total: number;
  done: boolean;
  histogram: HistogramDTO | null;
}

export interface MergeLineDTO {
  sourceId: string;
  sourceIdx: number;
  lineNumber: number;
  timestamp: number | null;
  timestampStr: string | null;
  level: LogLevel | null;
  raw: string;
  message: string | null;
}

export const api = {
  openFile: (path: string) => invoke<SourceInfoDTO>("open_file", { path }),
  openCommand: (label: string, cmdline: string) =>
    invoke<SourceInfoDTO>("open_command", { label, cmdline }),
  closeSource: (sourceId: string) => invoke<void>("close_source", { sourceId }),
  sourceInfo: (sourceId: string) => invoke<SourceInfoDTO>("source_info", { sourceId }),
  getLines: (sourceId: string, start: number, count: number) =>
    invoke<RawLineDTO[]>("get_lines", { sourceId, start, count }),
  applyFilter: (sourceId: string, query: string) =>
    invoke<FilterStatusDTO>("apply_filter", { sourceId, query }),
  getFilteredLines: (
    sourceId: string,
    filterId: number,
    start: number,
    count: number,
  ) =>
    invoke<RawLineDTO[]>("get_filtered_lines", {
      sourceId,
      filterId,
      start,
      count,
    }),
  clearFilter: (sourceId: string) => invoke<void>("clear_filter", { sourceId }),
  startTail: (sourceId: string) => invoke<void>("start_tail", { sourceId }),
  stopTail: (sourceId: string) => invoke<void>("stop_tail", { sourceId }),
  clusterSource: (sourceId: string) => invoke<void>("cluster_source", { sourceId }),
  getPatterns: (sourceId: string) =>
    invoke<PatternViewDTO[]>("get_patterns", { sourceId }),
  aiGetConfig: () => invoke<AiConfigDTO>("ai_get_config"),
  aiSetProviderSettings: (provider: string, settings: ProviderSettingsUpdateDTO) =>
    invoke<void>("ai_set_provider_settings", { provider, settings }),
  aiSetActiveProvider: (provider: string) =>
    invoke<void>("ai_set_active_provider", { provider }),
  aiNlFilter: (sourceId: string, prompt: string) =>
    invoke<string>("ai_nl_filter", { sourceId, prompt }),
  aiExplainLine: (sourceId: string, lineNumber: number) =>
    invoke<string>("ai_explain_line", { sourceId, lineNumber }),
  aiExplainLines: (sourceId: string, lineNumbers: number[]) =>
    invoke<string>("ai_explain_lines", { sourceId, lineNumbers }),
  aiSummarizePatterns: (sourceId: string) =>
    invoke<string>("ai_summarize_patterns", { sourceId }),
  aiRootCause: (sourceId: string, lineNumber: number) =>
    invoke<string>("ai_root_cause", { sourceId, lineNumber }),
  aiRootCauseLines: (sourceId: string, lineNumbers: number[]) =>
    invoke<string>("ai_root_cause_lines", { sourceId, lineNumbers }),
  aiSeedExplain: (sourceId: string, lineNumbers: number[]) =>
    invoke<ChatSeedDTO>("ai_seed_explain", { sourceId, lineNumbers }),
  aiSeedRootCause: (sourceId: string, lineNumbers: number[]) =>
    invoke<ChatSeedDTO>("ai_seed_root_cause", { sourceId, lineNumbers }),
  aiSeedSummarizePatterns: (sourceId: string) =>
    invoke<ChatSeedDTO>("ai_seed_summarize_patterns", { sourceId }),
  aiChat: (
    system: string,
    messages: AiChatMessage[],
    speed: "fast" | "smart",
    maxTokens?: number,
    temperature?: number,
  ) => invoke<string>("ai_chat", { system, messages, speed, maxTokens, temperature }),
  aiRegexFromExamples: (examples: string[]) =>
    invoke<string>("ai_regex_from_examples", { examples }),
  discoverFields: (sourceId: string) =>
    invoke<JsonFieldStatDTO[]>("discover_fields", { sourceId }),
  computeHistogram: (sourceId: string) => invoke<void>("compute_histogram", { sourceId }),
  storageInfo: () => invoke<StorageInfoDTO>("storage_info"),
  clearTempFiles: () => invoke<number>("clear_temp_files"),
  loadWorkspace: () => invoke<WorkspaceStateDTO>("load_workspace"),
  saveSourceState: (path: string, state: SourceStateDTO) =>
    invoke<void>("save_source_state", { path, state }),
  saveLastSession: (paths: string[], active: string | null) =>
    invoke<void>("save_last_session", { paths, active }),
  exportSlice: (sourceId: string, destPath: string, format: "raw" | "jsonl") =>
    invoke<{ linesWritten: number; bytesWritten: number }>("export_slice", {
      sourceId,
      destPath,
      format,
    }),
  startDirWatch: (path: string) => invoke<void>("start_dir_watch", { path }),
  stopDirWatch: (path: string) => invoke<void>("stop_dir_watch", { path }),
  listDirWatches: () => invoke<string[]>("list_dir_watches"),
  startMerge: (sourceIds: string[]) =>
    invoke<MergeStatusDTO>("start_merge", { sourceIds }),
  stopMerge: () => invoke<void>("stop_merge"),
  mergeStatus: () => invoke<MergeStatusDTO | null>("merge_status"),
  getMergeLines: (start: number, count: number) =>
    invoke<MergeLineDTO[]>("get_merge_lines", { start, count }),
  appVersion: () => invoke<string>("app_version"),
};

export function onIndexProgress(
  cb: (p: IndexProgressDTO) => void,
): Promise<UnlistenFn> {
  return listen<IndexProgressDTO>("index-progress", (e) => cb(e.payload));
}

export function onFilterProgress(
  cb: (p: FilterProgressDTO) => void,
): Promise<UnlistenFn> {
  return listen<FilterProgressDTO>("filter-progress", (e) => cb(e.payload));
}

export function onLinesAppended(
  cb: (p: LinesAppendedDTO) => void,
): Promise<UnlistenFn> {
  return listen<LinesAppendedDTO>("lines-appended", (e) => cb(e.payload));
}

export function onClusterProgress(
  cb: (p: ClusterProgressDTO) => void,
): Promise<UnlistenFn> {
  return listen<ClusterProgressDTO>("cluster-progress", (e) => cb(e.payload));
}

export function onMergeProgress(
  cb: (p: MergeProgressDTO) => void,
): Promise<UnlistenFn> {
  return listen<MergeProgressDTO>("merge-progress", (e) => cb(e.payload));
}

export function onHistogramProgress(
  cb: (p: HistogramProgressDTO) => void,
): Promise<UnlistenFn> {
  return listen<HistogramProgressDTO>("histogram-progress", (e) => cb(e.payload));
}
