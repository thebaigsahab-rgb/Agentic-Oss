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

test("cleanHtmlToText extracts title, meta description, and clean content body", async () => {
  const { cleanHtmlToText } = await import("../lib/server/web-analysis");

  const sampleHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Next Generation Autonomous AI Agents - Tech Insights</title>
      <meta name="description" content="A comprehensive analysis of agentic OS systems and persistent robot workflows in 2026." />
      <style>body { color: red; }</style>
      <script>console.log("tracking script");</script>
    </head>
    <body>
      <header><nav><a href="/">Home</a></nav></header>
      <main>
        <h1>Next Generation Autonomous AI Agents</h1>
        <p>In 2026, agentic systems have shifted towards demonstration-based learning and persistent execution.</p>
        <h2>Key Capabilities</h2>
        <ul>
          <li>Autonomous web page analysis and structured scraping</li>
          <li>Persistent routines that execute while users are away</li>
          <li>Hands-free multi-step task chaining</li>
        </ul>
        <p>This allows non-technical users to automate complex operations effortlessly.</p>
      </main>
      <footer>Copyright 2026 Tech Insights</footer>
    </body>
    </html>
  `;

  const cleaned = cleanHtmlToText(sampleHtml);

  assert.equal(cleaned.title, "Next Generation Autonomous AI Agents - Tech Insights");
  assert.equal(cleaned.description, "A comprehensive analysis of agentic OS systems and persistent robot workflows in 2026.");
  assert.ok(!cleaned.text.includes("<style>"));
  assert.ok(!cleaned.text.includes("tracking script"));
  assert.ok(cleaned.text.includes("Next Generation Autonomous AI Agents"));
  assert.ok(cleaned.text.includes("Autonomous web page analysis and structured scraping"));
  assert.ok(cleaned.text.includes("Persistent routines that execute while users are away"));
});
