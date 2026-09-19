import "server-only";

import type { AiKeyProvider, AiModelOption } from "@/lib/types";
import {
  configuredAiApiKey,
  type StoredSettings,
} from "@/lib/server/settings";
import { AI_PROVIDER_LABELS, DEFAULT_AI_MODELS, aiSupportsWebSearch, cleanAiModelOverride, isLocalAiProvider, localAiBaseUrl } from "@/lib/ai-providers";
import { aiProviderJson } from "@/lib/ai-provider-http";
import { discoverAiModels } from "@/lib/server/ai-models";
import { assertLocalAiContext } from "@/lib/ai-local-context";

export type AiRunOptions = {
  prompt: string;
  webSearch?: boolean;
  maxOutputTokens?: number;
};

export type AiRunResult = {
  provider: AiKeyProvider;
  model: string;
  text: string;
};

export class AiNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

async function modelFor(settings: StoredSettings, provider: AiKeyProvider): Promise<AiModelOption> {
  const override = cleanAiModelOverride(settings.ai.model);
  if (isLocalAiProvider(provider)) {
    // Do not auto-load a downloaded model or accidentally use a cloud alias.
    const available = await discoverAiModels(settings, { refresh: true });
    const model = override || available.defaultModel;
    const selected = available.models.find((item) => item.id === model);
    if (!model || !selected)
      throw new AiNotConfiguredError(`${AI_PROVIDER_LABELS[provider]} has no matching loaded text model. Load a local model in that app, then reload models in Settings.`);
    return selected;
  }
  if (override) return { id: override, label: override };
  try {
    const available = await discoverAiModels(settings);
    const model = available.defaultModel || DEFAULT_AI_MODELS[provider];
    return { id: model, label: model };
  } catch {
    // Model-list permissions can differ from inference permissions. A known
    // default may still run; inference failure remains explicit to the caller.
    return { id: DEFAULT_AI_MODELS[provider], label: DEFAULT_AI_MODELS[provider] };
  }
}

function boundedTokens(value = 1_500) {
  return Math.min(8_000, Math.max(250, Math.round(value)));
}

async function providerFetch(
  provider: AiKeyProvider,
  url: string,
  init: RequestInit,
) {
  return aiProviderJson(provider, url, init, { timeoutMs: isLocalAiProvider(provider) ? 120_000 : 45_000 });
}

function openAiText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    return content.flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const text = (block as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    });
  }).join("\n");
}

function anthropicText(payload: Record<string, unknown>) {
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const text = (block as { text?: unknown }).text;
    return typeof text === "string" ? [text] : [];
  }).join("\n");
}

function geminiText(payload: Record<string, unknown>) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object") return [];
    const parts = Array.isArray((content as { parts?: unknown }).parts)
      ? (content as { parts: unknown[] }).parts
      : [];
    return parts.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    });
  }).join("\n");
}

async function runOpenAi(
  key: string,
  model: string,
  options: AiRunOptions,
) {
  // The older GPT-3.5/GPT-4 and ChatGPT aliases use Chat Completions, not the
  // Responses API. They remain useful for curation but have no built-in search.
  const chatOnly = /^(?:gpt-3|gpt-4(?:-|$)|chatgpt-|ft:)/i.test(model) || /-chat-latest(?:-|$)/i.test(model);
  if (chatOnly) {
    if (options.webSearch) throw new Error("This OpenAI model does not support built-in web research. Select Default or a Responses API model for that feature.");
    return chatCompletionText(await providerFetch("openai", "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: options.prompt }],
        ...(/^(?:ft:)?(?:gpt-5|o\d)/i.test(model)
          ? { max_completion_tokens: boundedTokens(options.maxOutputTokens) }
          : { max_tokens: Math.min(4_096, boundedTokens(options.maxOutputTokens)) }),
        store: false,
      }),
    }));
  }
  const payload = await providerFetch("openai", "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: options.prompt,
      store: false,
      max_output_tokens: boundedTokens(options.maxOutputTokens),
      ...(/^(?:gpt-5|o\d)/i.test(model) && !/-pro(?:-|$)/.test(model)
        ? { reasoning: { effort: "low" } }
        : {}),
      ...(options.webSearch ? { tools: [{ type: "web_search" }] } : {}),
    }),
  });
  return openAiText(payload);
}

async function runAnthropic(
  key: string,
  model: string,
  options: AiRunOptions,
) {
  const body = {
    model,
    max_tokens: boundedTokens(options.maxOutputTokens),
    messages: [{ role: "user", content: options.prompt }],
    ...(options.webSearch
      ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }] }
      : {}),
  };
  let payload = await providerFetch("anthropic", "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (payload.stop_reason === "pause_turn" && Array.isArray(payload.content)) {
    payload = await providerFetch("anthropic", "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        messages: [
          ...body.messages,
          { role: "assistant", content: payload.content },
        ],
      }),
    });
  }
  return anthropicText(payload);
}

async function runGemini(
  key: string,
  model: string,
  options: AiRunOptions,
) {
  const safeModel = encodeURIComponent(model);
  const payload = await providerFetch(
    "gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: options.prompt }] }],
        generationConfig: {
          ...(!options.webSearch ? { responseMimeType: "application/json" } : {}),
          maxOutputTokens: boundedTokens(options.maxOutputTokens),
        },
        ...(options.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
      }),
    },
  );
  return geminiText(payload);
}

function chatCompletionText(payload: Record<string, unknown>) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as { message?: { content?: unknown; reasoning?: unknown } } | undefined;
  const content = typeof first?.message?.content === "string" ? first.message.content : "";
  if (content.trim()) return content;
  const reasoning = typeof first?.message?.reasoning === "string" ? first.message.reasoning : "";
  return reasoning;
}

async function runXai(key: string, model: string, options: AiRunOptions) {
  const payload = await providerFetch("xai", "https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: options.prompt }],
      store: false,
      max_output_tokens: boundedTokens(options.maxOutputTokens),
      ...(options.webSearch ? { tools: [{ type: "web_search" }] } : {}),
    }),
  });
  return openAiText(payload);
}

async function runGroq(key: string, model: string, options: AiRunOptions) {
  const payload = await providerFetch("groq", "https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: options.prompt }],
      max_tokens: boundedTokens(options.maxOutputTokens),
      temperature: 0.2,
    }),
  });
  return chatCompletionText(payload);
}

async function runNvidia(key: string, model: string, options: AiRunOptions) {
  const payload = await providerFetch("nvidia", "https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: options.prompt }],
      max_tokens: boundedTokens(options.maxOutputTokens),
      temperature: 0.2,
    }),
  });
  return chatCompletionText(payload);
}

// Local runtimes load a model with a fixed context budget, so a larger
// default output allowance is safe there; cloud defaults stay conservative.
const LOCAL_DEFAULT_OUTPUT_TOKENS = 4_000;

async function runLocalAi(settings: StoredSettings, provider: "lmstudio" | "ollama", key: string, model: string, options: AiRunOptions, loadedContextLength?: number) {
  const outputTokens = boundedTokens(options.maxOutputTokens ?? LOCAL_DEFAULT_OUTPUT_TOKENS);
  const contextLength = assertLocalAiContext(provider, loadedContextLength, options.prompt, outputTokens);
  const root = localAiBaseUrl(provider, settings.ai.localBaseUrls[provider]);
  const payload = await providerFetch(provider, `${root}${provider === "lmstudio" ? "/v1/chat/completions" : "/api/chat"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: options.prompt }],
      stream: false,
      ...(provider === "lmstudio"
        ? { max_tokens: outputTokens }
        // Omit keep_alive: retain Ollama's user-configured server/runner lifetime.
        : { options: { num_predict: outputTokens, num_ctx: contextLength }, truncate: false, shift: false }),
    }),
  });
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const finish = provider === "lmstudio"
    ? (choices[0] as { finish_reason?: unknown } | undefined)?.finish_reason
    : payload.done_reason;
  if (["length", "max_tokens", "context_length"].includes(String(finish)) || payload.done === false)
    throw new Error(`${AI_PROVIDER_LABELS[provider]} stopped before completing its answer. Use a model with a larger context/output allowance and retry; this incomplete result was not saved.`);
  if (provider === "lmstudio") return chatCompletionText(payload);
  const message = payload.message as { content?: unknown } | undefined;
  return typeof message?.content === "string" ? message.content : "";
}

async function executeProvider(
  provider: AiKeyProvider,
  settings: StoredSettings,
  options: AiRunOptions,
): Promise<AiRunResult> {
  const key = configuredAiApiKey(settings, provider);
  if (!key && !isLocalAiProvider(provider))
    throw new AiNotConfiguredError(
      `${AI_PROVIDER_LABELS[provider] || provider} is selected, but no API key is available in Settings or the local environment.`,
    );
  if (options.webSearch && !aiSupportsWebSearch(provider))
    throw new AiNotConfiguredError(`${AI_PROVIDER_LABELS[provider]} can summarize and rank collected content, but it does not provide live web research. The built-in public-source collectors continue to run.`);
  const selectedModel = await modelFor(settings, provider);
  const model = selectedModel.id;
  const text = provider === "openai"
    ? await runOpenAi(key, model, options)
    : provider === "anthropic"
      ? await runAnthropic(key, model, options)
      : provider === "gemini"
        ? await runGemini(key, model, options)
        : provider === "xai"
          ? await runXai(key, model, options)
          : provider === "groq"
            ? await runGroq(key, model, options)
            : provider === "nvidia"
              ? await runNvidia(key, model, options)
              : await runLocalAi(settings, provider, key, model, options, selectedModel.contextLength);
  if (!text.trim()) throw new Error(`${AI_PROVIDER_LABELS[provider] || provider} returned no usable text.`);
  return { provider, model, text };
}

export async function runConfiguredAi(
  settings: StoredSettings,
  options: AiRunOptions,
): Promise<AiRunResult> {
  const provider = settings.ai.provider;
  if (provider === "none")
    throw new AiNotConfiguredError("AI curation is off in Settings.");

  try {
    return await executeProvider(provider, settings, options);
  } catch (primaryError) {
    const isValidationError = (primaryError as Error).message.includes("does not provide live web research") ||
      (primaryError as Error).message.includes("actual context capacity") ||
      (primaryError as Error).message.includes("stopped before completing its answer") ||
      isLocalAiProvider(provider);

    const backup = (!isValidationError && settings.ai.backupProvider && settings.ai.backupProvider !== "none" && settings.ai.backupProvider !== provider)
      ? settings.ai.backupProvider
      : undefined;

    if (backup) {
      try {
        console.warn(`[AI Failover] Primary provider ${provider} failed (${(primaryError as Error).message}). Falling back to backup provider ${backup}...`);
        return await executeProvider(backup, settings, options);
      } catch (backupError) {
        console.error(`[AI Failover] Backup provider ${backup} also failed:`, backupError);
      }
    }
    throw primaryError;
  }
}

export function parseAiJson<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidates = [trimmed, fenced].filter((value): value is string => Boolean(value));
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace)
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket)
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next bounded JSON representation.
    }
  }
  throw new Error("The AI provider returned invalid JSON.");
}

// ---------------------------------------------------------------------------
// Token streaming — used for interactive conversations where perceived
// latency matters. Falls back to the single-shot path above if a provider
// rejects streaming, so callers never lose an answer because of it.
// ---------------------------------------------------------------------------

async function providerStreamResponse(
  provider: AiKeyProvider,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), isLocalAiProvider(provider) ? 120_000 : 60_000);
  const label = AI_PROVIDER_LABELS[provider];
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok || response.redirected || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        response.status >= 300 && response.status < 400 || response.redirected
          ? `${label} tried to redirect the request. Redirects are blocked to protect your key and data.`
          : `${label} returned HTTP ${response.status}. Check the selected provider, its key, and server access.`,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} timed out. Check that the service is running, then try again.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function* sseDataPayloads(response: Response): AsyncGenerator<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith("data:")) yield rest.slice(5).trim();
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

async function* ndjsonPayloads(response: Response): AsyncGenerator<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) yield line;
      }
    }
    if (buffer.trim()) yield buffer.trim();
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

async function consumeChatCompletionsStream(response: Response, forward: (delta: string) => void): Promise<string> {
  let text = "";
  for await (const payload of sseDataPayloads(response)) {
    if (payload === "[DONE]") break;
    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      const delta = parsed.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        text += delta;
        forward(delta);
      }
    } catch {
      // Ignore malformed keep-alive fragments.
    }
  }
  return text;
}

async function consumeResponsesStream(response: Response, forward: (delta: string) => void): Promise<string> {
  let text = "";
  for await (const payload of sseDataPayloads(response)) {
    if (payload === "[DONE]") break;
    try {
      const parsed = JSON.parse(payload) as { type?: string; delta?: unknown; text?: unknown; error?: unknown };
      if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
        text += parsed.delta;
        forward(parsed.delta);
      } else if (parsed.type === "response.failed" || parsed.type === "response.error" || parsed.type === "error") {
        throw new Error("The provider reported a streaming error before completing its answer.");
      } else if (parsed.type === "response.completed" || parsed.type === "response.incomplete") {
        break;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("streaming error")) throw error;
    }
  }
  return text;
}

async function consumeAnthropicStream(response: Response, forward: (delta: string) => void): Promise<string> {
  let text = "";
  for await (const payload of sseDataPayloads(response)) {
    if (payload === "[DONE]") break;
    try {
      const parsed = JSON.parse(payload) as {
        type?: string;
        delta?: { type?: string; text?: unknown };
        error?: unknown;
      };
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && typeof parsed.delta.text === "string") {
        text += parsed.delta.text;
        forward(parsed.delta.text);
      } else if (parsed.type === "message_stop") {
        break;
      } else if (parsed.type === "error") {
        throw new Error("Anthropic reported a streaming error before completing its answer.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("streaming error")) throw error;
    }
  }
  return text;
}

async function consumeGeminiStream(response: Response, forward: (delta: string) => void): Promise<string> {
  let text = "";
  for await (const payload of sseDataPayloads(response)) {
    try {
      const parsed = JSON.parse(payload) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
      };
      const parts = parsed.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (typeof part.text === "string" && part.text) {
          text += part.text;
          forward(part.text);
        }
      }
    } catch {
      // Ignore malformed keep-alive fragments.
    }
  }
  return text;
}

async function consumeOllamaStream(response: Response, forward: (delta: string) => void): Promise<string> {
  let text = "";
  let completed = false;
  for await (const payload of ndjsonPayloads(response)) {
    try {
      const parsed = JSON.parse(payload) as {
        message?: { content?: unknown };
        done?: boolean;
        done_reason?: unknown;
      };
      if (typeof parsed.message?.content === "string" && parsed.message.content) {
        text += parsed.message.content;
        forward(parsed.message.content);
      }
      if (parsed.done) completed = true;
    } catch {
      // Ignore malformed keep-alive fragments.
    }
  }
  if (!completed && !text) {
    throw new Error(`${AI_PROVIDER_LABELS.ollama} stopped before completing its answer. Use a model with a larger context/output allowance and retry.`);
  }
  return text;
}

async function streamOpenAi(
  key: string,
  model: string,
  options: AiRunOptions,
  forward: (delta: string) => void,
): Promise<string> {
  const chatOnly = /^(?:gpt-3|gpt-4(?:-|$)|chatgpt-|ft:)/i.test(model) || /-chat-latest(?:-|$)/i.test(model);
  if (chatOnly) {
    if (options.webSearch) throw new Error("This OpenAI model does not support built-in web research. Select Default or a Responses API model for that feature.");
    const response = await providerStreamResponse("openai", "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: options.prompt }],
        stream: true,
        ...(/^(?:ft:)?(?:gpt-5|o\d)/i.test(model)
          ? { max_completion_tokens: boundedTokens(options.maxOutputTokens) }
          : { max_tokens: Math.min(4_096, boundedTokens(options.maxOutputTokens)) }),
        store: false,
      }),
    });
    return consumeChatCompletionsStream(response, forward);
  }
  const response = await providerStreamResponse("openai", "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: options.prompt,
      stream: true,
      store: false,
      max_output_tokens: boundedTokens(options.maxOutputTokens),
      ...(/^(?:gpt-5|o\d)/i.test(model) && !/-pro(?:-|$)/.test(model)
        ? { reasoning: { effort: "low" } }
        : {}),
      ...(options.webSearch ? { tools: [{ type: "web_search" }] } : {}),
    }),
  });
  return consumeResponsesStream(response, forward);
}

async function streamAnthropic(
  key: string,
  model: string,
  options: AiRunOptions,
  forward: (delta: string) => void,
): Promise<string> {
  const response = await providerStreamResponse("anthropic", "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: boundedTokens(options.maxOutputTokens),
      stream: true,
      messages: [{ role: "user", content: options.prompt }],
      ...(options.webSearch
        ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }] }
        : {}),
    }),
  });
  return consumeAnthropicStream(response, forward);
}

async function streamGemini(
  key: string,
  model: string,
  options: AiRunOptions,
  forward: (delta: string) => void,
): Promise<string> {
  const safeModel = encodeURIComponent(model);
  const response = await providerStreamResponse(
    "gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: options.prompt }] }],
        generationConfig: { maxOutputTokens: boundedTokens(options.maxOutputTokens) },
        ...(options.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
      }),
    },
  );
  return consumeGeminiStream(response, forward);
}

async function streamGroqCompatible(
  provider: AiKeyProvider,
  url: string,
  key: string,
  model: string,
  options: AiRunOptions,
  forward: (delta: string) => void,
): Promise<string> {
  const response = await providerStreamResponse(provider, url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: options.prompt }],
      stream: true,
      max_tokens: boundedTokens(options.maxOutputTokens),
      temperature: 0.2,
    }),
  });
  return consumeChatCompletionsStream(response, forward);
}

async function streamLocalAi(
  settings: StoredSettings,
  provider: "lmstudio" | "ollama",
  key: string,
  model: string,
  options: AiRunOptions,
  loadedContextLength: number | undefined,
  forward: (delta: string) => void,
): Promise<string> {
  const outputTokens = boundedTokens(options.maxOutputTokens ?? LOCAL_DEFAULT_OUTPUT_TOKENS);
  const contextLength = assertLocalAiContext(provider, loadedContextLength, options.prompt, outputTokens);
  const root = localAiBaseUrl(provider, settings.ai.localBaseUrls[provider]);
  const response = await providerStreamResponse(provider, `${root}${provider === "lmstudio" ? "/v1/chat/completions" : "/api/chat"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(
      provider === "lmstudio"
        ? {
            model,
            messages: [{ role: "user", content: options.prompt }],
            stream: true,
            max_tokens: outputTokens,
          }
        : {
            model,
            messages: [{ role: "user", content: options.prompt }],
            stream: true,
            options: { num_predict: outputTokens, num_ctx: contextLength },
          },
    ),
  });
  return provider === "lmstudio"
    ? consumeChatCompletionsStream(response, forward)
    : consumeOllamaStream(response, forward);
}

async function streamProvider(
  provider: AiKeyProvider,
  settings: StoredSettings,
  options: AiRunOptions,
  forward: (delta: string) => void,
): Promise<AiRunResult> {
  const key = configuredAiApiKey(settings, provider);
  if (!key && !isLocalAiProvider(provider))
    throw new AiNotConfiguredError(
      `${AI_PROVIDER_LABELS[provider] || provider} is selected, but no API key is available in Settings or the local environment.`,
    );
  if (options.webSearch && !aiSupportsWebSearch(provider))
    throw new AiNotConfiguredError(`${AI_PROVIDER_LABELS[provider]} can summarize and rank collected content, but it does not provide live web research. The built-in public-source collectors continue to run.`);
  const selectedModel = await modelFor(settings, provider);
  const model = selectedModel.id;
  const text = provider === "openai"
    ? await streamOpenAi(key, model, options, forward)
    : provider === "anthropic"
      ? await streamAnthropic(key, model, options, forward)
      : provider === "gemini"
        ? await streamGemini(key, model, options, forward)
        : provider === "xai"
          ? await streamOpenAi(key, model, options, forward)
          : provider === "groq"
            ? await streamGroqCompatible("groq", "https://api.groq.com/openai/v1/chat/completions", key, model, options, forward)
            : provider === "nvidia"
              ? await streamGroqCompatible("nvidia", "https://integrate.api.nvidia.com/v1/chat/completions", key, model, options, forward)
              : await streamLocalAi(settings, provider, key, model, options, selectedModel.contextLength, forward);
  if (!text.trim()) throw new Error(`${AI_PROVIDER_LABELS[provider] || provider} returned no usable text.`);
  return { provider, model, text };
}

export async function runConfiguredAiStream(
  settings: StoredSettings,
  options: AiRunOptions,
  onDelta: (delta: string) => void,
): Promise<AiRunResult> {
  const provider = settings.ai.provider;
  if (provider === "none")
    throw new AiNotConfiguredError("AI curation is off in Settings.");

  let emitted = "";
  const forward = (delta: string) => {
    if (!delta) return;
    emitted += delta;
    try {
      onDelta(delta);
    } catch {
      // Downstream consumer disconnected; keep accumulating so the
      // single-shot fallback below can still complete the answer.
    }
  };

  try {
    return await streamProvider(provider, settings, options, forward);
  } catch (streamError) {
    if (emitted.length > 0) throw streamError;
    console.warn(`[AI Stream] streaming unavailable via ${provider} (${(streamError as Error).message}); using single-shot completion.`);
    const result = await runConfiguredAi(settings, options);
    if (result.text) onDelta(result.text);
    return result;
  }
}
