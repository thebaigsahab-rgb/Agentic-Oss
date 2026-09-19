import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

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

test("agentic_jobs store lifecycle (create, update, get, list)", async () => {
  const { initializeAgenticStore, createAgenticJob, updateAgenticJob, getAgenticJob, listAgenticJobs } = await import(
    "../lib/agentic-store"
  );

  const db = initializeAgenticStore(new DatabaseSync(":memory:"));

  const job = createAgenticJob(db, {
    id: "job_test_123",
    type: "paper_research",
    query: "Quantum error correction",
    status: "queued",
    progress: "Queued...",
  });

  assert.equal(job.id, "job_test_123");
  assert.equal(job.status, "queued");

  // Get job
  const retrieved = getAgenticJob(db, "job_test_123");
  assert.ok(retrieved);
  assert.equal(retrieved.query, "Quantum error correction");

  // Update job
  const updated = updateAgenticJob(db, "job_test_123", {
    status: "completed",
    progress: "Done",
    dossier: {
      title: "Quantum Research",
      topic: "Quantum error correction",
      executiveSummary: "Key breakthroughs found.",
      keyInsights: ["Surface codes advance"],
      papers: [],
      recommendedActions: ["Track updates"],
      synthesizedAt: new Date().toISOString(),
    },
  });

  assert.ok(updated);
  assert.equal(updated.status, "completed");
  assert.equal(updated.dossier?.title, "Quantum Research");

  // List jobs
  const jobs = listAgenticJobs(db, 10);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, "job_test_123");
});

test("searchArxivPapers handles empty query gracefully", async () => {
  const { searchArxivPapers } = await import("../lib/server/agentic-research");
  const papers = await searchArxivPapers("");
  assert.deepEqual(papers, []);
});

test("synthesizeResearchDossier produces structured fallback when AI errors", async () => {
  const { synthesizeResearchDossier } = await import("../lib/server/agentic-research");
  const dossier = await synthesizeResearchDossier("Neuromorphic computing", [
    {
      id: "http://arxiv.org/abs/1234.5678",
      title: "Spiking Neural Networks",
      authors: ["Alice Researcher"],
      summary: "Overview of neuromorphic hardware implementations.",
      published: "2026-01-15",
      url: "http://arxiv.org/abs/1234.5678",
    },
  ]);

  assert.ok(dossier);
  assert.equal(dossier.topic, "Neuromorphic computing");
  assert.ok(dossier.executiveSummary);
  assert.equal(dossier.papers.length, 1);
});
