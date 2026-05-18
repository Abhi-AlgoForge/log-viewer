import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { sessionStore, setSession } from "../state/session";

interface TourStep {
  /// CSS selector for the element to spotlight. null = centered modal-style.
  target: string | null;
  title: string;
  body: string;
  /// Preferred tooltip placement. The tour falls back to whatever side has
  /// the most room if the preferred side is clipped.
  placement?: "below" | "above" | "right" | "left" | "center";
  /// Optional side effect to run when the step appears (e.g. open the
  /// sidebar to a specific tab so the user sees what's being described).
  onEnter?: () => void;
}

const TOUR_STEPS: TourStep[] = [
  {
    target: null,
    placement: "center",
    title: "Welcome to Log Viewer",
    body: "Quick walkthrough of the main features. Takes ~30 seconds. You can skip anytime and replay later from Settings → About.",
  },
  {
    target: '[data-tour="open-file"]',
    placement: "below",
    title: "Open a file",
    body: "Pick any .log, .txt, .ndjson, .json — or compressed .gz / .zst / .bz2. Drag-drop onto the window also works.",
  },
  {
    target: '[data-tour="open-command"]',
    placement: "below",
    title: "Stream from a command",
    body: "Run ssh / kubectl logs / journalctl / docker logs / any program — its stdout flows in as a live source. Presets included.",
  },
  {
    target: '[data-tour="watch-dir"]',
    placement: "below",
    title: "Watch a folder",
    body: "Point at a directory and new files appear automatically as sources. Great for log rotations or services that drop files.",
  },
  {
    target: '[data-tour="filter"]',
    placement: "below",
    title: "Filter DSL",
    body: "Combine terms: level:error  since:5m  /regex/  bare words for substring. Matches are highlighted inline.",
  },
  {
    target: '[data-tour="saved-views"]',
    placement: "below",
    title: "Saved views",
    body: "Star to save the current filter as a named view. Tag with a scope (json / cbs / any) so the menu only shows relevant ones.",
  },
  {
    target: '[data-tour="ask-ai"]',
    placement: "below",
    title: "Ask AI",
    body: "Describe what you want in plain English; the model translates to the filter DSL. Anthropic / OpenAI / DeepSeek supported.",
  },
  {
    target: '[data-tour="follow"]',
    placement: "below",
    title: "Follow tail",
    body: "Auto-scroll to new lines as they arrive. Works in both asc and desc display order.",
  },
  {
    target: '[data-tour="order"]',
    placement: "below",
    title: "Newest vs oldest first",
    body: "Flip the log order. Live tail respects the direction — new lines come in at top or bottom accordingly.",
  },
  {
    target: '[data-tour="export"]',
    placement: "below",
    title: "Export current view",
    body: "Save the filtered slice (or full source) as plain text or JSONL. Streams to disk, so multi-GB exports stay flat on memory.",
  },
  {
    target: '[data-tour="diff"]',
    placement: "below",
    title: "Diff mode",
    body: "Compare two sources side-by-side with synchronized scrolling. Useful for before/after deploy debugging.",
  },
  {
    target: '[data-tour="details"]',
    placement: "below",
    title: "Details panel",
    body: "Inspect any selected line — get raw text, parsed fields, and trigger ✨ Explain or 🔍 Root cause AI actions.",
  },
  {
    target: '[data-tour="settings"]',
    placement: "below",
    title: "Settings",
    body: "Theme, fonts, scroll speed, per-level colors, keybindings, AI providers, storage management — all here.",
  },
  {
    target: '[data-tour="sidebar"]',
    placement: "right",
    title: "Sidebar",
    body: "Sources, Patterns (auto-clusters templates), Bookmarks with notes, and AI anomaly summary.",
  },
  {
    target: null,
    placement: "center",
    title: "You're set",
    body: "Press ? any time to see all keyboard shortcuts. Your bookmarks, filters, and open files persist across launches.",
  },
];

export const TOUR_TOTAL = TOUR_STEPS.length;

export function startTour() {
  setSession("tourStep", 0);
}

export function nextStep() {
  const next = sessionStore.tourStep + 1;
  if (next >= TOUR_STEPS.length) {
    endTour();
    return;
  }
  setSession("tourStep", next);
}

export function prevStep() {
  if (sessionStore.tourStep > 0) setSession("tourStep", sessionStore.tourStep - 1);
}

export function endTour() {
  setSession("tourStep", -1);
  try {
    localStorage.setItem("log-viewer.tourSeen", "1");
  } catch {
    /* ignore */
  }
}

export function Tour() {
  return (
    <Show when={sessionStore.tourStep >= 0 && sessionStore.tourStep < TOUR_STEPS.length}>
      <TourOverlay />
    </Show>
  );
}

function TourOverlay() {
  const step = () => TOUR_STEPS[sessionStore.tourStep];
  const [rect, setRect] = createSignal<DOMRect | null>(null);
  const [_tick, setTick] = createSignal(0);

  // Run any side effect tied to entering this step (open a panel, etc).
  createEffect(() => {
    const s = step();
    if (s.onEnter) s.onEnter();
  });

  function measure() {
    const s = step();
    if (!s.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(s.target) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }
    setRect(el.getBoundingClientRect());
  }

  createEffect(() => {
    void sessionStore.tourStep;
    // Wait a tick — the target may be conditionally rendered and still
    // mounting when the step changes.
    queueMicrotask(measure);
    setTimeout(measure, 30);
  });

  function onResize() {
    measure();
    setTick((t) => t + 1);
  }
  onMount(() => {
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
  });
  onCleanup(() => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onResize, true);
  });

  function onKey(e: KeyboardEvent) {
    if (sessionStore.tourStep < 0) return;
    if (e.key === "Escape") endTour();
    else if (e.key === "ArrowRight" || e.key === "Enter") nextStep();
    else if (e.key === "ArrowLeft") prevStep();
  }
  onMount(() => window.addEventListener("keydown", onKey, { capture: true }));
  onCleanup(() => window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions));

  const spotlightStyle = createMemo(() => {
    const r = rect();
    if (!r) return null;
    const pad = 6;
    return {
      top: `${r.top - pad}px`,
      left: `${r.left - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    };
  });

  const tooltipStyle = createMemo<Record<string, string | undefined>>(() => {
    const r = rect();
    const placement = step().placement ?? "below";
    if (!r || placement === "center") {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }
    const gap = 16;
    const tooltipWidth = 360;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    let chosen = placement;
    // Auto-flip if it would clip.
    if (chosen === "below" && r.bottom + gap + 180 > viewportH) chosen = "above";
    if (chosen === "above" && r.top - gap - 180 < 0) chosen = "below";
    if (chosen === "right" && r.right + gap + tooltipWidth > viewportW) chosen = "left";
    if (chosen === "left" && r.left - gap - tooltipWidth < 0) chosen = "right";

    switch (chosen) {
      case "below": {
        const top = r.bottom + gap;
        let left = r.left + r.width / 2 - tooltipWidth / 2;
        left = Math.max(12, Math.min(left, viewportW - tooltipWidth - 12));
        return { top: `${top}px`, left: `${left}px` };
      }
      case "above": {
        const bottom = viewportH - r.top + gap;
        let left = r.left + r.width / 2 - tooltipWidth / 2;
        left = Math.max(12, Math.min(left, viewportW - tooltipWidth - 12));
        return { bottom: `${bottom}px`, left: `${left}px` };
      }
      case "right": {
        const left = r.right + gap;
        let top = r.top + r.height / 2 - 90;
        top = Math.max(12, Math.min(top, viewportH - 200));
        return { top: `${top}px`, left: `${left}px` };
      }
      case "left": {
        const right = viewportW - r.left + gap;
        let top = r.top + r.height / 2 - 90;
        top = Math.max(12, Math.min(top, viewportH - 200));
        return { top: `${top}px`, right: `${right}px` };
      }
      default:
        return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
  });

  return (
    <div class="fixed inset-0 z-[60] pointer-events-none">
      {/* Backdrop with cut-out via box-shadow trick */}
      <Show
        when={spotlightStyle()}
        fallback={
          <div class="pointer-events-auto absolute inset-0 bg-black/70" onClick={() => {}} />
        }
      >
        <div
          class="pointer-events-auto absolute rounded-lg ring-2 ring-[var(--color-accent)] transition-all duration-200"
          style={{
            ...spotlightStyle()!,
            "box-shadow": "0 0 0 9999px rgba(0, 0, 0, 0.7)",
          }}
        />
      </Show>

      {/* Tooltip card */}
      <div
        class="pointer-events-auto absolute w-[360px] max-w-[92vw] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4 shadow-[var(--shadow-elev)]"
        style={tooltipStyle()}
      >
        <div class="mb-1 flex items-baseline justify-between gap-2">
          <h3 class="text-[14px] font-semibold text-[var(--color-text-primary)]">
            {step().title}
          </h3>
          <span class="text-[11px] text-[var(--color-text-faint)]">
            {sessionStore.tourStep + 1} / {TOUR_STEPS.length}
          </span>
        </div>
        <p class="mb-4 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
          {step().body}
        </p>
        <div class="flex items-center justify-between gap-2">
          <button
            class="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            onClick={endTour}
          >
            Skip tour
          </button>
          <div class="flex gap-2">
            <button
              class="btn-base"
              disabled={sessionStore.tourStep === 0}
              onClick={prevStep}
            >
              Back
            </button>
            <button class="btn-base btn-primary" onClick={nextStep}>
              {sessionStore.tourStep === TOUR_STEPS.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
