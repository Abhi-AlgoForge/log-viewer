import { sessionStore, setSession } from "../state/session";

export interface ActionDef {
  id: string;
  name: string;
  description: string;
  default: string;
}

// Keep defaults in the same canonical form `formatKey` emits — modifiers
// capitalized, trailing letter lower-cased. Otherwise the lookup misses.
export const ACTIONS: ActionDef[] = [
  { id: "bookmark", name: "Toggle bookmark", description: "Bookmark or unbookmark the selected line", default: "b" },
  { id: "focusFilter", name: "Focus filter", description: "Move cursor to the filter bar", default: "/" },
  { id: "clearFilter", name: "Clear filter", description: "Clear the current filter query", default: "Escape" },
  { id: "toggleDetails", name: "Toggle details panel", description: "Show/hide the right details panel", default: "d" },
  { id: "toggleFollow", name: "Toggle follow tail", description: "Start/stop auto-scrolling to new lines", default: "t" },
  { id: "toggleOrder", name: "Toggle log order", description: "Flip between newest-first and oldest-first", default: "o" },
  { id: "openFile", name: "Open file", description: "Show the file picker", default: "Ctrl+o" },
  { id: "openCommand", name: "Open command", description: "Open the command-source dialog (ssh, kubectl, etc.)", default: "Ctrl+k" },
  { id: "openSettings", name: "Open settings", description: "Toggle the settings view", default: "Ctrl+," },
  { id: "askAi", name: "Ask AI", description: "Open the natural-language filter dialog", default: "Shift+a" },
  { id: "help", name: "Keyboard help", description: "Show all keyboard shortcuts", default: "?" },
];

/// Bring a possibly-uppercase binding (e.g. legacy "Ctrl+O" saved before the
/// case normalization) into the canonical form so it actually matches what
/// `formatKey` produces at runtime.
export function normalize(combo: string): string {
  if (!combo) return "";
  const parts = combo.split("+");
  const last = parts[parts.length - 1];
  const fixed = last.length === 1 ? last.toLowerCase() : last;
  return [...parts.slice(0, -1), fixed].join("+");
}

export type Bindings = Record<string, string>;

export function defaultBindings(): Bindings {
  const out: Bindings = {};
  for (const a of ACTIONS) out[a.id] = a.default;
  return out;
}

export function loadBindings(): Bindings {
  try {
    const raw = localStorage.getItem("log-viewer.keybindings");
    if (!raw) return defaultBindings();
    const parsed = JSON.parse(raw) as Bindings;
    const cleaned: Bindings = {};
    for (const [id, combo] of Object.entries(parsed)) {
      cleaned[id] = normalize(combo);
    }
    return { ...defaultBindings(), ...cleaned };
  } catch {
    return defaultBindings();
  }
}

export function saveBindings(b: Bindings) {
  try {
    localStorage.setItem("log-viewer.keybindings", JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

/// Build a canonical "Ctrl+Shift+K" style string from a KeyboardEvent.
/// Modifiers always appear in the order Ctrl > Alt > Shift > Meta. Letter
/// keys are lower-cased so "B" and "b" hash the same; punctuation and named
/// keys (Escape, ArrowLeft) are kept verbatim.
export function formatKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  let key = e.key;
  if (key.length === 1) key = key.toLowerCase();
  // Skip modifier-only keypresses
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return "";
  parts.push(key);
  return parts.join("+");
}

/// Display-friendly form. Capitalize the trailing key for readability.
export function displayKey(combo: string): string {
  if (!combo) return "—";
  const parts = combo.split("+");
  const last = parts[parts.length - 1];
  const display = last.length === 1 ? last.toUpperCase() : last;
  return [...parts.slice(0, -1), display].join(" + ");
}

export function findAction(bindings: Bindings, key: string): string | null {
  if (!key) return null;
  for (const [actionId, combo] of Object.entries(bindings)) {
    if (combo === key) return actionId;
  }
  return null;
}

export function setBinding(actionId: string, combo: string) {
  const next = { ...sessionStore.keybindings, [actionId]: normalize(combo) };
  setSession("keybindings", next);
  saveBindings(next);
}

/// Returns true when a combo includes any non-Shift modifier — used to decide
/// whether a shortcut should still fire while the user is typing in an input.
export function hasModifier(combo: string): boolean {
  return combo.includes("Ctrl+") || combo.includes("Alt+") || combo.includes("Meta+");
}

export function resetBindings() {
  const next = defaultBindings();
  setSession("keybindings", next);
  saveBindings(next);
}
