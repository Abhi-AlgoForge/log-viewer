/// Document-style files get a rendered preview next to the raw text view.
export type DocKind = "markdown" | "json";

/// How a document source is laid out: raw text only, text + preview side by
/// side, or preview only.
export type DocViewMode = "text" | "split" | "preview";

export function docKindForName(name: string | null | undefined): DocKind | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.endsWith(".md") || n.endsWith(".markdown")) return "markdown";
  if (n.endsWith(".json")) return "json";
  return null;
}

/// Markdown opens side by side since the rendered view is the point of
/// opening it here; JSON stays on text because `.json` is also a common
/// extension for line-oriented logs.
export function defaultDocViewMode(kind: DocKind): DocViewMode {
  return kind === "markdown" ? "split" : "text";
}
