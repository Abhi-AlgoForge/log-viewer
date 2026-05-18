import { For, Show, createSignal, createEffect, on, onMount } from "solid-js";
import { api, type AiChatMessage, type ChatSeedDTO } from "../services/api";
import { Markdown } from "./Markdown";
import { Icon } from "./Icon";

interface ChatProps {
  /// Identity for the conversation. When this changes (e.g. user picks a
  /// different line), the chat resets and re-seeds.
  conversationId: string;
  /// Async factory that returns the seed (system prompt + first user message
  /// + model preferences). Runs once per `conversationId`.
  seed: () => Promise<ChatSeedDTO>;
  /// Color accent for the panel border (e.g. "var(--color-accent)" for
  /// root-cause, neutral for explain).
  accent?: string;
  /// Shown as the placeholder in the follow-up input.
  followUpPlaceholder?: string;
  /// Optional reset trigger — calling .resetSignal increments this to force
  /// a re-seed without changing conversationId. Not currently used but kept
  /// here so callers can wire in a "regenerate" affordance later.
  resetSignal?: () => number;
}

export function Chat(props: ChatProps) {
  const [messages, setMessages] = createSignal<AiChatMessage[]>([]);
  const [seedDto, setSeedDto] = createSignal<ChatSeedDTO | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [input, setInput] = createSignal("");
  let inputEl: HTMLTextAreaElement | undefined;
  let scrollEl: HTMLDivElement | undefined;

  async function seedAndAsk() {
    setError(null);
    setMessages([]);
    setSeedDto(null);
    let dto: ChatSeedDTO;
    try {
      dto = await props.seed();
    } catch (e) {
      setError(String(e));
      return;
    }
    setSeedDto(dto);
    const initial: AiChatMessage = { role: "user", content: dto.user };
    setMessages([initial]);
    await sendRound([initial], dto);
  }

  async function sendRound(history: AiChatMessage[], dto: ChatSeedDTO) {
    setBusy(true);
    try {
      const reply = await api.aiChat(
        dto.system,
        history,
        dto.speed,
        dto.maxTokens,
        dto.temperature,
      );
      setMessages([...history, { role: "assistant", content: reply }]);
      // Scroll to bottom after the reply paints.
      queueMicrotask(() => {
        scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitFollowUp() {
    const text = input().trim();
    if (!text || busy()) return;
    const dto = seedDto();
    if (!dto) return;
    const next: AiChatMessage[] = [...messages(), { role: "user", content: text }];
    setMessages(next);
    setInput("");
    inputEl?.focus();
    await sendRound(next, dto);
  }

  // Reset + re-seed whenever the conversation identity changes.
  createEffect(
    on(
      () => props.conversationId,
      () => seedAndAsk(),
    ),
  );

  onMount(() => {
    inputEl?.focus();
  });

  const borderColor = () => props.accent ?? "var(--color-border-soft)";

  return (
    <div
      class="flex flex-col gap-2 rounded-lg border bg-[var(--color-bg-elev)] p-3"
      style={{ "border-color": borderColor() }}
    >
      <Show when={error()}>
        <div class="rounded-md border border-[var(--color-level-error)]/40 bg-[var(--color-level-error)]/10 px-3 py-2 text-[12px] text-[var(--color-level-error)]">
          {error()}
        </div>
      </Show>

      <div ref={scrollEl} class="flex max-h-[420px] flex-col gap-3 overflow-y-auto">
        <For each={messages()}>
          {(m, i) => {
            // Skip rendering the seed user message — it's giant log context
            // that the user didn't type. Subsequent user messages (follow-ups)
            // do render.
            const isSeedUser = i() === 0 && m.role === "user";
            if (isSeedUser) return null;
            return (
              <div
                class="rounded-md px-3 py-2"
                classList={{
                  "bg-[var(--color-bg-elev-2)] text-[var(--color-text-primary)]":
                    m.role === "user",
                  "bg-transparent": m.role === "assistant",
                }}
              >
                <Show when={m.role === "user"}>
                  <div class="mb-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                    You
                  </div>
                  <div class="whitespace-pre-wrap text-[13px]">{m.content}</div>
                </Show>
                <Show when={m.role === "assistant"}>
                  <div class="mb-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                    AI
                  </div>
                  <Markdown source={m.content} />
                </Show>
              </div>
            );
          }}
        </For>
        <Show when={busy()}>
          <div class="flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
            <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
            Thinking…
          </div>
        </Show>
      </div>

      <div class="flex items-end gap-2 border-t border-[var(--color-border-soft)] pt-2">
        <textarea
          ref={inputEl}
          rows={1}
          class="min-h-[36px] max-h-32 flex-1 resize-none rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg-base)] px-2.5 py-2 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)] focus:outline-none"
          placeholder={props.followUpPlaceholder ?? "Ask a follow-up…"}
          disabled={busy() || !seedDto()}
          value={input()}
          onInput={(e) => {
            setInput(e.currentTarget.value);
            // auto-grow
            e.currentTarget.style.height = "auto";
            e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 128)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitFollowUp();
            }
          }}
        />
        <button
          class="btn-base btn-primary h-9 shrink-0 px-3"
          onClick={submitFollowUp}
          disabled={busy() || input().trim() === ""}
          title="Send (Enter)"
        >
          <Icon name="send" size={14} />
        </button>
      </div>
    </div>
  );
}
