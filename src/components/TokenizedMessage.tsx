import { For } from "solid-js";
import { applyFilterToActive } from "../services/filter";

// UUID, plus long hex (≥16 hex chars) which is common for request IDs in
// services that don't emit canonical UUIDs.
const TRACE_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-fA-F]{16,})/g;

type Segment =
  | { kind: "text"; text: string }
  | { kind: "trace"; text: string }
  | { kind: "highlight"; text: string };

function splitByTrace(text: string): Segment[] {
  if (!text) return [];
  const out: Segment[] = [];
  let last = 0;
  TRACE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TRACE_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "trace", text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

function split(text: string, highlight: RegExp | null | undefined): Segment[] {
  if (!text) return [];
  if (!highlight) return splitByTrace(text);
  const out: Segment[] = [];
  let last = 0;
  highlight.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = highlight.exec(text)) !== null) {
    if (m.index > last) {
      for (const seg of splitByTrace(text.slice(last, m.index))) out.push(seg);
    }
    if (m[0].length > 0) {
      out.push({ kind: "highlight", text: m[0] });
      last = m.index + m[0].length;
    } else {
      highlight.lastIndex++;
    }
  }
  if (last < text.length) {
    for (const seg of splitByTrace(text.slice(last))) out.push(seg);
  }
  return out;
}

export function TokenizedMessage(props: {
  text: string;
  highlight?: RegExp | null;
}) {
  const segs = () => split(props.text, props.highlight);
  return (
    <span>
      <For each={segs()}>
        {(s) => {
          if (s.kind === "trace") {
            return (
              <span
                class="cursor-pointer rounded-[3px] bg-[var(--color-bg-elev)] px-[2px] text-[var(--color-accent)] hover:underline"
                title={`Follow trace: ${s.text}`}
                onClick={(e) => {
                  e.stopPropagation();
                  applyFilterToActive(s.text);
                }}
              >
                {s.text}
              </span>
            );
          }
          if (s.kind === "highlight") {
            return (
              <span class="rounded-[2px] bg-[var(--color-highlight-bg)] px-[1px] text-[var(--color-highlight-fg)]">
                {s.text}
              </span>
            );
          }
          return <span>{s.text}</span>;
        }}
      </For>
    </span>
  );
}
