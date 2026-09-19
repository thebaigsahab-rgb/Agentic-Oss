import type { AiKeyProvider } from "./types";
import { aiProviderJson, AiProviderRequestError } from "./ai-provider-http";
import { isLocalAiProvider, isRemoteAiModel, isValidAiModelId, localAiBaseUrl, normalizeAiModels } from "./ai-providers";

type DiscoveryConnection = {
  provider: AiKeyProvider;
  apiKey: string;
  baseUrl?: string;
};

export async function fetchAiModels(
  connection: DiscoveryConnection,
  fetcher: typeof fetch = fetch,
) {
  const { provider, apiKey } = connection;
  if (!isLocalAiProvider(provider) && !apiKey.trim())
    throw new Error("Add an API key for the selected provider to load its models.");
  const headers: Record<string, string> = {};
  if (provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (provider === "gemini") {
    headers["x-goog-api-key"] = apiKey;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const request = (url: string, init: RequestInit = {}) => aiProviderJson(provider, url, {
    ...init,
    headers: { ...headers, ...init.headers },
  }, { fetcher, timeoutMs: 25_000 });

  if (provider === "lmstudio") {
    const root = localAiBaseUrl(provider, connection.baseUrl);
    let data: Record<string, unknown>;
    try { data = await request(`${root}/api/v1/models`); } catch (error) {
      if (!(error instanceof AiProviderRequestError) || ![404, 405].includes(error.status || 0)) throw error;
      data = await request(`${root}/api/v0/models`);
    }
    return normalizeAiModels(provider, data);
  }

  if (provider === "ollama") {
    const root = localAiBaseUrl(provider, connection.baseUrl);
    const payload = await request(`${root}/api/ps`);
    const running = (Array.isArray(payload.models) ? payload.models : [])
      .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
      .filter((value) => !isRemoteAiModel(value))
      .slice(0, 50);
    const models: Record<string, unknown>[] = [];
    // Bound fan-out even on machines with many loaded models. /api/show is a
    // read-only metadata request; no downloading or loading endpoints are called.
    for (let index = 0; index < running.length; index += 4) {
      const details = await Promise.all(running.slice(index, index + 4).map(async (value) => {
        const name = value.name ?? value.model;
        if (!isValidAiModelId(name)) return null;
        try {
          const info = await request(`${root}/api/show`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: name }),
          });
          // Only /api/ps reports the currently allocated window. The theoretical
          // model_info context maximum from /api/show is not a substitute.
          return { ...value, ...info, name, model: name, context_length: value.context_length };
        } catch (error) {
          // A model unloaded between ps and show should simply disappear. Other
          // errors must remain visible rather than masquerading as an empty list.
          if (error instanceof AiProviderRequestError && error.status === 404) return null;
          throw error;
        }
      }));
      models.push(...details.filter((model) => model !== null));
    }
    return normalizeAiModels(provider, { models });
  }

  if (provider === "xai") {
    let data: Record<string, unknown>;
    try { data = await request("https://api.x.ai/v1/language-models"); } catch (error) {
      if (!(error instanceof AiProviderRequestError) || error.status !== 404) throw error;
      data = await request("https://api.x.ai/v1/models");
    }
    return normalizeAiModels(provider, data);
  }

  if (provider === "groq") {
    const data = await request("https://api.groq.com/openai/v1/models");
    return normalizeAiModels(provider, data);
  }

  if (provider === "nvidia") {
    const data = await request("https://integrate.api.nvidia.com/v1/models");
    return normalizeAiModels(provider, data);
  }

  const endpoint = provider === "openai"
    ? "https://api.openai.com/v1/models"
    : provider === "anthropic"
      ? "https://api.anthropic.com/v1/models?limit=1000"
      : "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";
  const models: unknown[] = [];
  let page = endpoint;
  for (let attempt = 0; attempt < 5; attempt++) {
    const payload = await request(page);
    const items = payload.models ?? payload.data;
    if (Array.isArray(items)) models.push(...items);
    const cursor = provider === "anthropic" && payload.has_more
      ? payload.last_id
      : provider === "gemini" ? payload.nextPageToken : undefined;
    if (typeof cursor !== "string" || !cursor) break;
    const next = new URL(endpoint);
    next.searchParams.set(provider === "anthropic" ? "after_id" : "pageToken", cursor);
    page = next.toString();
  }
  return normalizeAiModels(provider, { models });
}
