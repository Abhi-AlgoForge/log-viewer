import { For } from "solid-js";
import { sessionStore, dismissToast } from "../state/session";
import { Icon } from "./Icon";

const TONE_CLASS: Record<string, string> = {
  info: "border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]",
  success:
    "border-[var(--color-success)]/40 bg-[color-mix(in_oklab,var(--color-success)_15%,transparent)] text-[var(--color-text-primary)]",
  error:
    "border-[var(--color-level-error)]/40 bg-[color-mix(in_oklab,var(--color-level-error)_15%,transparent)] text-[var(--color-text-primary)]",
};

export function Toasts() {
  return (
    <div class="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[380px] max-w-[90vw] flex-col gap-2">
      <For each={sessionStore.toasts}>
        {(t) => (
          <div
            class={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-[var(--shadow-elev)] backdrop-blur-sm ${TONE_CLASS[t.tone] ?? TONE_CLASS.info}`}
          >
            <div class="min-w-0 flex-1">
              <div class="text-[13px] font-semibold">{t.title}</div>
              {t.body && (
                <div class="mt-1 break-words text-[12px] text-[var(--color-text-secondary)]">
                  {t.body}
                </div>
              )}
            </div>
            <button
              class="icon-btn shrink-0"
              onClick={() => dismissToast(t.id)}
              title="Dismiss"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
