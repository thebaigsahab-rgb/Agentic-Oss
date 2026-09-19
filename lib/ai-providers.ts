import type { AiKeyProvider, AiModelOption, AiProvider, LocalAiProvider, PublicSettings } from "./types";

export const AI_KEY_PROVIDERS: AiKeyProvider[] = ["openai", "anthropic", "gemini", "xai", "groq", "nvidia", "lmstudio", "ollama"];
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  none: "Off — built-in ranking only",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  xai: "xAI · Grok",
  groq: "Groq (Fast LPU)",
  nvidia: "NVIDIA NIM",
  lmstudio: "LM Studio · local",
  ollama: "Ollama · local",
};
export const DEFAULT_AI_MODELS: Record<AiKeyProvider, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-3.7-flash",
  xai: "grok-4.6",
  groq: "openai/gpt-oss-120b",
  nvidia: "openai/gpt-oss-120b",
  lmstudio: "",
  ollama: "",
};
export const DEFAULT_LOCAL_AI_URLS: Record<LocalAiProvider, string> = {
  lmstudio: "http://127.0.0.1:1234",
  ollama: "http://127.0.0.1:11434",
};

export function isAiKeyProvider(value: unknown): value is AiKeyProvider {
  return typeof value === "string" && AI_KEY_PROVIDERS.includes(value as AiKeyProvider);
}

export function isLocalAiProvider(provider: AiProvider): provider is LocalAiProvider {
  return provider === "lmstudio" || provider === "ollama";
}

export function aiSupportsWebSearch(provider: AiProvider) {
  return provider !== "none" && !isLocalAiProvider(provider);
}

export function aiEnvironmentKey(provider: AiKeyProvider, environment: Record<string, string | undefined>) {
  return ({
    openai: environment.OPENAI_API_KEY,
    anthropic: environment.ANTHROPIC_API_KEY,
    gemini: environment.GEMINI_API_KEY || environment.GOOGLE_API_KEY,
    xai: environment.XAI_API_KEY,
    groq: environment.GROQ_API_KEY || environment.GROK_API_KEY,
    nvidia: environment.NVIDIA_API_KEY || environment.NVAPI_KEY,
    lmstudio: environment.LM_STUDIO_API_KEY || environment.LM_API_TOKEN,
    ollama: environment.OLLAMA_LOCAL_API_KEY,
  }[provider] || "").trim();
}

// A local selection is configured without a cloud API key. Availability is
// checked against the running server before every inference, not fabricated here.
export function isAiReady(ai: Pick<PublicSettings["ai"], "provider" | "keySet">) {
  return ai.provider !== "none" && (isLocalAiProvider(ai.provider) || Boolean(ai.keySet[ai.provider]));
}

export function isValidAiModelId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:/+\-]{0,199}$/i.test(value) && !value.includes("://");
}

export function cleanAiModelOverride(value: unknown) {
  if (value === "" || value === undefined || value === "default") return "";
  if (typeof value !== "string" || !isValidAiModelId(value.trim()))
    throw new Error("Choose a model from the model dropdown. Email addresses and URLs are not model IDs.");
  return value.trim();
}

export function localAiBaseUrl(provider: LocalAiProvider, input?: string) {
  const raw = input?.trim() || DEFAULT_LOCAL_AI_URLS[provider];
  let url: URL;
  try { url = new URL(raw); } catch {
    throw new Error("Enter a local server address such as http://127.0.0.1:1234.");
  }
  if (!["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) ||
      url.username || url.password || url.search || url.hash ||
      !["/", "", "/v1", "/v1/", "/api", "/api/"].includes(url.pathname)) {
    throw new Error("Local AI servers must use localhost, 127.0.0.1, or [::1], with no credentials, query, or custom path. Remote endpoints are not supported.");
  }
  // Pin localhost to a numeric loopback address; never resolve a configurable hostname.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

function actualContextLength(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function isRemoteAiModel(value: unknown) {
  const model = record(value);
  const name = String(model.name || model.id || model.model || model.key || "");
  return /(?:^|[:/\-])cloud(?:$|[:/\-])/i.test(name) ||
    Boolean(model.remote_host || model.remote_model || model.remoteHost || model.remoteModel || model.remote || model.is_remote) ||
    ["cloud", "remote"].includes(String(model.source || model.location || "").toLowerCase());
}

function textModelName(id: string) {
  return !/(?:^|[-_/:])(?:embedding|embeddings|embed|rerank|moderation|tts|whisper|transcribe|transcription|audio|realtime|image|imagine|vision-preview|video|sora|dall-e|dalle)(?:$|[-_/:\d])/i.test(id);
}

export function normalizeAiModels(provider: AiKeyProvider, payload: unknown): AiModelOption[] {
  const body = record(payload);
  const entries = rows(body.models ?? body.data);
  const options = entries.flatMap((model): AiModelOption[] => {
    const rawId = model.id ?? model.name ?? model.model ?? model.key;
    const id = typeof rawId === "string" ? rawId.replace(/^models\//, "") : "";
    if (!isValidAiModelId(id) || !textModelName(id)) return [];
    let label = String(model.display_name || model.displayName || id).slice(0, 200);
    if (provider === "openai") {
      if (!/^(?:gpt-(?:[3-9]|[1-9]\d)|o\d|chatgpt-|ft:(?:gpt-|o\d))/i.test(id)) return [];
      // Specialized search/agent and legacy Completions-only models do not use
      // the ordinary text-curation request shape supported by this app.
      if (/(?:^|[-_:])(?:search|deep-research|computer-use|instruct)(?:$|[-_:])/i.test(id)) return [];
    }
    if (provider === "anthropic" && !id.startsWith("claude-")) return [];
    if (provider === "gemini" && (!Array.isArray(model.supportedGenerationMethods) || !model.supportedGenerationMethods.includes("generateContent"))) return [];
    if (provider === "xai" && Array.isArray(model.output_modalities) && !model.output_modalities.includes("text")) return [];
    if (provider === "groq") {
      if (model.active === false) return [];
      if (Array.isArray(model.output_modalities) && !model.output_modalities.includes("text")) return [];
      if (/(?:guard|whisper|orpheus)/i.test(id)) return [];
    }
    if (provider === "nvidia") {
      if (/(?:embed|guard|safety|reward|parse|clip|translate|detector)/i.test(id)) return [];
    }
    if (isLocalAiProvider(provider)) {
      if (isRemoteAiModel(model)) return [];
      if (provider === "lmstudio") {
        if (!["llm", "vlm"].includes(String(model.type))) return [];
        const instances = rows(model.loaded_instances);
        if (instances.length) {
          return instances.flatMap((instance) => {
            const instanceId = instance.id;
            if (!isValidAiModelId(instanceId) || isRemoteAiModel(instance)) return [];
            const contextLength = actualContextLength(record(instance.config).context_length);
            return [{ id: instanceId, label: `${label}${instanceId !== id ? ` · ${instanceId}` : ""}`, contextLength }];
          });
        }
        if (model.state !== "loaded") return [];
      } else {
        // /api/ps proves loaded state; /api/show proves text capability and
        // supplies remote_host/remote_model fields for cloud aliases.
        const details = record(model.details);
        if (details.format !== "gguf" || !Array.isArray(model.capabilities) || !model.capabilities.includes("completion")) return [];
      }
      label = `${label} · loaded`;
    }
    return [{ id, label, ...(provider === "ollama" ? { contextLength: actualContextLength(model.context_length) } : {}) }];
  });
  return [...new Map(options.map((model) => [model.id, model])).values()]
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function defaultAiModel(provider: AiKeyProvider, models: AiModelOption[]) {
  if (isLocalAiProvider(provider)) {
    // Prefer usable reported capacity when multiple models are already loaded.
    // Never load another model or increase the user's allocation automatically.
    return [...models].sort((left, right) => (right.contextLength || 0) - (left.contextLength || 0))[0]?.id || "";
  }
  const recommended = DEFAULT_AI_MODELS[provider];
  return models.find((model) => model.id === recommended)?.id || models[0]?.id || recommended;
}
