import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

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

test("POST /api/jarvis/chat rejects requests without application/json Content-Type", async () => {
  const { POST } = await import("../app/api/jarvis/chat/route");
  const req = new Request("http://127.0.0.1:3000/api/jarvis/chat", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "hello",
  });
  const res = await POST(req);
  assert.equal(res.status, 415);
});

test("POST /api/jarvis/chat rejects malformed JSON", async () => {
  const { POST } = await import("../app/api/jarvis/chat/route");
  const req = new Request("http://127.0.0.1:3000/api/jarvis/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ invalid_json",
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
});

test("POST /api/jarvis/chat handles invalid or expired confirmation actionId", async () => {
  const { POST } = await import("../app/api/jarvis/chat/route");
  const req = new Request("http://127.0.0.1:3000/api/jarvis/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "confirm" }],
      mode: "chat",
      confirmation: { actionId: "non-existent-action-id", confirmed: true },
    }),
  });
  const res = await POST(req);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type")?.includes("text/event-stream"));

  const text = await res.text();
  assert.ok(text.includes("ACTION_EXPIRED"));
});
