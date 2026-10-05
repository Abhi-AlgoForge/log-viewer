import { For, Show, createEffect, createSignal, onMount } from "solid-js";
import {
  sessionStore,
  setSession,
  setAppearance,
  applyTheme,
  setLevelColor,
  SELECTED_COLOR_PRESETS,
  DEFAULT_APPEARANCE,
  FONT_PRESETS,
  TEXT_INTENSITY,
  THEMES,
  type SettingsSection,
  type TextIntensity,
  type LogLevel,
} from "../state/session";
import {
  api,
  type AiConfigDTO,
  type AiProviderId,
  type ProviderSettingsDTO,
  type StorageInfoDTO,
} from "../services/api";
import { Icon } from "./Icon";
import {
  ACTIONS,
  defaultBindings,
  displayKey,
  formatKey,
  resetBindings,
  setBinding,
} from "../services/keybindings";
import { pushToast } from "../state/session";
import { startTour } from "./Tour";
import { formatBytes } from "../utils/format";

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: "sparkles" | "palette" | "keyboard" | "database" | "info";
  color: string;
  description: string;
  comingSoon?: boolean;
}

const NAV: NavItem[] = [
  { id: "ai", label: "AI", icon: "sparkles", color: "#a78bfa", description: "Anthropic key, model preferences" },
  { id: "appearance", label: "Appearance", icon: "palette", color: "#f59e0b", description: "Line spacing, letter spacing, colors" },
  { id: "keybindings", label: "Keybindings", icon: "keyboard", color: "#22d3ee", description: "Customize shortcuts" },
  { id: "storage", label: "Storage", icon: "database", color: "#34d399", description: "Cache size, temp files, resets" },
  { id: "about", label: "About", icon: "info", color: "#60a5fa", description: "Version, license, credits" },
];

export function SettingsView() {
  const current = () => sessionStore.settingsSection;

  return (
    <div class="flex min-h-0 flex-1 bg-[var(--color-bg-base)]">
      {/* Category nav */}
      <aside class="flex w-[240px] shrink-0 flex-col border-r border-[var(--color-border-soft)] bg-[var(--color-bg-panel)]">
        <div class="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--color-border-soft)] px-3">
          <button
            class="icon-btn"
            onClick={() => setSession("view", "logs")}
            title="Back to logs"
          >
            <Icon name="back" size={16} />
          </button>
          <span class="text-[14px] font-semibold text-[var(--color-text-primary)]">
            Settings
          </span>
        </div>
        <nav class="flex flex-col gap-0.5 p-2">
          <For each={NAV}>
            {(n) => (
              <button
                class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                classList={{
                  "bg-[var(--color-bg-elev-2)] text-[var(--color-text-primary)]":
                    current() === n.id,
                  "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]":
                    current() !== n.id,
                }}
                onClick={() => setSession("settingsSection", n.id)}
              >
                <span
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                  style={{
                    "background-color": `color-mix(in oklab, ${n.color} 18%, transparent)`,
                    color: n.color,
                  }}
                >
                  <Icon name={n.icon} size={16} stroke={2} />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 text-[13px] font-medium">
                    {n.label}
                    <Show when={n.comingSoon}>
                      <span class="rounded-full bg-[var(--color-bg-elev)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                        soon
                      </span>
                    </Show>
                  </div>
                  <div class="text-[11px] text-[var(--color-text-faint)]">
                    {n.description}
                  </div>
                </div>
              </button>
            )}
          </For>
        </nav>
      </aside>

      {/* Section content */}
      <main class="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div class="mx-auto w-full max-w-[760px] p-8">
          <Show when={current() === "ai"}>
            <AiSection />
          </Show>
          <Show when={current() === "appearance"}>
            <AppearanceSection />
          </Show>
          <Show when={current() === "keybindings"}>
            <KeybindingsSection />
          </Show>
          <Show when={current() === "storage"}>
            <StorageSection />
          </Show>
          <Show when={current() === "about"}>
            <AboutSection />
          </Show>
        </div>
      </main>
    </div>
  );
}

function SectionHeader(props: { title: string; description?: string }) {
  return (
    <header class="mb-6">
      <h1 class="text-[22px] font-semibold text-[var(--color-text-primary)]">{props.title}</h1>
      <Show when={props.description}>
        <p class="mt-1 text-[14px] text-[var(--color-text-muted)]">{props.description}</p>
      </Show>
    </header>
  );
}

function Card(props: { title?: string; description?: string; children: any }) {
  return (
    <section class="mb-4 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-bg-panel)] p-6">
      <Show when={props.title}>
        <h2 class="text-[15px] font-semibold text-[var(--color-text-primary)]">{props.title}</h2>
      </Show>
      <Show when={props.description}>
        <p class="mt-1 text-[13px] text-[var(--color-text-muted)]">{props.description}</p>
      </Show>
      <div class={props.title ? "mt-4" : ""}>{props.children}</div>
    </section>
  );
}


const LEVEL_ORDER: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

function AppearanceSection() {
  const a = () => sessionStore.appearance;
  const isCustom = () => a().themeId === "custom";

  return (
    <>
      <SectionHeader
        title="Appearance"
        description="Tune density, theme, and per-level colors. Changes apply live and persist locally."
      />

      <Card title="Theme" description='Pick a preset. Changing any color or text setting below switches to "Custom".'>
        <div class="grid grid-cols-2 gap-2">
          <For each={THEMES}>
            {(t) => (
              <button
                class="flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors"
                classList={{
                  "border-[var(--color-accent)] bg-[var(--color-bg-elev-2)]":
                    a().themeId === t.id,
                  "border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]":
                    a().themeId !== t.id,
                }}
                onClick={() => applyTheme(t.id)}
              >
                <div class="flex items-center justify-between">
                  <span class="text-[13px] font-medium text-[var(--color-text-primary)]">
                    {t.name}
                  </span>
                  <span
                    class="inline-block h-3 w-3 rounded-full"
                    style={{ "background-color": t.appearance.accentColor }}
                    title="Accent"
                  />
                </div>
                <div class="flex gap-1">
                  <For each={LEVEL_ORDER}>
                    {(lvl) => (
                      <span
                        class="h-3 flex-1 rounded-sm"
                        style={{ "background-color": t.appearance.levelColors[lvl] }}
                        title={lvl}
                      />
                    )}
                  </For>
                </div>
              </button>
            )}
          </For>
          <button
            class="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-left transition-colors"
            classList={{
              "border-[var(--color-accent)] bg-[var(--color-bg-elev-2)]":
                isCustom(),
              "border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]":
                !isCustom(),
            }}
            disabled={!isCustom()}
            title={isCustom() ? "You have unsaved customizations" : "Edit a color below to create a custom theme"}
          >
            <div class="flex items-center justify-between">
              <span class="text-[13px] font-medium text-[var(--color-text-primary)]">
                Custom
              </span>
              <Show when={isCustom()}>
                <span
                  class="inline-block h-3 w-3 rounded-full"
                  style={{ "background-color": a().accentColor }}
                />
              </Show>
            </div>
            <div class="flex gap-1">
              <Show
                when={isCustom()}
                fallback={
                  <div class="h-3 w-full text-center text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                    edit anything below
                  </div>
                }
              >
                <For each={LEVEL_ORDER}>
                  {(lvl) => (
                    <span
                      class="h-3 flex-1 rounded-sm"
                      style={{ "background-color": a().levelColors[lvl] }}
                    />
                  )}
                </For>
              </Show>
            </div>
          </button>
        </div>
      </Card>

      <Card title="Log row density">
        <SliderRow
          label="Font size"
          value={a().fontSize}
          unit="px"
          min={10}
          max={18}
          step={1}
          onChange={(v) => setAppearance({ fontSize: v })}
        />
        <div class="mt-3">
          <SliderRow
            label="Line height"
            value={a().lineHeight}
            unit="px"
            min={14}
            max={40}
            step={1}
            onChange={(v) => setAppearance({ lineHeight: v })}
          />
        </div>
        <div class="mt-3">
          <SliderRow
            label="Letter spacing"
            value={a().letterSpacing}
            unit="px"
            min={-0.5}
            max={2}
            step={0.1}
            onChange={(v) => setAppearance({ letterSpacing: v })}
          />
        </div>
        <button
          class="btn-base mt-4"
          onClick={() =>
            setAppearance({
              fontSize: DEFAULT_APPEARANCE.fontSize,
              lineHeight: DEFAULT_APPEARANCE.lineHeight,
              letterSpacing: DEFAULT_APPEARANCE.letterSpacing,
            })
          }
        >
          Reset density
        </button>
      </Card>

      <Card
        title="Scroll"
        description="Override how many log rows one mouse-wheel notch moves. Doesn't affect anything outside the log viewer. Set to 0 to use the OS default."
      >
        <SliderRow
          label="Lines per wheel"
          value={a().scrollLinesPerWheel}
          unit=" lines"
          min={0}
          max={20}
          step={1}
          onChange={(v) => setAppearance({ scrollLinesPerWheel: v })}
        />
        <button
          class="btn-base mt-4"
          onClick={() =>
            setAppearance({ scrollLinesPerWheel: DEFAULT_APPEARANCE.scrollLinesPerWheel })
          }
        >
          Reset to default ({DEFAULT_APPEARANCE.scrollLinesPerWheel})
        </button>
      </Card>

      <Card
        title="Time histogram"
        description="Vertical stacked sparkline shown to the right of the log viewer. Buckets log volume by time, colored by level."
      >
        <label class="flex cursor-pointer items-center gap-2 py-1">
          <input
            type="checkbox"
            class="h-4 w-4 cursor-pointer accent-[var(--color-accent)]"
            checked={a().showHistogram}
            onChange={(e) => setAppearance({ showHistogram: e.currentTarget.checked })}
          />
          <span class="text-[13px] text-[var(--color-text-secondary)]">
            Show histogram strip
          </span>
        </label>
      </Card>

      <Card title="Font" description="Applied to log lines. Falls back to system monospace if the font isn't installed.">
        <div class="grid grid-cols-2 gap-2">
          <For each={FONT_PRESETS}>
            {(f) => (
              <button
                class="rounded-md border px-3 py-2 text-left transition-colors"
                classList={{
                  "border-[var(--color-accent)] bg-[var(--color-bg-elev-2)] text-[var(--color-text-primary)]":
                    a().fontFamily === f.value,
                  "border-[var(--color-border-soft)] text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:text-[var(--color-text-primary)]":
                    a().fontFamily !== f.value,
                }}
                onClick={() => setAppearance({ fontFamily: f.value })}
              >
                <div class="text-[13px] font-medium">{f.label}</div>
                <div
                  class="mt-1 text-[12px] text-[var(--color-text-faint)]"
                  style={{ "font-family": f.value }}
                >
                  2026-05-17 09:12:31  INFO  hello world
                </div>
              </button>
            )}
          </For>
        </div>
      </Card>

      <Card title="Text intensity" description="Brightness of the log message text. Lower is easier on the eyes for long sessions.">
        <div class="flex flex-wrap gap-2">
          <For each={Object.entries(TEXT_INTENSITY) as [TextIntensity, { label: string; color: string }][]}>
            {([id, def]) => (
              <button
                class="flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] transition-colors"
                classList={{
                  "border-[var(--color-accent)] bg-[var(--color-bg-elev-2)] text-[var(--color-text-primary)]":
                    a().textIntensity === id,
                  "border-[var(--color-border-soft)] text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:text-[var(--color-text-primary)]":
                    a().textIntensity !== id,
                }}
                onClick={() => setAppearance({ textIntensity: id })}
              >
                <span class="inline-block h-3 w-3 rounded-sm" style={{ "background-color": def.color }} />
                {def.label}
              </button>
            )}
          </For>
        </div>
      </Card>

      <Card
        title="Level palette"
        description="Color used for each log level — applied to level chip text and to the row background tint for warn / error / fatal."
      >
        <div class="grid grid-cols-3 gap-3">
          <For each={LEVEL_ORDER}>
            {(lvl) => (
              <label class="flex items-center gap-2 rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-2 py-1.5">
                <input
                  type="color"
                  class="h-7 w-9 cursor-pointer rounded border border-[var(--color-border)] bg-transparent"
                  value={a().levelColors[lvl]}
                  onInput={(e) => setLevelColor(lvl, e.currentTarget.value)}
                />
                <div class="min-w-0 flex-1">
                  <div
                    class="text-[12px] font-medium uppercase tracking-wider"
                    style={{ color: a().levelColors[lvl] }}
                  >
                    {lvl}
                  </div>
                  <div class="font-mono text-[10px] text-[var(--color-text-faint)]">
                    {a().levelColors[lvl]}
                  </div>
                </div>
              </label>
            )}
          </For>
        </div>
      </Card>

      <Card
        title="Selected line"
        description="Highlight color applied to the currently focused row."
      >
        <div class="flex flex-wrap gap-2">
          <For each={SELECTED_COLOR_PRESETS}>
            {(p) => (
              <button
                class="flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] transition-colors"
                classList={{
                  "border-[var(--color-accent)] bg-[var(--color-bg-elev-2)] text-[var(--color-text-primary)]":
                    a().selectedColor === p.value,
                  "border-[var(--color-border-soft)] text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:text-[var(--color-text-primary)]":
                    a().selectedColor !== p.value,
                }}
                onClick={() => setAppearance({ selectedColor: p.value })}
              >
                <span
                  class="inline-block h-3 w-3 rounded-sm"
                  style={{ "background-color": p.value }}
                />
                {p.label}
              </button>
            )}
          </For>
        </div>
        <div class="mt-4">
          <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
            Preview
          </div>
          <div
            class="mt-1.5 rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-base)]"
            style={{
              "font-family": a().fontFamily,
              "font-size": `${a().fontSize}px`,
              "line-height": `${a().lineHeight}px`,
              "letter-spacing": `${a().letterSpacing}px`,
              color: TEXT_INTENSITY[a().textIntensity].color,
            }}
          >
            <div class="px-3 py-1.5">2026-05-17 09:12:31  INFO   server started on :3000</div>
            <div
              class="px-3 py-1.5"
              style={{
                "background-color": a().selectedColor,
                "box-shadow": "inset 2px 0 0 var(--color-accent)",
              }}
            >
              2026-05-17 09:12:31  WARN   slow query took 1.2s
            </div>
            <div class="px-3 py-1.5">2026-05-17 09:12:32  INFO   user u_4815 signed in</div>
          </div>
        </div>
      </Card>
    </>
  );
}

function SliderRow(props: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div class="flex items-center gap-4">
      <div class="w-32 shrink-0 text-[13px] text-[var(--color-text-secondary)]">
        {props.label}
      </div>
      <input
        type="range"
        class="flex-1 accent-[var(--color-accent)]"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(parseFloat(e.currentTarget.value))}
      />
      <div class="w-16 shrink-0 text-right font-mono text-[12px] text-[var(--color-text-muted)]">
        {Number.isInteger(props.step) ? props.value : props.value.toFixed(1)}
        {props.unit}
      </div>
    </div>
  );
}

interface ProviderDef {
  id: AiProviderId;
  name: string;
  swatch: string;
  defaultBase: string;
  defaultFast: string;
  defaultSmart: string;
  keyHint: string;
  notes: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    swatch: "#d97757",
    defaultBase: "https://api.anthropic.com/v1",
    defaultFast: "claude-haiku-4-5-20251001",
    defaultSmart: "claude-sonnet-4-6",
    keyHint: "sk-ant-...",
    notes: "Anthropic Messages API with ephemeral prompt caching on the system block.",
  },
  {
    id: "openai",
    name: "OpenAI",
    swatch: "#10a37f",
    defaultBase: "https://api.openai.com/v1",
    defaultFast: "gpt-4o-mini",
    defaultSmart: "gpt-4o",
    keyHint: "sk-...",
    notes: "Chat Completions API. Prompt caching is automatic on the GPT-4o family.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    swatch: "#4d6bfe",
    defaultBase: "https://api.deepseek.com/v1",
    defaultFast: "deepseek-chat",
    defaultSmart: "deepseek-reasoner",
    keyHint: "sk-...",
    notes: "OpenAI-compatible API. deepseek-reasoner is the chain-of-thought model.",
  },
];

function AiSection() {
  const [config, setConfig] = createSignal<AiConfigDTO | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function refresh() {
    try {
      setConfig(await api.aiGetConfig());
    } catch (e) {
      console.error(e);
    }
  }
  onMount(refresh);

  async function setActive(id: AiProviderId) {
    if (busy()) return;
    setBusy(true);
    try {
      await api.aiSetActiveProvider(id);
      await refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  const active = () => config()?.activeProvider ?? "anthropic";
  const settingsFor = (id: AiProviderId): ProviderSettingsDTO =>
    config()?.providers?.[id] ?? {};

  return (
    <>
      <SectionHeader
        title="AI"
        description="Pick a provider for the LLM features. Keys are stored locally and never leave the Rust process."
      />

      <Card
        title="Active provider"
        description="Used by ✨ Ask, Explain this line, and anomaly summaries."
      >
        <div class="grid grid-cols-3 gap-2">
          <For each={PROVIDERS}>
            {(p) => {
              const isActive = () => active() === p.id;
              const hasKey = () => !!settingsFor(p.id).hasKey;
              return (
                <button
                  class="flex items-center gap-2 rounded-lg border p-3 text-left transition-colors"
                  classList={{
                    "border-[var(--color-accent)] bg-[var(--color-bg-elev-2)]": isActive(),
                    "border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] hover:border-[var(--color-border)]":
                      !isActive(),
                  }}
                  onClick={() => setActive(p.id)}
                  disabled={busy()}
                >
                  <span
                    class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ "background-color": p.swatch }}
                  />
                  <div class="min-w-0 flex-1">
                    <div class="text-[13px] font-medium text-[var(--color-text-primary)]">
                      {p.name}
                    </div>
                    <div class="text-[11px] text-[var(--color-text-faint)]">
                      {hasKey() ? "Key set" : "No key"}
                    </div>
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </Card>

      <For each={PROVIDERS}>
        {(p) => (
          <ProviderCard
            def={p}
            settings={settingsFor(p.id)}
            isActive={active() === p.id}
            onSaved={refresh}
          />
        )}
      </For>
    </>
  );
}

function ProviderCard(props: {
  def: ProviderDef;
  settings: ProviderSettingsDTO;
  isActive: boolean;
  onSaved: () => Promise<void>;
}) {
  // The stored key is never sent to the frontend, so this only ever holds a
  // replacement the user is typing. Left blank, Save keeps the stored key.
  const [apiKey, setApiKey] = createSignal("");
  const [baseUrl, setBaseUrl] = createSignal(props.settings.baseUrl ?? "");
  const [fast, setFast] = createSignal(props.settings.fastModel ?? "");
  const [smart, setSmart] = createSignal(props.settings.smartModel ?? "");
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal<{ text: string; tone: "ok" | "err" } | null>(null);

  createEffect(() => {
    setApiKey("");
    setBaseUrl(props.settings.baseUrl ?? "");
    setFast(props.settings.fastModel ?? "");
    setSmart(props.settings.smartModel ?? "");
  });

  const trimOrNull = (s: string) => (s.trim() === "" ? null : s.trim());

  async function save() {
    if (busy()) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.aiSetProviderSettings(props.def.id, {
        apiKey: trimOrNull(apiKey()),
        baseUrl: trimOrNull(baseUrl()),
        fastModel: trimOrNull(fast()),
        smartModel: trimOrNull(smart()),
      });
      await props.onSaved();
      setMsg({ text: "Saved.", tone: "ok" });
    } catch (e) {
      setMsg({ text: String(e), tone: "err" });
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    setApiKey("");
    setBusy(true);
    setMsg(null);
    try {
      await api.aiSetProviderSettings(props.def.id, {
        clearKey: true,
        baseUrl: trimOrNull(baseUrl()),
        fastModel: trimOrNull(fast()),
        smartModel: trimOrNull(smart()),
      });
      await props.onSaved();
      setMsg({ text: "Key cleared.", tone: "ok" });
    } catch (e) {
      setMsg({ text: String(e), tone: "err" });
    } finally {
      setBusy(false);
    }
  }

  const hasKey = () => !!props.settings.hasKey;

  return (
    <Card>
      <div class="mb-3 flex items-center gap-2">
        <span
          class="inline-block h-3 w-3 rounded-full"
          style={{ "background-color": props.def.swatch }}
        />
        <h3 class="text-[14px] font-semibold text-[var(--color-text-primary)]">
          {props.def.name}
        </h3>
        <Show when={props.isActive}>
          <span class="rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-accent)]">
            Active
          </span>
        </Show>
        <Show when={hasKey()}>
          <span class="rounded-full bg-[var(--color-success)]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-success)]">
            Key set
          </span>
        </Show>
      </div>
      <p class="mb-4 text-[12px] text-[var(--color-text-muted)]">{props.def.notes}</p>

      <div class="grid grid-cols-1 gap-3">
        <FormField label="API key">
          <input
            type="password"
            class="h-9 w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-3 font-mono text-[13px] focus:border-[var(--color-accent)] focus:outline-none"
            placeholder={hasKey() ? "Key saved — type to replace" : props.def.keyHint}
            value={apiKey()}
            onInput={(e) => setApiKey(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
        </FormField>
        <div class="grid grid-cols-2 gap-3">
          <FormField label="Fast model">
            <input
              class="h-9 w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-3 font-mono text-[12px] focus:border-[var(--color-accent)] focus:outline-none"
              placeholder={props.def.defaultFast}
              value={fast()}
              onInput={(e) => setFast(e.currentTarget.value)}
            />
          </FormField>
          <FormField label="Smart model">
            <input
              class="h-9 w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-3 font-mono text-[12px] focus:border-[var(--color-accent)] focus:outline-none"
              placeholder={props.def.defaultSmart}
              value={smart()}
              onInput={(e) => setSmart(e.currentTarget.value)}
            />
          </FormField>
        </div>
        <FormField label="Base URL (optional)">
          <input
            class="h-9 w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-3 font-mono text-[12px] focus:border-[var(--color-accent)] focus:outline-none"
            placeholder={props.def.defaultBase}
            value={baseUrl()}
            onInput={(e) => setBaseUrl(e.currentTarget.value)}
          />
        </FormField>
      </div>

      <Show when={msg()}>
        <div
          class="mt-3 rounded-md border px-3 py-2 text-[12px]"
          classList={{
            "border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]":
              msg()!.tone === "ok",
            "border-[var(--color-level-error)]/40 bg-[var(--color-level-error)]/10 text-[var(--color-level-error)]":
              msg()!.tone === "err",
          }}
        >
          {msg()!.text}
        </div>
      </Show>

      <div class="mt-4 flex justify-end gap-2">
        <Show when={hasKey()}>
          <button class="btn-base" onClick={clearKey} disabled={busy()}>
            Clear key
          </button>
        </Show>
        <button class="btn-base btn-primary" onClick={save} disabled={busy()}>
          {busy() ? "Saving…" : "Save"}
        </button>
      </div>
    </Card>
  );
}

function FormField(props: { label: string; children: any }) {
  return (
    <label class="flex flex-col gap-1.5">
      <span class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

function KeybindingsSection() {
  const [capturing, setCapturing] = createSignal<string | null>(null);

  const effective = (id: string) => {
    const user = sessionStore.keybindings[id];
    if (user !== undefined) return user;
    return defaultBindings()[id] ?? "";
  };

  function startCapture(id: string) {
    setCapturing(id);
  }

  function onCaptureKey(e: KeyboardEvent) {
    const id = capturing();
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setCapturing(null);
      return;
    }
    const combo = formatKey(e);
    if (!combo) return;
    // Reject lone modifiers (already filtered by formatKey) and ensure no
    // duplicate binding — swap with the other action if so.
    const swapWith = Object.entries(sessionStore.keybindings).find(
      ([otherId, otherCombo]) => otherId !== id && otherCombo === combo,
    );
    if (swapWith) {
      setBinding(swapWith[0], effective(id));
    }
    setBinding(id, combo);
    setCapturing(null);
  }

  return (
    <div onKeyDown={onCaptureKey} tabIndex={-1}>
      <SectionHeader
        title="Keybindings"
        description="Click a key chip to rebind. Press Escape to cancel capture."
      />
      <Card>
        <div class="flex flex-col gap-1">
          <For each={ACTIONS}>
            {(a) => (
              <div class="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-[var(--color-bg-hover)]">
                <div class="min-w-0 flex-1">
                  <div class="text-[13px] font-medium text-[var(--color-text-primary)]">
                    {a.name}
                  </div>
                  <div class="text-[11px] text-[var(--color-text-faint)]">
                    {a.description}
                  </div>
                </div>
                <button
                  class="rounded-md border px-3 py-1 font-mono text-[12px] transition-colors"
                  classList={{
                    "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]":
                      capturing() === a.id,
                    "border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] text-[var(--color-text-primary)] hover:border-[var(--color-border)]":
                      capturing() !== a.id,
                  }}
                  onClick={() => startCapture(a.id)}
                >
                  {capturing() === a.id ? "Press any key…" : displayKey(effective(a.id))}
                </button>
                <Show when={effective(a.id) !== a.default}>
                  <button
                    class="icon-btn"
                    title="Reset to default"
                    onClick={() => setBinding(a.id, a.default)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="mt-4 flex justify-end">
          <button class="btn-base" onClick={resetBindings}>
            Reset all to defaults
          </button>
        </div>
      </Card>
    </div>
  );
}

function StorageSection() {
  const [info, setInfo] = createSignal<StorageInfoDTO | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function refresh() {
    try {
      setInfo(await api.storageInfo());
    } catch (e) {
      console.error(e);
    }
  }
  onMount(refresh);

  async function clearTemp() {
    if (busy()) return;
    setBusy(true);
    try {
      const n = await api.clearTempFiles();
      pushToast("success", `Removed ${n} temp file${n === 1 ? "" : "s"}`);
      await refresh();
    } catch (e) {
      pushToast("error", "Couldn't clear temp files", String(e));
    } finally {
      setBusy(false);
    }
  }

  function resetAppearance() {
    setAppearance({
      lineHeight: DEFAULT_APPEARANCE.lineHeight,
      letterSpacing: DEFAULT_APPEARANCE.letterSpacing,
      fontSize: DEFAULT_APPEARANCE.fontSize,
      fontFamily: DEFAULT_APPEARANCE.fontFamily,
      accentColor: DEFAULT_APPEARANCE.accentColor,
      selectedColor: DEFAULT_APPEARANCE.selectedColor,
      textIntensity: DEFAULT_APPEARANCE.textIntensity,
      levelColors: { ...DEFAULT_APPEARANCE.levelColors },
      themeId: DEFAULT_APPEARANCE.themeId,
    });
    pushToast("success", "Appearance reset to defaults");
  }

  function clearLocalStorage() {
    try {
      localStorage.removeItem("log-viewer.appearance");
      localStorage.removeItem("log-viewer.keybindings");
      pushToast("success", "Local preferences cleared", "Reload to see defaults.");
    } catch (e) {
      pushToast("error", "Couldn't clear local storage", String(e));
    }
  }

  return (
    <>
      <SectionHeader
        title="Storage"
        description="Disk space, cached state, and reset actions. The viewer never writes log content to disk — only its own config and any subprocess capture files."
      />

      <Card title="Currently open">
        <div class="grid grid-cols-3 gap-4">
          <StatBlock label="Sources" value={info()?.sourceCount.toLocaleString() ?? "—"} />
          <StatBlock label="Total bytes mapped" value={info() ? formatBytes(info()!.sourceBytes) : "—"} />
          <StatBlock label="Total lines indexed" value={info()?.sourceLines.toLocaleString() ?? "—"} />
        </div>
        <p class="mt-3 text-[12px] text-[var(--color-text-faint)]">
          Open files are memory-mapped, not copied. Closing a source releases the mapping.
        </p>
      </Card>

      <Card
        title="Subprocess capture files"
        description="When you use Open command, the program's stdout is written to a temp file so the viewer can mmap and tail it."
      >
        <div class="mb-3 grid grid-cols-2 gap-4">
          <StatBlock label="Files" value={info()?.tempFiles.length.toLocaleString() ?? "—"} />
          <StatBlock label="Disk used" value={info() ? formatBytes(info()!.tempBytes) : "—"} />
        </div>
        <Show when={info()?.tempFiles.length}>
          <ul class="mb-3 max-h-40 overflow-y-auto rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] text-[12px]">
            <For each={info()?.tempFiles ?? []}>
              {(f) => (
                <li class="flex items-baseline justify-between gap-3 border-b border-[var(--color-border-soft)] px-3 py-1.5 last:border-b-0">
                  <span class="truncate font-mono text-[var(--color-text-muted)]" title={f.path}>
                    {f.path}
                  </span>
                  <span class="shrink-0 text-[var(--color-text-faint)]">{formatBytes(f.size)}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="text-[11px] text-[var(--color-text-faint)]">
          Folder: <code class="font-mono">{info()?.tempDir ?? "—"}</code>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button class="btn-base" onClick={refresh} disabled={busy()}>
            Refresh
          </button>
          <button class="btn-base" onClick={clearTemp} disabled={busy() || (info()?.tempFiles.length ?? 0) === 0}>
            {busy() ? "Clearing…" : "Clear all"}
          </button>
        </div>
      </Card>

      <Card title="Config &amp; preferences" description="Stored locally on this machine.">
        <div class="space-y-2 text-[12px]">
          <div>
            <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
              AI config file
            </div>
            <code class="font-mono text-[var(--color-text-primary)]">{info()?.configPath ?? "—"}</code>
          </div>
          <div>
            <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
              Browser localStorage keys
            </div>
            <code class="font-mono text-[var(--color-text-primary)]">log-viewer.appearance, log-viewer.keybindings</code>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap justify-end gap-2">
          <button class="btn-base" onClick={resetAppearance}>
            Reset appearance
          </button>
          <button class="btn-base" onClick={clearLocalStorage}>
            Clear local preferences
          </button>
        </div>
      </Card>
    </>
  );
}

function StatBlock(props: { label: string; value: string }) {
  return (
    <div class="rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-3 py-2">
      <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">
        {props.label}
      </div>
      <div class="mt-1 font-mono text-[14px] text-[var(--color-text-primary)]">{props.value}</div>
    </div>
  );
}


function AboutSection() {
  const [checking, setChecking] = createSignal(false);
  return (
    <>
      <SectionHeader title="About" />
      <Card>
        <div class="space-y-3 text-[13px]">
          <Row label="Version" value="0.1.0" />
          <Row label="License" value="MIT" />
          <Row label="Stack" value="Tauri 2 · Rust · SolidJS · Tailwind v4" />
        </div>
      </Card>
      <Card title="Updates">
        <p class="mb-3 text-[13px] text-[var(--color-text-secondary)]">
          Check the configured release endpoint for a newer signed build. Requires
          the updater to be active in <code>tauri.conf.json</code> with a release
          pubkey configured.
        </p>
        <button
          class="btn-base"
          disabled={checking()}
          onClick={async () => {
            setChecking(true);
            try {
              const { check } = await import("@tauri-apps/plugin-updater");
              const update = await check();
              if (!update) {
                pushToast("info", "You're up to date", "No newer version available.");
              } else {
                pushToast(
                  "success",
                  `Update available: v${update.version}`,
                  update.body ?? "Release notes unavailable.",
                );
              }
            } catch (e) {
              pushToast("error", "Update check failed", String(e));
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking() ? "Checking…" : "Check for updates"}
        </button>
      </Card>
      <Card title="Tour">
        <p class="mb-3 text-[13px] text-[var(--color-text-secondary)]">
          Replay the guided spotlight tour of the main features.
        </p>
        <button
          class="btn-base"
          onClick={() => {
            setSession("view", "logs");
            startTour();
          }}
        >
          Start tour
        </button>
      </Card>
      <Card title="Open source">
        <p class="text-[13px] text-[var(--color-text-secondary)]">
          Local-first log viewer with pattern clustering, trace stitching, and AI-assisted
          filtering. Multi-GB files via memory-mapped reads.
        </p>
      </Card>
      <SupportCard />
    </>
  );
}

const DONATIONS: { label: string; chain: string; address: string }[] = [
  {
    label: "Ethereum / EVM",
    chain: "ETH",
    address: "0x0610Ee1a2d9BdF485bACEea2aca97011f7f574e2",
  },
  {
    label: "Bitcoin",
    chain: "BTC",
    address: "bc1qec9ty5nn3l52yq3svkn43epech6ejqnlumq73v",
  },
  {
    label: "Solana",
    chain: "SOL",
    address: "EwnvQswau4hhp9HXMiuHuTwYrsqe71xfhUM868a2fWyX",
  },
];

function SupportCard() {
  const [copied, setCopied] = createSignal<string | null>(null);
  async function copy(addr: string) {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(addr);
      setTimeout(() => setCopied((c) => (c === addr ? null : c)), 1500);
    } catch (e) {
      pushToast("error", "Couldn't copy", String(e));
    }
  }
  return (
    <Card title="Support development ☕">
      <p class="mb-3 text-[13px] text-[var(--color-text-secondary)]">
        This app is free and open source. If it saved you time, a coffee is
        appreciated — or just star the repo.
      </p>
      <ul class="flex flex-col gap-2">
        <For each={DONATIONS}>
          {(d) => (
            <li class="flex items-center gap-2 rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-elev)] px-3 py-2">
              <div class="flex w-12 shrink-0 justify-center">
                <span class="rounded-full bg-[var(--color-bg-elev-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
                  {d.chain}
                </span>
              </div>
              <span
                class="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--color-text-primary)]"
                title={d.address}
              >
                {d.address}
              </span>
              <button
                class="btn-base shrink-0 px-2 py-1 text-[12px]"
                onClick={() => copy(d.address)}
              >
                {copied() === d.address ? "Copied!" : "Copy"}
              </button>
            </li>
          )}
        </For>
      </ul>
    </Card>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <div class="flex items-baseline justify-between gap-3">
      <span class="text-[12px] uppercase tracking-wider text-[var(--color-text-faint)]">
        {props.label}
      </span>
      <span class="text-[var(--color-text-primary)]">{props.value}</span>
    </div>
  );
}
