import { createEffect } from "solid-js";
import { sessionStore } from "../state/session";

/// Subscribe to a global action trigger fired by the keybinding dispatcher.
/// The callback runs whenever the matching counter ticks up — first run on
/// component mount is ignored.
export function onActionTrigger(id: string, cb: () => void) {
  let initialized = false;
  createEffect(() => {
    const v = sessionStore.actionTriggers[id] ?? 0;
    if (!initialized) {
      initialized = true;
      return;
    }
    void v;
    cb();
  });
}
