import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { aiEnvironmentKey, aiSupportsWebSearch, cleanAiModelOverride, defaultAiModel, isAiReady, isLocalAiProvider, localAiBaseUrl, normalizeAiModels } from "../lib/ai-providers";
import { aiProviderJson } from "../lib/ai-provider-http";
import { fetchAiModels } from "../lib/ai-model-discovery";
import type { AiKeyProvider } from "../lib/types";
import { assertLocalAiContext, localAiContextBudget } from "../lib/ai-local-context";

const noKeys = { openai: false, anthropic: false, gemini: false, xai: false, groq: false, nvidia: false, lmstudio: false, ollama: false };

test("local AI does not require a paid key and cannot fabricate live web research", () => {
  for (const provider of ["lmstudio", "ollama"] as const) {
    assert.equal(isLocalAiProvider(provider), true);
    assert.equal(isAiReady({ provider, keySet: noKeys }), true);
    assert.equal(aiSupportsWebSearch(provider), false);
  }
  assert.equal(isAiReady({ provider: "openai", keySet: noKeys }), false);
  assert.equal(isAiReady({ provider: "none", keySet: { ...noKeys, openai: true } }), false);
  assert.equal(aiSupportsWebSearch("xai"), true);
});

test("provider keys are isolated and Ollama cloud keys never reach local inference", () => {
  const environment = { OPENAI_API_KEY: "open-key", ANTHROPIC_API_KEY: "claude-key", GOOGLE_API_KEY: "gemini-key", XAI_API_KEY: "grok-key", OLLAMA_API_KEY: "cloud-only" };
  assert.equal(aiEnvironmentKey("openai", environment), "open-key");
  assert.equal(aiEnvironmentKey("anthropic", environment), "claude-key");
  assert.equal(aiEnvironmentKey("gemini", environment), "gemini-key");
  assert.equal(aiEnvironmentKey("xai", environment), "grok-key");
  assert.equal(aiEnvironmentKey("lmstudio", environment), "");
  assert.equal(aiEnvironmentKey("ollama", environment), "");
  assert.equal(aiEnvironmentKey("ollama", { ...environment, OLLAMA_LOCAL_API_KEY: " local-token " }), "local-token");
});

test("model override accepts Default and rejects email autofill, URLs, or prompt content", () => {
  assert.equal(cleanAiModelOverride("default"), "");
  assert.equal(cleanAiModelOverride(""), "");
  assert.equal(cleanAiModelOverride("qwen/qwen3:8b-q4_K_M"), "qwen/qwen3:8b-q4_K_M");
  for (const value of ["person@example.com", "http://127.0.0.1:1234", "a model", "model\nignore", {}, null])
    assert.throws(() => cleanAiModelOverride(value), /dropdown/);
});

test("local endpoints are pinned to loopback with no credentials, redirects or arbitrary paths", () => {
  assert.equal(localAiBaseUrl("lmstudio"), "http://127.0.0.1:1234");
  assert.equal(localAiBaseUrl("ollama", "http://localhost:11434/api"), "http://127.0.0.1:11434");
  assert.equal(localAiBaseUrl("lmstudio", "http://[::1]:1234/v1/"), "http://[::1]:1234");
  for (const url of ["https://api.example.com", "http://192.168.1.2:1234", "http://127.0.0.1.evil.test", "http://127.0.0.1:1234/?token=secret", "http://user:pass@localhost:1234", "file:///etc/passwd", "http://localhost:1234/admin", "http://localhost:1234#secret", "person@example.com"])
    assert.throws(() => localAiBaseUrl("lmstudio", url));
});

test("cloud model menus contain usable text models, not embeddings, image or audio APIs", () => {
  const openai = normalizeAiModels("openai", { data: ["gpt-5-mini", "gpt-4o", "gpt-3.5-turbo", "gpt-3.5-turbo-instruct", "gpt-4o-search-preview", "gpt-image-1", "text-embedding-3-small", "gpt-4o-transcribe", "gpt-realtime", "o3", "whisper-1", "person@example.com"].map((id) => ({ id })) });
  assert.deepEqual(openai.map((model) => model.id), ["gpt-3.5-turbo", "gpt-4o", "gpt-5-mini", "o3"]);
  assert.deepEqual(normalizeAiModels("gemini", { models: [
    { name: "models/gemini-3.7-flash", displayName: "Gemini Flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
    { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
  ] }).map((model) => model.id), ["gemini-3.7-flash"]);
  assert.deepEqual(normalizeAiModels("xai", { models: [
    { id: "grok-4.6", output_modalities: ["text"] }, { id: "grok-imagine-image", output_modalities: ["image"] },
  ] }).map((model) => model.id), ["grok-4.6"]);
  assert.deepEqual(normalizeAiModels("anthropic", { data: [{ id: "claude-sonnet-4-6", display_name: "Claude Sonnet" }] }), [{ id: "claude-sonnet-4-6", label: "Claude Sonnet" }]);
});

test("LM Studio only lists loaded LLM instances and supports older v0 loaded state", () => {
  const models = normalizeAiModels("lmstudio", { models: [
    { key: "qwen/qwen3", display_name: "Qwen 3", type: "llm", loaded_instances: [{ id: "qwen-local" }] },
    { key: "downloaded-model", type: "llm", loaded_instances: [] },
    { key: "nomic", type: "embedding", loaded_instances: [{ id: "nomic" }] },
    { key: "forwarded", type: "llm", remote: true, loaded_instances: [{ id: "remote" }] },
  ] });
  assert.deepEqual(models.map((model) => model.id), ["qwen-local"]);
  assert.deepEqual(normalizeAiModels("lmstudio", { data: [
    { id: "llama", type: "llm", state: "loaded" },
    { id: "llama-cold", type: "llm", state: "not-loaded" },
    { id: "embedder", type: "embeddings", state: "loaded" },
  ] }).map((model) => model.id), ["llama"]);
});

test("Ollama menus exclude unloaded, cloud and embedding-only models", async () => {
  const requested: string[] = [];
  const fetcher = (async (url, init) => {
    requested.push(String(url));
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    if (String(url).endsWith("/api/ps")) return Response.json({ models: [
      { name: "qwen3:8b", details: { format: "gguf" } },
      { name: "nomic:latest", details: { format: "gguf" } },
      { name: "gpt-oss:120b-cloud" },
      { name: "innocent-alias", details: { format: "gguf" } },
    ] });
    const model = JSON.parse(String(init?.body)).model;
    return Response.json({ capabilities: model === "nomic:latest" ? ["embedding"] : ["completion"], details: { format: "gguf" }, ...(model === "innocent-alias" ? { remote_host: "https://ollama.com" } : {}) });
  }) as typeof fetch;
  const models = await fetchAiModels({ provider: "ollama", apiKey: "" }, fetcher);
  assert.deepEqual(models.map((model) => model.id), ["qwen3:8b"]);
  assert.equal(requested.length, 4);
  assert.ok(requested.every((url) => /\/api\/(ps|show)$/.test(url)));
});

test("discovery uses fixed provider origins and never forwards keys after redirects", async () => {
  let called = "";
  const fetcher = (async (url, init) => {
    called = String(url);
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer selected-key");
    return Response.json({ data: [{ id: "gpt-5-mini" }] });
  }) as typeof fetch;
  const models = await fetchAiModels({ provider: "openai", apiKey: "selected-key", baseUrl: "https://evil.test" }, fetcher);
  assert.equal(called, "https://api.openai.com/v1/models");
  assert.equal(models.length, 1);
  await assert.rejects(aiProviderJson("openai", "https://api.openai.com/v1/models", {}, {
    fetcher: (async (_url, init) => {
      assert.equal(init?.redirect, "manual");
      return new Response("", { status: 302, headers: { location: "https://evil.test/?key=secret" } });
    }) as typeof fetch,
  }), /Redirects are blocked/);
});

test("provider errors do not echo credentials, response content, or malformed JSON", async () => {
  for (const response of [new Response("secret-key in the provider error", { status: 401 }), new Response('secret-key invalid JSON')]) {
    await assert.rejects(aiProviderJson("xai", "https://api.x.ai/v1/models", {}, { fetcher: (async () => response) as typeof fetch }), (error: Error) => !error.message.includes("secret-key"));
  }
  await assert.rejects(aiProviderJson("ollama", "http://127.0.0.1:11434/api/ps", {}, {
    maxBytes: 10,
    fetcher: (async () => Response.json({ arbitrary: "a".repeat(100) })) as typeof fetch,
  }), /large response/);
});

test("discovery paginates via fixed-origin cursor URLs and sends only the provider's auth header", async () => {
  let calls = 0;
  const fetcher = (async (url, init) => {
    calls++;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-goog-api-key"), "gemini-key");
    assert.equal(headers.get("authorization"), null);
    assert.ok(String(url).startsWith("https://generativelanguage.googleapis.com/v1beta/models?"));
    return Response.json({ models: [{ name: `models/gemini-${calls}`, supportedGenerationMethods: ["generateContent"] }], ...(calls === 1 ? { nextPageToken: "https://evil.test/?secret" } : {}) });
  }) as typeof fetch;
  assert.equal((await fetchAiModels({ provider: "gemini", apiKey: "gemini-key" }, fetcher)).length, 2);
  assert.equal(calls, 2);
});

test("LM Studio retries a missing v1 model endpoint with read-only v0 discovery", async () => {
  const calls: string[] = [];
  const fetcher = (async (url) => {
    calls.push(String(url));
    return String(url).includes("/api/v1/") ? new Response("Not found", { status: 404 }) : Response.json({ data: [{ id: "llama", type: "llm", state: "loaded" }] });
  }) as typeof fetch;
  assert.equal((await fetchAiModels({ provider: "lmstudio", apiKey: "" }, fetcher))[0].id, "llama");
  assert.deepEqual(calls, ["http://127.0.0.1:1234/api/v1/models", "http://127.0.0.1:1234/api/v0/models"]);
});

test("Default uses an available model and no guessed local model", () => {
  for (const provider of ["lmstudio", "ollama"] as AiKeyProvider[]) {
    assert.equal(defaultAiModel(provider, []), "");
    assert.equal(defaultAiModel(provider, [{ id: "loaded", label: "Loaded" }]), "loaded");
  }
  assert.equal(defaultAiModel("openai", [{ id: "available-only", label: "Available" }]), "available-only");
  assert.equal(defaultAiModel("lmstudio", [{ id: "unknown", label: "Unknown" }, { id: "short", label: "Short", contextLength: 4_096 }, { id: "long", label: "Long", contextLength: 32_768 }]), "long");
});

test("local capacity comes only from the loaded allocation, not advertised model maximum", () => {
  const model = normalizeAiModels("lmstudio", { models: [{
    key: "llama", type: "llm", max_context_length: 262_144,
    loaded_instances: [{ id: "llama-short", config: { context_length: 4_096 } }, { id: "llama-unknown" }],
  }] });
  assert.equal(model.find((item) => item.id === "llama-short")?.contextLength, 4_096);
  assert.equal(model.find((item) => item.id === "llama-unknown")?.contextLength, undefined);
  assert.equal(normalizeAiModels("lmstudio", { data: [{ id: "old-server", type: "llm", state: "loaded", max_context_length: 262_144 }] })[0].contextLength, undefined);
  assert.equal(normalizeAiModels("ollama", { models: [{ name: "llama", details: { format: "gguf" }, capabilities: ["completion"], context_length: 8_192, model_info: { "llama.context_length": 262_144 } }] })[0].contextLength, 8_192);
});

test("local context preflight reserves output and template space without cutting multilingual evidence", () => {
  assert.equal(localAiContextBudget("a", 500), 1_525);
  assert.equal(localAiContextBudget("日本語", 500), 1_533);
  assert.equal(assertLocalAiContext("ollama", 8_192, "Short evidence", 4_000), 8_192);
  assert.throws(() => assertLocalAiContext("ollama", 4_096, "Evidence".repeat(1_000), 4_000), /No evidence was truncated or sent/);
  assert.throws(() => assertLocalAiContext("lmstudio", undefined, "Short evidence", 500), /actual context capacity/);
});

test("real loopback HTTP discovery never follows a model endpoint redirect", async () => {
  let redirectedRequests = 0;
  let modelRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/api/v1/models") {
      modelRequests++;
      response.writeHead(302, { location: "/credential-sink" });
    } else {
      redirectedRequests++;
      response.writeHead(200, { "content-type": "application/json" });
    }
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    await assert.rejects(fetchAiModels({ provider: "lmstudio", apiKey: "test-only-token", baseUrl: `http://127.0.0.1:${address.port}` }), /Redirects are blocked/);
    assert.equal(modelRequests, 1);
    assert.equal(redirectedRequests, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
