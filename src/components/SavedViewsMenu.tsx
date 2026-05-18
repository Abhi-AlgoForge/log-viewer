import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import {
  sessionStore,
  saveCurrentAsView,
  removeSavedView,
  pushToast,
  scopeForActiveSource,
  viewMatchesActive,
} from "../state/session";
import { applyFilterToActive } from "../services/filter";
import { Icon } from "./Icon";

export function SavedViewsMenu(props: {
  current: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [saveMode, setSaveMode] = createSignal(false);
  const [name, setName] = createSignal("");
  const [scope, setScope] = createSignal("any");
  let containerEl!: HTMLDivElement;

  function close() {
    setOpen(false);
    setSaveMode(false);
    setName("");
  }

  function handleOutside(e: MouseEvent) {
    if (!open()) return;
    if (containerEl && !containerEl.contains(e.target as Node)) close();
  }
  onMount(() => window.addEventListener("mousedown", handleOutside));
  onCleanup(() => window.removeEventListener("mousedown", handleOutside));

  function startSave() {
    if (!props.current.trim()) {
      pushToast("info", "Set a filter first", "There's nothing to save.");
      return;
    }
    setSaveMode(true);
    setName("");
    setScope(scopeForActiveSource());
  }

  function commitSave() {
    if (!name().trim()) return;
    saveCurrentAsView(name(), props.current, scope());
    pushToast("success", `Saved view "${name().trim()}"`);
    close();
  }

  async function apply(query: string) {
    close();
    await applyFilterToActive(query);
  }

  return (
    <div class="relative" ref={containerEl}>
      <button
        class="btn-base btn-icon"
        title="Saved views"
        onClick={() => setOpen((v) => !v)}
        disabled={props.disabled}
      >
        <span class="text-[13px] leading-none">☆</span>
      </button>
      <Show when={open()}>
        <div class="absolute right-0 top-full z-30 mt-1 w-[320px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-2 shadow-[var(--shadow-elev)]">
          <Show
            when={!saveMode()}
            fallback={
              <div class="p-2">
                <div class="mb-2 text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
                  Save current filter
                </div>
                <input
                  class="mb-2 h-9 w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-2 text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
                  placeholder="View name"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitSave();
                    else if (e.key === "Escape") close();
                  }}
                  autofocus
                />
                <div class="mb-2 truncate rounded-md bg-[var(--color-bg-elev)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-muted)]">
                  {props.current}
                </div>
                <div class="mb-2 flex items-center gap-2">
                  <label class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
                    Scope
                  </label>
                  <input
                    class="h-7 flex-1 rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-2 text-[12px] focus:border-[var(--color-accent)] focus:outline-none"
                    placeholder="any, log, json, cbs, …"
                    value={scope()}
                    onInput={(e) => setScope(e.currentTarget.value)}
                  />
                </div>
                <div class="mb-2 text-[10px] text-[var(--color-text-faint)]">
                  "any" shows everywhere. Others only show when the active source matches.
                </div>
                <div class="flex justify-end gap-1.5">
                  <button class="btn-base" onClick={() => setSaveMode(false)}>
                    Back
                  </button>
                  <button
                    class="btn-base btn-primary"
                    onClick={commitSave}
                    disabled={!name().trim()}
                  >
                    Save
                  </button>
                </div>
              </div>
            }
          >
            <div class="mb-2 flex items-center justify-between px-2 pt-1">
              <span class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
                Saved views
              </span>
              <button
                class="rounded px-2 py-0.5 text-[12px] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
                onClick={startSave}
              >
                + Save current
              </button>
            </div>
            <Show
              when={sessionStore.savedViews.filter(viewMatchesActive).length > 0}
              fallback={
                <div class="px-2 py-3 text-center text-[12px] text-[var(--color-text-muted)]">
                  No saved views for this source. Set a filter, then save it here.
                </div>
              }
            >
              <ul class="flex flex-col gap-px">
                <For each={sessionStore.savedViews.filter(viewMatchesActive)}>
                  {(v) => (
                    <li class="group flex items-stretch rounded-md hover:bg-[var(--color-bg-hover)]">
                      <button
                        class="min-w-0 flex-1 px-2 py-1.5 text-left"
                        onClick={() => apply(v.query)}
                        title={v.query}
                      >
                        <div class="flex items-baseline gap-1.5 truncate">
                          <span class="truncate text-[13px] text-[var(--color-text-primary)]">
                            {v.name}
                          </span>
                          <Show when={v.scope && v.scope !== "any"}>
                            <span class="shrink-0 rounded-full bg-[var(--color-bg-elev-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                              {v.scope}
                            </span>
                          </Show>
                        </div>
                        <div class="truncate font-mono text-[11px] text-[var(--color-text-faint)]">
                          {v.query}
                        </div>
                      </button>
                      <button
                        class="icon-btn shrink-0 self-center opacity-0 transition-opacity hover:!text-[var(--color-level-error)] group-hover:opacity-100"
                        title="Delete view"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSavedView(v.id);
                        }}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
