import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { StoredSettings } from "../lib/server/settings";
import type { AiKeyProvider } from "../lib/types";
import { DEFAULT_LOCAL_AI_URLS } from "../lib/ai-providers";

// Next handles this compile-time boundary marker itself. Stub only the marker
// for Node-side adapter tests, not any provider or settings implementation.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "data:text/javascript,export {};") return { format: "commonjs", source: "module.exports = {};", shortCircuit: true };
    return nextLoad(url, context);
  },
});

function settingsFor(provider: AiKeyProvider, model = ""): StoredSettings {
  return {
    general: { workspaceName: "Test workspace" },
    industry: { sources: [], keywords: [], description: "Manufacturing", excludedTerms: [], dailyLimit: 30 },
    mentions: { terms: [], websites: [], identityAnchors: [], negativeTerms: [], strictMode: true, excludeOwnedSites: true },
    newsletters: { googleClientId: "", googleClientSecret: "", connectedEmail: "", refreshToken: "", accessToken: "", accessTokenExpiresAt: 0, gmailQuery: "" },
    audience: { accounts: [] },
    ai: {
      provider, model,
      apiKeys: { openai: "openai-test-key", anthropic: "anthropic-test-key", gemini: "gemini-test-key", xai: "xai-test-key", groq: "groq-test-key", nvidia: "nvidia-test-key", lmstudio: "", ollama: "" },
      localBaseUrls: { ...DEFAULT_LOCAL_AI_URLS },
    },
    dailyBrief: { sourceLabels: [], lookbackDays: 7, sections: { industry: 5, mentions: 5, newsletters: 5 } },
  };
}

async function withFetch<T>(fetcher: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  const environmentNames = ["LM_STUDIO_API_KEY", "LM_API_TOKEN", "OLLAMA_LOCAL_API_KEY"];
  const originalEnvironment = new Map(environmentNames.map((name) => [name, process.env[name]]));
  for (const name of environmentNames) delete process.env[name];
  globalThis.fetch = fetcher;
  try { return await run(); } finally {
    globalThis.fetch = original;
    for (const [name, previous] of originalEnvironment) {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  }
}

test("Grok uses authenticated Responses with native web search, not a fabricated lookup", async () => {
  const { runConfiguredAi } = await import("../lib/server/ai");
  const result = await withFetch((async (url, init) => {
    assert.equal(String(url), "https://api.x.ai/v1/responses");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer xai-test-key");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "grok-4.6");
    assert.equal(body.store, false);
    assert.deepEqual(body.tools, [{ type: "web_search" }]);
    return Response.json({ output: [{ content: [{ type: "output_text", text: '{"stories":[]}' }] }] });
  }) as typeof fetch, () => runConfiguredAi(settingsFor("xai", "grok-4.6"), { prompt: "Find public mentions", webSearch: true }));
  assert.equal(result.text, '{"stories":[]}');
  assert.equal(result.provider, "xai");
});

test("LM Studio Default selects a loaded instance and sends no cloud key or tools", async () => {
  const { runConfiguredAi } = await import("../lib/server/ai");
  const requests: string[] = [];
  const result = await withFetch((async (url, init) => {
    requests.push(String(url));
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    if (String(url).endsWith("/api/v1/models")) return Response.json({ models: [{ key: "qwen3", type: "llm", loaded_instances: [{ id: "qwen-running", config: { context_length: 32_768 } }] }] });
    assert.equal(String(url), "http://127.0.0.1:1234/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "qwen-running");
    assert.equal(body.stream, false);
    assert.equal(body.tools, undefined);
    return Response.json({ choices: [{ message: { content: '{"selections":[]}' } }] });
  }) as typeof fetch, () => runConfiguredAi(settingsFor("lmstudio"), { prompt: "Rank these collected pages" }));
  assert.equal(result.model, "qwen-running");
  assert.equal(result.text, '{"selections":[]}');
  assert.equal(requests.length, 2);
});

test("Ollama uses native nonstreaming chat after verifying loaded local completion capability", async () => {
  const { runConfiguredAi } = await import("../lib/server/ai");
  const config = settingsFor("ollama", "qwen3:8b");
  const result = await withFetch((async (url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    if (String(url).endsWith("/api/ps")) return Response.json({ models: [{ name: "qwen3:8b", details: { format: "gguf" }, context_length: 8_192 }] });
    if (String(url).endsWith("/api/show")) return Response.json({ capabilities: ["completion"], details: { format: "gguf" } });
    assert.equal(String(url), "http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "qwen3:8b");
    assert.equal(body.stream, false);
    assert.equal(body.tools, undefined);
    assert.equal(body.options.num_predict, 4_000);
    assert.equal(body.options.num_ctx, 8_192);
    assert.equal(body.truncate, false);
    assert.equal(body.shift, false);
    assert.equal(Object.hasOwn(body, "keep_alive"), false);
    return Response.json({ message: { role: "assistant", content: '{"topics":[]}' }, done: true });
  }) as typeof fetch, () => runConfiguredAi(config, { prompt: "Extract real stories" }));
  assert.equal(result.text, '{"topics":[]}');
});

test("local inference fails closed for web search, unloaded or cloud models", async () => {
  const { runConfiguredAi } = await import("../lib/server/ai");
  let requests = 0;
  await withFetch((async () => {
    requests++;
    return Response.json({ models: [] });
  }) as typeof fetch, async () => {
    await assert.rejects(runConfiguredAi(settingsFor("lmstudio"), { prompt: "Find sources", webSearch: true }), /does not provide live web research/);
    assert.equal(requests, 0);
    await assert.rejects(runConfiguredAi(settingsFor("lmstudio", "not-loaded"), { prompt: "Summarize" }), /loaded text model/);
    assert.equal(requests, 1);
    await assert.rejects(runConfiguredAi(settingsFor("ollama", "model:cloud"), { prompt: "Summarize" }), /loaded text model/);
  });
});

test("nonselected cloud keys never satisfy a missing provider key", async () => {
  await withFetch(fetch, async () => {
    const { configuredAiApiKey, configuredAiReady } = await import("../lib/server/settings");
    const config = settingsFor("lmstudio");
    assert.equal(configuredAiApiKey(config, "lmstudio"), "");
    assert.equal(configuredAiReady(config), true);
    assert.equal(configuredAiApiKey(config, "xai"), "xai-test-key");
  });
});

test("local inference rejects insufficient or unknown loaded context before transmitting evidence", async () => {
  const { runConfiguredAi } = await import("../lib/server/ai");
  for (const contextLength of [undefined, 4_096]) {
    let inferenceRequests = 0;
    await withFetch((async (url) => {
      if (String(url).endsWith("/api/v1/models")) return Response.json({ models: [{
        key: "qwen3", type: "llm", max_context_length: 262_144,
        loaded_instances: [{ id: "qwen-running", config: { context_length: contextLength } }],
      }] });
      inferenceRequests++;
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    }) as typeof fetch, async () => {
      await assert.rejects(runConfiguredAi(settingsFor("lmstudio"), {
        prompt: "Evidence ".repeat(1_000), maxOutputTokens: 6_000,
      }), contextLength === undefined ? /actual context capacity/ : /conservative.*safety budget/);
      assert.equal(inferenceRequests, 0);
    });
  }
});

test("local output stopped at its length limit cannot become a partial saved result", async () => {
  const { runConfiguredAi } = await import("../lib/server/ai");
  await withFetch((async (url) => {
    if (String(url).endsWith("/api/v1/models")) return Response.json({ models: [{
      key: "qwen3", type: "llm", loaded_instances: [{ id: "qwen-running", config: { context_length: 32_768 } }],
    }] });
    return Response.json({ choices: [{ finish_reason: "length", message: { content: '{"stories":[]}' } }] });
  }) as typeof fetch, async () => {
    await assert.rejects(runConfiguredAi(settingsFor("lmstudio"), { prompt: "Extract stories" }), /incomplete result was not saved/);
  });
});
