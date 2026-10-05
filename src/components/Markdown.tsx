import { For, Show, JSX } from "solid-js";

/// Minimal, dependency-free markdown renderer. Handles what models actually
/// emit: paragraphs, ATX headings, fenced + inline code, bullet & numbered
/// lists, blockquotes, tables, bold/italic/strike, and links. We render through JSX
/// (no innerHTML / dangerouslySetInnerHTML), so the AI output cannot inject
/// raw HTML — characters like `<` or `&` show up verbatim.

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lang: string | null; text: string }
  | { kind: "ulist"; items: string[] }
  | { kind: "olist"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; header: string[]; align: CellAlign[]; rows: string[][] }
  | { kind: "hr" };

type CellAlign = "left" | "center" | "right";

// GFM table delimiter row, e.g. `| --- | :---: | ---: |`.
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/// Split a table row on unescaped pipes, dropping the optional outer ones.
function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (line[i] === "|") {
      cells.push(cur);
      cur = "";
    } else {
      cur += line[i];
    }
  }
  cells.push(cur);
  if (cells.length > 1 && cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Fenced code (``` or ~~~)
    const fence = line.match(/^(?:```|~~~)\s*([\w-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || null;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^(?:```|~~~)\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      out.push({ kind: "code", lang, text: buf.join("\n") });
      continue;
    }
    // Table: a header row followed by a delimiter row.
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      lines[i + 1].includes("-") &&
      TABLE_DELIM.test(lines[i + 1])
    ) {
      const header = splitTableRow(line);
      const align = splitTableRow(lines[i + 1]).map<CellAlign>((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left",
      );
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      out.push({ kind: "table", header, align, rows });
      continue;
    }
    // Horizontal rule
    if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) {
      out.push({ kind: "hr" });
      i++;
      continue;
    }
    // Heading
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (h) {
      out.push({ kind: "heading", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    // Blockquote
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }
    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      out.push({ kind: "ulist", items });
      continue;
    }
    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      out.push({ kind: "olist", items });
      continue;
    }
    // Paragraph — gather until blank or block-start.
    const buf: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (
        next.trim() === "" ||
        /^(?:#{1,6}\s|>|```|~~~|\s*[-*+]\s|\s*\d+[.)]\s)/.test(next)
      ) {
        break;
      }
      buf.push(next);
      i++;
    }
    out.push({ kind: "paragraph", text: buf.join(" ") });
  }
  return out;
}

/// Inline span renderer. Handles **bold**, *italic*, _italic_, ~~strike~~,
/// `code`, and [text](url). The parser walks character-by-character and emits
/// JSX nodes, so injecting raw markup is impossible.
function renderInline(text: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  let cur = "";
  const flush = () => {
    if (cur) {
      out.push(cur);
      cur = "";
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    // Inline code: `...`
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        out.push(
          <code class="rounded bg-[var(--color-bg-elev-2)] px-1 py-0.5 font-mono text-[12px] text-[var(--color-accent)]">
            {text.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }
    // Bold: **...**
    if (ch === "*" && next === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        flush();
        out.push(
          <strong class="font-semibold text-[var(--color-text-primary)]">
            {renderInline(text.slice(i + 2, end))}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    // Italic: *...* or _..._ (require non-space after delimiter)
    if ((ch === "*" || ch === "_") && next && next.trim() !== "") {
      const end = text.indexOf(ch, i + 1);
      if (end !== -1 && text[end - 1] !== " ") {
        flush();
        out.push(<em class="italic">{renderInline(text.slice(i + 1, end))}</em>);
        i = end + 1;
        continue;
      }
    }
    // Strikethrough: ~~...~~
    if (ch === "~" && next === "~") {
      const end = text.indexOf("~~", i + 2);
      if (end !== -1) {
        flush();
        out.push(<s class="opacity-70">{renderInline(text.slice(i + 2, end))}</s>);
        i = end + 2;
        continue;
      }
    }
    // Link: [text](url)
    if (ch === "[") {
      const close = text.indexOf("](", i + 1);
      if (close !== -1) {
        const end = text.indexOf(")", close + 2);
        if (end !== -1) {
          flush();
          const label = text.slice(i + 1, close);
          const url = text.slice(close + 2, end);
          // Safety: only allow http(s) / mailto URLs.
          const safe = /^(?:https?:|mailto:)/i.test(url) ? url : "#";
          out.push(
            <a
              href={safe}
              target="_blank"
              rel="noreferrer noopener"
              class="text-[var(--color-accent)] underline decoration-dotted underline-offset-2 hover:opacity-80"
            >
              {renderInline(label)}
            </a>,
          );
          i = end + 1;
          continue;
        }
      }
    }
    cur += ch;
    i++;
  }
  flush();
  return out;
}

export function Markdown(props: { source: string; class?: string }) {
  const blocks = () => parseBlocks(props.source);
  return (
    <div class={`flex flex-col gap-2 text-[13px] leading-relaxed ${props.class ?? ""}`}>
      <For each={blocks()}>
        {(b) => {
          if (b.kind === "heading") {
            const sizes = ["text-[18px]", "text-[16px]", "text-[15px]", "text-[14px]", "text-[13px]", "text-[12px]"];
            const sizeClass = sizes[Math.min(b.level, sizes.length) - 1];
            return (
              <div class={`font-semibold text-[var(--color-text-primary)] ${sizeClass}`}>
                {renderInline(b.text)}
              </div>
            );
          }
          if (b.kind === "paragraph") {
            return <p class="text-[var(--color-text-primary)]">{renderInline(b.text)}</p>;
          }
          if (b.kind === "code") {
            return (
              <pre class="overflow-x-auto rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev-2)] p-2 font-mono text-[12px] leading-snug text-[var(--color-text-primary)]">
                <Show when={b.lang}>
                  <div class="mb-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                    {b.lang}
                  </div>
                </Show>
                <code>{b.text}</code>
              </pre>
            );
          }
          if (b.kind === "ulist") {
            return (
              <ul class="ml-4 list-disc text-[var(--color-text-primary)] marker:text-[var(--color-text-faint)]">
                <For each={b.items}>
                  {(it) => <li class="my-0.5">{renderInline(it)}</li>}
                </For>
              </ul>
            );
          }
          if (b.kind === "olist") {
            return (
              <ol class="ml-4 list-decimal text-[var(--color-text-primary)] marker:text-[var(--color-text-faint)]">
                <For each={b.items}>
                  {(it) => <li class="my-0.5">{renderInline(it)}</li>}
                </For>
              </ol>
            );
          }
          if (b.kind === "quote") {
            return (
              <blockquote class="border-l-2 border-[var(--color-accent)]/40 pl-3 text-[var(--color-text-secondary)] italic">
                {renderInline(b.text)}
              </blockquote>
            );
          }
          if (b.kind === "table") {
            const cellClass = "border border-[var(--color-border)] px-2 py-1 align-top";
            return (
              <div class="overflow-x-auto">
                <table class="border-collapse text-[var(--color-text-primary)]">
                  <thead>
                    <tr>
                      <For each={b.header}>
                        {(cell, ix) => (
                          <th
                            class={`${cellClass} bg-[var(--color-bg-elev-2)] font-semibold`}
                            style={{ "text-align": b.align[ix()] ?? "left" }}
                          >
                            {renderInline(cell)}
                          </th>
                        )}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={b.rows}>
                      {(row) => (
                        <tr>
                          <For each={row}>
                            {(cell, ix) => (
                              <td
                                class={cellClass}
                                style={{ "text-align": b.align[ix()] ?? "left" }}
                              >
                                {renderInline(cell)}
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            );
          }
          return <hr class="my-1 border-[var(--color-border-soft)]" />;
        }}
      </For>
    </div>
  );
}
