import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js";
import { sessionStore, sourceById } from "../state/session";
import { api } from "../services/api";
import type { DocKind } from "../utils/docKind";
import { Markdown } from "./Markdown";

/// The preview needs the whole document in the webview, so cap what we pull
/// across IPC. Larger files stay usable through the regular text view.
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const FETCH_CHUNK = 2000;
/// Children rendered per JSON container before a "show more" row.
const JSON_PAGE = 200;

/// Rendered view of a document source: formatted markdown, or a collapsible
/// tree for JSON. `centered` constrains the reading width when the preview
/// has the whole viewer to itself.
export function DocPreview(props: { sourceId: string; kind: DocKind; centered: boolean }) {
  const [text, setText] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const source = () => sourceById(props.sourceId);
  const tooLarge = () => (source()?.bytes ?? 0) > MAX_PREVIEW_BYTES;

  let loadedId: string | null = null;
  let token = 0;

  // Reload whenever the source changes or its line count moves (indexing
  // finishing, live-tail appends).
  createEffect(() => {
    const id = props.sourceId;
    const total = source()?.totalLines ?? 0;
    if (id !== loadedId) {
      loadedId = id;
      setText(null);
      setError(null);
    }
    const mine = ++token;
    if (tooLarge()) return;
    void (async () => {
      try {
        const parts: string[] = [];
        for (let start = 0; start < total; start += FETCH_CHUNK) {
          const lines = await api.getLines(id, start, FETCH_CHUNK);
          if (mine !== token) return;
          if (lines.length === 0) break;
          for (const l of lines) parts.push(l.raw);
        }
        if (mine !== token) return;
        setText(parts.join("\n"));
        setError(null);
      } catch (e) {
        if (mine === token) setError(String(e));
      }
    })();
  });

  return (
    <div class="min-h-0 min-w-0 flex-1 overflow-auto border-l border-[var(--color-border-soft)] bg-[var(--color-bg-base)]">
      <div class="p-5" classList={{ "mx-auto max-w-4xl": props.centered }}>
        <Switch>
          <Match when={tooLarge()}>
            <Notice>
              This file is larger than {MAX_PREVIEW_BYTES / (1024 * 1024)} MB, so the preview is
              disabled. The text view still works.
            </Notice>
          </Match>
          <Match when={error()}>
            <Notice>Couldn't load the preview: {error()}</Notice>
          </Match>
          <Match when={!text()}>
            <Notice>Nothing to preview yet.</Notice>
          </Match>
          <Match when={props.kind === "markdown"}>
            <Markdown source={text()!} class="!gap-3 !text-[14px]" />
          </Match>
          <Match when={props.kind === "json"}>
            <JsonPreview text={text()!} />
          </Match>
        </Switch>
      </div>
    </div>
  );
}

function Notice(props: { children: any }) {
  return <div class="text-[13px] text-[var(--color-text-muted)]">{props.children}</div>;
}

type ParsedJson =
  | { ok: true; value: unknown; lineDelimited: boolean }
  | { ok: false; error: string };

/// Parse as a single document; if that fails, fall back to one value per
/// line, since `.json` is often used for line-delimited logs too.
function parseJson(text: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(text), lineDelimited: false };
  } catch (e) {
    const rows = text.split("\n").filter((l) => l.trim() !== "");
    if (rows.length > 1) {
      try {
        return { ok: true, value: rows.map((r) => JSON.parse(r)), lineDelimited: true };
      } catch {
        /* report the whole-document error below */
      }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function JsonPreview(props: { text: string }) {
  const parsed = createMemo(() => parseJson(props.text));
  return (
    <Show
      when={(() => {
        const p = parsed();
        return p.ok ? p : null;
      })()}
      fallback={
        <Notice>
          Not valid JSON: {(parsed() as { ok: false; error: string }).error}
        </Notice>
      }
    >
      {(p) => (
        <div
          class="font-mono leading-relaxed"
          style={{
            "font-family": sessionStore.appearance.fontFamily,
            "font-size": `${sessionStore.appearance.fontSize}px`,
          }}
        >
          <Show when={p().lineDelimited}>
            <div class="mb-2 font-sans text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
              Line-delimited JSON — one entry per line
            </div>
          </Show>
          <JsonNode value={p().value} depth={0} />
        </div>
      )}
    </Show>
  );
}

function isContainer(v: unknown): v is object {
  return typeof v === "object" && v !== null;
}

function JsonNode(props: { name?: string; value: unknown; depth: number }) {
  const [open, setOpen] = createSignal(props.depth < 2);
  const [limit, setLimit] = createSignal(JSON_PAGE);
  const isArray = () => Array.isArray(props.value);
  const entries = createMemo<[string, unknown][]>(() => {
    const v = props.value;
    if (!isContainer(v)) return [];
    return Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v);
  });
  const summary = () => {
    const n = entries().length;
    return isArray() ? `${n} ${n === 1 ? "item" : "items"}` : `${n} ${n === 1 ? "key" : "keys"}`;
  };
  const label = () => (
    <Show when={props.name !== undefined}>
      <span class="text-[var(--color-text-secondary)]">{JSON.stringify(props.name)}</span>
      <span class="text-[var(--color-text-faint)]">: </span>
    </Show>
  );

  return (
    <Show
      when={isContainer(props.value)}
      fallback={
        <div class="whitespace-pre-wrap break-all pl-4">
          {label()}
          <JsonScalar value={props.value} />
        </div>
      }
    >
      <div>
        <button
          class="flex w-full items-baseline text-left hover:bg-[var(--color-bg-hover)]"
          onClick={() => setOpen((v) => !v)}
        >
          <span class="inline-block w-4 shrink-0 select-none text-[var(--color-text-faint)]">
            {open() ? "▾" : "▸"}
          </span>
          <span>
            {label()}
            <span class="text-[var(--color-text-muted)]">{isArray() ? "[" : "{"}</span>
            <Show when={!open()}>
              <span class="text-[var(--color-text-faint)]">
                {" "}
                {summary()}{" "}
              </span>
              <span class="text-[var(--color-text-muted)]">{isArray() ? "]" : "}"}</span>
            </Show>
          </span>
        </button>
        <Show when={open()}>
          <div class="ml-[7px] border-l border-[var(--color-border-soft)] pl-3">
            <For each={entries().slice(0, limit())}>
              {([key, value]) => (
                <JsonNode
                  name={isArray() ? undefined : key}
                  value={value}
                  depth={props.depth + 1}
                />
              )}
            </For>
            <Show when={entries().length > limit()}>
              <button
                class="pl-4 text-[var(--color-accent)] hover:underline"
                onClick={() => setLimit((n) => n + JSON_PAGE)}
              >
                Show {Math.min(JSON_PAGE, entries().length - limit())} more (
                {entries().length - limit()} hidden)
              </button>
            </Show>
          </div>
          <div class="pl-4 text-[var(--color-text-muted)]">{isArray() ? "]" : "}"}</div>
        </Show>
      </div>
    </Show>
  );
}

function JsonScalar(props: { value: unknown }) {
  const color = () => {
    switch (typeof props.value) {
      case "string":
        return "var(--color-success)";
      case "number":
        return "var(--color-level-warn)";
      default:
        return "var(--color-level-info)"; // true / false / null
    }
  };
  return <span style={{ color: color() }}>{JSON.stringify(props.value)}</span>;
}
