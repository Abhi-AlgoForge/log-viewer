//! Multi-provider LLM client (Anthropic, OpenAI, DeepSeek, OpenAI-compatible).
//!
//! Each provider has a default base URL and default fast/smart model names;
//! users can override any of these in Settings. One provider is active at a
//! time. API keys live in `<config-dir>/log-viewer/config.json` and never
//! leave the Rust process — the frontend invokes typed commands that wrap the
//! HTTP calls here.

use crate::error::{AppError, AppResult};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

pub mod prompts;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Speed {
    /// Cheap, fast — translation, classification.
    Fast,
    /// Reasoning, summarization, explanation.
    Smart,
}

/// One turn in a multi-turn chat. `role` is "user" or "assistant"; "system"
/// goes through the dedicated `system` parameter on `call_chat_multi`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Anthropic,
    OpenAI,
    DeepSeek,
}

impl Provider {
    pub fn from_id(s: &str) -> Option<Self> {
        match s {
            "anthropic" => Some(Self::Anthropic),
            "openai" => Some(Self::OpenAI),
            "deepseek" => Some(Self::DeepSeek),
            _ => None,
        }
    }

    pub fn default_base_url(&self) -> &'static str {
        match self {
            Self::Anthropic => "https://api.anthropic.com/v1",
            Self::OpenAI => "https://api.openai.com/v1",
            Self::DeepSeek => "https://api.deepseek.com/v1",
        }
    }

    pub fn default_fast(&self) -> &'static str {
        match self {
            Self::Anthropic => "claude-haiku-4-5-20251001",
            Self::OpenAI => "gpt-4o-mini",
            Self::DeepSeek => "deepseek-chat",
        }
    }

    pub fn default_smart(&self) -> &'static str {
        match self {
            Self::Anthropic => "claude-sonnet-4-6",
            Self::OpenAI => "gpt-4o",
            Self::DeepSeek => "deepseek-reasoner",
        }
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub fast_model: Option<String>,
    #[serde(default)]
    pub smart_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    #[serde(default = "default_active")]
    pub active_provider: String,
    #[serde(default)]
    pub providers: HashMap<String, ProviderSettings>,
    /// Legacy v0 field: a single Anthropic key. Migrated into
    /// `providers["anthropic"].api_key` on load.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

fn default_active() -> String {
    "anthropic".to_string()
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            active_provider: default_active(),
            providers: HashMap::new(),
            api_key: None,
        }
    }
}

impl AiConfig {
    /// Convert legacy `api_key` field into a structured provider entry.
    fn migrate(mut self) -> Self {
        if let Some(key) = self.api_key.take() {
            let entry = self.providers.entry("anthropic".to_string()).or_default();
            if entry.api_key.is_none() {
                entry.api_key = Some(key);
            }
        }
        self
    }

    pub fn settings(&self, provider: &str) -> Option<&ProviderSettings> {
        self.providers.get(provider)
    }
}

#[derive(Default)]
pub struct AiState {
    pub config: RwLock<AiConfig>,
}

impl AiState {
    pub fn load() -> Self {
        let cfg = read_config().unwrap_or_default().migrate();
        // Persist the migration so legacy field stops appearing in the JSON.
        let _ = write_config(&cfg);
        Self { config: RwLock::new(cfg) }
    }

    pub fn snapshot(&self) -> AiConfig {
        self.config.read().clone()
    }

    pub fn set_provider_settings(
        &self,
        provider: &str,
        settings: ProviderSettings,
    ) -> AppResult<()> {
        if Provider::from_id(provider).is_none() {
            return Err(AppError::InvalidRequest(format!("unknown provider: {provider}")));
        }
        {
            let mut g = self.config.write();
            g.providers.insert(provider.to_string(), settings);
        }
        write_config(&self.config.read())
    }

    pub fn set_active(&self, provider: &str) -> AppResult<()> {
        if Provider::from_id(provider).is_none() {
            return Err(AppError::InvalidRequest(format!("unknown provider: {provider}")));
        }
        {
            let mut g = self.config.write();
            g.active_provider = provider.to_string();
        }
        write_config(&self.config.read())
    }
}

fn config_path() -> AppResult<PathBuf> {
    let mut p = dirs::config_dir().ok_or_else(|| AppError::Other("no config dir".into()))?;
    p.push("log-viewer");
    std::fs::create_dir_all(&p)?;
    p.push("config.json");
    Ok(p)
}

fn read_config() -> AppResult<AiConfig> {
    let p = config_path()?;
    if !p.exists() {
        return Ok(AiConfig::default());
    }
    let s = std::fs::read_to_string(&p)?;
    Ok(serde_json::from_str(&s).unwrap_or_default())
}

fn write_config(cfg: &AiConfig) -> AppResult<()> {
    let p = config_path()?;
    let s = serde_json::to_string_pretty(cfg)
        .map_err(|e| AppError::Other(format!("serialize config: {e}")))?;
    std::fs::write(&p, s)?;
    Ok(())
}

/// Single-turn convenience wrapper around [`call_chat_multi`].
pub async fn call_chat(
    cfg: &AiConfig,
    speed: Speed,
    system: &str,
    user: &str,
    max_tokens: u32,
    temperature: f32,
) -> AppResult<String> {
    let msgs = [ChatMessage { role: "user".into(), content: user.into() }];
    call_chat_multi(cfg, speed, system, &msgs, max_tokens, temperature).await
}

/// Dispatch a multi-turn chat completion to whichever provider is active.
/// `messages` must alternate user/assistant and end with a user message.
/// The frontend only ever sees `Speed::Fast` / `Speed::Smart`; the model name
/// comes from per-provider config (or the provider's default).
pub async fn call_chat_multi(
    cfg: &AiConfig,
    speed: Speed,
    system: &str,
    messages: &[ChatMessage],
    max_tokens: u32,
    temperature: f32,
) -> AppResult<String> {
    let provider = Provider::from_id(&cfg.active_provider).ok_or_else(|| {
        AppError::InvalidRequest(format!(
            "no active AI provider (got: {})",
            cfg.active_provider
        ))
    })?;
    let settings = cfg
        .settings(&cfg.active_provider)
        .cloned()
        .unwrap_or_default();
    let key = settings.api_key.as_deref().filter(|k| !k.is_empty()).ok_or_else(|| {
        AppError::InvalidRequest(format!(
            "API key for {} is not set — open Settings → AI",
            cfg.active_provider
        ))
    })?;
    let base = settings
        .base_url
        .as_deref()
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| provider.default_base_url());
    let model = match speed {
        Speed::Fast => settings
            .fast_model
            .as_deref()
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| provider.default_fast()),
        Speed::Smart => settings
            .smart_model
            .as_deref()
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| provider.default_smart()),
    };
    match provider {
        Provider::Anthropic => {
            call_anthropic_multi(key, base, model, system, messages, max_tokens, temperature).await
        }
        Provider::OpenAI | Provider::DeepSeek => {
            call_openai_multi(key, base, model, system, messages, max_tokens, temperature).await
        }
    }
}

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::Other(format!("http client: {e}")))
}

// ---------- Anthropic (Messages API + prompt cache) ----------

#[derive(Serialize)]
struct AnthropicBody<'a> {
    model: &'a str,
    max_tokens: u32,
    temperature: f32,
    system: Vec<AnthropicSystemBlock<'a>>,
    messages: Vec<AnthropicMessage<'a>>,
}
#[derive(Serialize)]
struct AnthropicSystemBlock<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<AnthropicCacheControl>,
}
#[derive(Serialize)]
struct AnthropicCacheControl {
    #[serde(rename = "type")]
    kind: &'static str,
}
#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}
#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicBlock>,
}
#[derive(Deserialize)]
struct AnthropicBlock {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

async fn call_anthropic_multi(
    api_key: &str,
    base_url: &str,
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    max_tokens: u32,
    temperature: f32,
) -> AppResult<String> {
    let msgs: Vec<AnthropicMessage> = messages
        .iter()
        .map(|m| AnthropicMessage { role: m.role.as_str(), content: m.content.as_str() })
        .collect();
    let body = AnthropicBody {
        model,
        max_tokens,
        temperature,
        system: vec![AnthropicSystemBlock {
            kind: "text",
            text: system,
            cache_control: Some(AnthropicCacheControl { kind: "ephemeral" }),
        }],
        messages: msgs,
    };
    let url = format!("{}/messages", base_url.trim_end_matches('/'));
    let resp = http_client()?
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("anthropic request: {e}")))?;
    let status = resp.status();
    let raw = resp
        .text()
        .await
        .map_err(|e| AppError::Other(format!("read body: {e}")))?;
    if !status.is_success() {
        return Err(AppError::Other(format!(
            "anthropic {status}: {}",
            raw.chars().take(400).collect::<String>()
        )));
    }
    let parsed: AnthropicResponse = serde_json::from_str(&raw)
        .map_err(|e| AppError::Other(format!("parse anthropic response: {e} — {}", &raw[..raw.len().min(400)])))?;
    Ok(parsed
        .content
        .into_iter()
        .filter(|b| b.kind == "text")
        .filter_map(|b| b.text)
        .collect::<Vec<_>>()
        .join("\n"))
}

// ---------- OpenAI-compatible (Chat Completions) ----------

#[derive(Serialize)]
struct OpenAiBody<'a> {
    model: &'a str,
    max_tokens: u32,
    temperature: f32,
    messages: Vec<OpenAiMessage<'a>>,
}
#[derive(Serialize)]
struct OpenAiMessage<'a> {
    role: &'a str,
    content: &'a str,
}
#[derive(Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}
#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
}
#[derive(Deserialize)]
struct OpenAiResponseMessage {
    content: Option<String>,
}

async fn call_openai_multi(
    api_key: &str,
    base_url: &str,
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    max_tokens: u32,
    temperature: f32,
) -> AppResult<String> {
    let mut msgs: Vec<OpenAiMessage> = Vec::with_capacity(messages.len() + 1);
    msgs.push(OpenAiMessage { role: "system", content: system });
    for m in messages {
        msgs.push(OpenAiMessage { role: m.role.as_str(), content: m.content.as_str() });
    }
    let body = OpenAiBody {
        model,
        max_tokens,
        temperature,
        messages: msgs,
    };
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let resp = http_client()?
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("openai request: {e}")))?;
    let status = resp.status();
    let raw = resp
        .text()
        .await
        .map_err(|e| AppError::Other(format!("read body: {e}")))?;
    if !status.is_success() {
        return Err(AppError::Other(format!(
            "{status}: {}",
            raw.chars().take(400).collect::<String>()
        )));
    }
    let parsed: OpenAiResponse = serde_json::from_str(&raw)
        .map_err(|e| AppError::Other(format!("parse openai response: {e} — {}", &raw[..raw.len().min(400)])))?;
    Ok(parsed
        .choices
        .into_iter()
        .filter_map(|c| c.message.content)
        .collect::<Vec<_>>()
        .join("\n"))
}
