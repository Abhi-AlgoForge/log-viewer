import { For, Show, createSignal } from "solid-js";
import { api } from "../services/api";
import { addSource, setActiveSource, setFollowing } from "../state/session";
import { Icon } from "./Icon";

interface Preset {
  label: string;
  description: string;
  cmd: string;
  icon: string;
}

const PRESETS: Preset[] = [
  {
    label: "SSH tail",
    description: "Follow a remote log file over SSH",
    cmd: "ssh user@host tail -F /var/log/app.log",
    icon: "🔐",
  },
  {
    label: "kubectl logs",
    description: "Stream logs from a Kubernetes pod",
    cmd: "kubectl logs -f deploy/my-app -n default --tail=200",
    icon: "☸",
  },
  {
    label: "journalctl",
    description: "Stream the systemd journal (Linux)",
    cmd: "journalctl -f -o short-iso",
    icon: "📜",
  },
  {
    label: "Docker logs",
    description: "Follow a running container's logs",
    cmd: "docker logs -f my-container",
    icon: "🐳",
  },
  {
    label: "AWS CloudWatch",
    description: "Tail a CloudWatch log group (needs `aws` CLI)",
    cmd: "aws logs tail /aws/lambda/my-function --follow",
    icon: "☁",
  },
  {
    label: "GCP Logging",
    description: "Tail GCP logs (needs `gcloud` CLI)",
    cmd: 'gcloud logging tail "resource.type=k8s_container" --format=json',
    icon: "☁",
  },
];

export function OpenCommandPanel(props: { onClose: () => void }) {
  const [label, setLabel] = createSignal("");
  const [cmd, setCmd] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  function applyPreset(p: Preset) {
    setLabel(p.label);
    setCmd(p.cmd);
  }

  async function submit() {
    if (busy()) return;
    if (cmd().trim() === "") {
      setError("Command is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const info = await api.openCommand(label() || cmd(), cmd());
      addSource(info);
      setActiveSource(info.id);
      setFollowing(info.id, true);
      props.onClose();
    } catch (e: unknown) {
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
        class="mt-[8vh] flex w-[680px] max-w-[95vw] flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-6 shadow-[var(--shadow-elev)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-[var(--color-text-primary)]">
            Open command source
          </h2>
          <button class="icon-btn" onClick={props.onClose} title="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <p class="text-[13px] text-[var(--color-text-muted)]">
          Run any program and stream its stdout into the viewer. All downstream
          features (filter, patterns, AI, live tail) work the same as a file source.
        </p>

        <div class="grid grid-cols-2 gap-2">
          <For each={PRESETS}>
            {(p) => (
              <button
                class="flex items-start gap-2 rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] p-2.5 text-left hover:border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]"
                onClick={() => applyPreset(p)}
                title={p.description}
              >
                <span class="text-base leading-none">{p.icon}</span>
                <div class="min-w-0 flex-1">
                  <div class="text-[13px] font-medium text-[var(--color-text-primary)]">
                    {p.label}
                  </div>
                  <div class="truncate text-[11px] text-[var(--color-text-faint)]">
                    {p.description}
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>

        <div class="flex flex-col gap-3">
          <Field label="Label">
            <input
              class="h-9 w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-3 text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
              placeholder="prod-api-pod"
              value={label()}
              onInput={(e) => setLabel(e.currentTarget.value)}
            />
          </Field>
          <Field label="Command">
            <input
              class="h-9 w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-3 font-mono text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
              placeholder="kubectl logs -f deploy/my-app -n default"
              value={cmd()}
              onInput={(e) => setCmd(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                else if (e.key === "Escape") props.onClose();
              }}
              autofocus
            />
          </Field>
        </div>

        <Show when={error()}>
          <div class="rounded-md border border-[var(--color-level-error)]/40 bg-[var(--color-level-error)]/10 px-3 py-2 text-[12px] text-[var(--color-level-error)]">
            {error()}
          </div>
        </Show>

        <div class="flex justify-end gap-2">
          <button class="btn-base" onClick={props.onClose} disabled={busy()}>
            Cancel
          </button>
          <button
            class="btn-base btn-primary"
            onClick={submit}
            disabled={busy() || cmd().trim() === ""}
          >
            {busy() ? "Opening…" : "Open"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field(props: { label: string; children: any }) {
  return (
    <label class="flex flex-col gap-1.5">
      <span class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}
