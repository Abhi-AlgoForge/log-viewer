/// Filter DSL helpers — pure functions, no Tauri / Solid deps so they can be
/// unit tested in isolation. Mirrors the Rust tokenizer in src-tauri/src/filter.

/// Tokenize a filter DSL string the same way the Rust parser does: split on
/// whitespace, keep `/.../` regex blocks intact, and treat `\X` inside a
/// regex block as an escape so `\/` doesn't terminate it.
export function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inRe = false;
  let escapeNext = false;
  for (const c of input) {
    if (inRe && escapeNext) {
      cur += c;
      escapeNext = false;
      continue;
    }
    if (inRe && c === "\\") {
      cur += c;
      escapeNext = true;
      continue;
    }
    if (c === "/") {
      cur += c;
      if (inRe) {
        inRe = false;
        out.push(cur);
        cur = "";
      } else if (cur.length === 1) {
        inRe = true;
      }
      continue;
    }
    if (/\s/.test(c) && !inRe) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/// Derive a case-insensitive RegExp suitable for highlighting matches in
/// rendered log lines. Returns null when the filter has no text component
/// (e.g. only `level:` or `since:` terms).
export function filterHighlightRegex(query: string): RegExp | null {
  if (!query.trim()) return null;
  let regexBody: string | null = null;
  const substrings: string[] = [];
  for (const tok of tokenize(query)) {
    if (
      tok.startsWith("level:") ||
      tok.startsWith("since:") ||
      tok.startsWith("until:")
    ) {
      continue;
    }
    if (tok.length >= 2 && tok.startsWith("/") && tok.endsWith("/")) {
      regexBody = tok.slice(1, -1);
      continue;
    }
    substrings.push(tok);
  }
  if (regexBody !== null) {
    try {
      return new RegExp(regexBody, "gi");
    } catch {
      return null;
    }
  }
  if (substrings.length === 0) return null;
  const escaped = substrings
    .join(" ")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "gi");
}
