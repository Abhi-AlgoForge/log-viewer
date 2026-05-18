import { Show, createSignal } from "solid-js";
import { api } from "../services/api";
import { sessionStore, setSession } from "../state/session";
import { applyFilterToActive } from "../services/filter";
import { Icon } from "./Icon";

export function AskAiPanel(props: { onClose: () => void }) {
  const [prompt, setPrompt] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [translated, setTranslated] = createSignal<string | null>(null);

  async function submit() {
    const sid = sessionStore.activeSourceId;
    if (!sid) {
      setError("Open a source first.");
      return;
    }
    if (prompt().trim() === "") return;
    setBusy(true);
    setError(null);
    setTranslated(null);
    try {
      const filter = (await api.aiNlFilter(sid, prompt())).trim();
      if (!filter) {
        setError("Couldn't translate that — try rephrasing.");
        return;
      }
      setTranslated(filter);
      setSession("filterQuery", filter);
      await applyFilterToActive(filter);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class="fixed inset-0 z-40 flex items-start justify-center bg-black/60 backdrop-blur-sm"
      onClick={props.onClose}
    >
      <div
        class="mt-[10vh] flex w-[640px] max-w-[95vw] flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-6 shadow-[var(--shadow-elev)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-[var(--color-text-primary)]">
            ✨ Filter from natural language
          </h2>
          <button class="icon-btn" onClick={props.onClose} title="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <p class="text-[13px] text-[var(--color-text-muted)]">
          Describe what you want to see — the AI translates to the filter DSL.
          Try: <em>"auth errors in the last 5 minutes"</em> or{" "}
          <em>"all requests that returned 5xx since an hour ago"</em>.
        </p>
        <input
          class="h-10 w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-3 text-[14px] focus:border-[var(--color-accent)] focus:outline-none"
          placeholder="errors mentioning timeout in the last 10 minutes"
          value={prompt()}
          onInput={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            else if (e.key === "Escape") props.onClose();
          }}
          autofocus
        />
        <Show when={translated()}>
          <div class="rounded-md border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-3 py-2 font-mono text-[13px] text-[var(--color-text-primary)]">
            → {translated()}
          </div>
        </Show>
        <Show when={error()}>
          <div class="rounded-md border border-[var(--color-level-error)]/40 bg-[var(--color-level-error)]/10 px-3 py-2 text-[12px] text-[var(--color-level-error)]">
            {error()}
          </div>
        </Show>
        <div class="flex justify-end gap-2">
          <button class="btn-base" onClick={props.onClose} disabled={busy()}>
            Close
          </button>
          <button
            class="btn-base btn-primary"
            onClick={submit}
            disabled={busy() || prompt().trim() === ""}
          >
            {busy() ? "Asking…" : "Translate & apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
