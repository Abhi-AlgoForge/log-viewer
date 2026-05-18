import { For } from "solid-js";
import { sessionStore, setSession } from "../state/session";
import { ACTIONS, defaultBindings, displayKey } from "../services/keybindings";
import { Icon } from "./Icon";

export function KeybindingsHelp() {
  function close() {
    setSession("helpOpen", false);
  }
  const effective = (id: string) =>
    sessionStore.keybindings[id] ?? defaultBindings()[id] ?? "";

  return (
    <div
      class="fixed inset-0 z-40 flex items-start justify-center bg-black/60 backdrop-blur-sm"
      onClick={close}
    >
      <div
        class="mt-[10vh] w-[520px] max-w-[95vw] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-6 shadow-[var(--shadow-elev)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-base font-semibold text-[var(--color-text-primary)]">
            Keyboard shortcuts
          </h2>
          <button class="icon-btn" onClick={close} title="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <ul class="flex flex-col gap-1">
          <For each={ACTIONS}>
            {(a) => (
              <li class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--color-bg-hover)]">
                <div class="min-w-0">
                  <div class="text-[13px] font-medium text-[var(--color-text-primary)]">
                    {a.name}
                  </div>
                  <div class="text-[11px] text-[var(--color-text-faint)]">
                    {a.description}
                  </div>
                </div>
                <span class="shrink-0 rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-2 py-0.5 font-mono text-[12px] text-[var(--color-text-primary)]">
                  {displayKey(effective(a.id))}
                </span>
              </li>
            )}
          </For>
        </ul>
        <div class="mt-4 text-[11px] text-[var(--color-text-faint)]">
          Customize in Settings → Keybindings.
        </div>
      </div>
    </div>
  );
}
