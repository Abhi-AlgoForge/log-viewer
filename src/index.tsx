/* @refresh reload */
import { ErrorBoundary } from "solid-js";
import { render } from "solid-js/web";
import App from "./App";

function FatalError(err: unknown) {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        background: "#0d1117",
        color: "#e6edf3",
        padding: "24px",
        "font-family": "ui-monospace, monospace",
        "font-size": "12px",
        "white-space": "pre-wrap",
        "overflow-y": "auto",
        "z-index": "9999",
      }}
    >
      <div style={{ "font-size": "16px", "font-weight": "600", "margin-bottom": "12px", color: "#f85149" }}>
        Log Viewer crashed during render
      </div>
      <div style={{ "margin-bottom": "12px", color: "#8b949e" }}>
        Copy this stack trace and share it. Press Ctrl+R to retry; if it persists,
        try removing localStorage entry "log-viewer.appearance".
      </div>
      <pre style={{ margin: "0" }}>{message}</pre>
    </div>
  );
}

render(
  () => <ErrorBoundary fallback={FatalError}><App /></ErrorBoundary>,
  document.getElementById("root") as HTMLElement,
);
