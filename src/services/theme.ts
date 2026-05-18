import type { AppearanceConfig } from "../state/session";

/// Push theme-controlled appearance values onto the document root as CSS
/// custom properties so the whole UI (level chips, accent borders, soft
/// accent tints) tracks the active theme without component-by-component
/// wiring.
export function applyAppearanceVars(a: AppearanceConfig | null | undefined) {
  if (!a) return;
  try {
    const root = document.documentElement;
    if (a.accentColor) root.style.setProperty("--color-accent", a.accentColor);
    if (a.selectedColor) root.style.setProperty("--color-selected-bg", a.selectedColor);
    if (a.levelColors && typeof a.levelColors === "object") {
      for (const [level, color] of Object.entries(a.levelColors)) {
        if (typeof color === "string") {
          root.style.setProperty(`--color-level-${level}`, color);
        }
      }
    }
  } catch (e) {
    console.warn("applyAppearanceVars failed", e);
  }
}
