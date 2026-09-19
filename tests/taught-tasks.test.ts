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

test("taught_tasks SQLite store lifecycle (create, get, trigger search, list, run count, delete)", async () => {
  const { initializeAgenticStore, createTaughtTask, getTaughtTask, findTaughtTaskByTrigger, listTaughtTasks, recordTaughtTaskRun, deleteTaughtTask } = await import(
    "../lib/agentic-store"
  );

  const db = initializeAgenticStore(new DatabaseSync(":memory:"));

  const task = createTaughtTask(db, {
    id: "tt_test_1",
    name: "Morning Sync",
    triggerPhrase: "morning routine",
    description: "Daily sync procedure",
    steps: [
      { id: "s1", instruction: "Check tasks for today", tool: "list_tasks" },
      { id: "s2", instruction: "Open YouTube and search for tech news", tool: "open_url" },
    ],
  });

  assert.equal(task.id, "tt_test_1");
  assert.equal(task.name, "Morning Sync");
  assert.equal(task.triggerPhrase, "morning routine");
  assert.equal(task.steps.length, 2);

  // Get by ID
  const retrieved = getTaughtTask(db, "tt_test_1");
  assert.ok(retrieved);
  assert.equal(retrieved.name, "Morning Sync");

  // Find by Trigger phrase (exact and prefix variants)
  const byTrigger = findTaughtTaskByTrigger(db, "MORNING ROUTINE");
  assert.ok(byTrigger);
  assert.equal(byTrigger.id, "tt_test_1");

  const byPrefix = findTaughtTaskByTrigger(db, "Run morning routine");
  assert.ok(byPrefix);
  assert.equal(byPrefix.id, "tt_test_1");

  const byName = findTaughtTaskByTrigger(db, "Morning Sync");
  assert.ok(byName);
  assert.equal(byName.id, "tt_test_1");

  const byFuzzy = findTaughtTaskByTrigger(db, "Can you please run the morning routine now");
  assert.ok(byFuzzy);
  assert.equal(byFuzzy.id, "tt_test_1");

  // Record Run
  recordTaughtTaskRun(db, "tt_test_1");
  const afterRun = getTaughtTask(db, "tt_test_1");
  assert.equal(afterRun?.runCount, 1);
  assert.ok(afterRun?.lastRunAt);

  // List
  const list = listTaughtTasks(db, 10);
  assert.equal(list.length, 1);

  // Delete
  const deleted = deleteTaughtTask(db, "tt_test_1");
  assert.equal(deleted, true);
  assert.equal(getTaughtTask(db, "tt_test_1"), null);
});

test("executeOpenUrl resolves destinations, search queries, and custom URLs", async () => {
  const { executeOpenUrl } = await import("../lib/server/jarvis-tools");

  // YouTube search
  const ytSearch = await executeOpenUrl({ destination: "youtube", searchQuery: "quantum computing" });
  assert.equal(ytSearch.ok, true);
  assert.equal(ytSearch.data?.url, "https://www.youtube.com/results?search_query=quantum%20computing");
  assert.ok(ytSearch.data?.label.includes("quantum computing"));

  // Google search
  const googleSearch = await executeOpenUrl({ destination: "google", searchQuery: "agentic systems" });
  assert.equal(googleSearch.ok, true);
  assert.equal(googleSearch.data?.url, "https://www.google.com/search?q=agentic%20systems");

  // Direct URL
  const directUrl = await executeOpenUrl({ url: "github.com" });
  assert.equal(directUrl.ok, true);
  assert.equal(directUrl.data?.url, "https://github.com");

  // Empty arguments rejection
  const invalid = await executeOpenUrl({});
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error?.code, "INVALID_URL");
});

test("executeTeachTask, executeListTaughtTasks, and executeRunTaughtTask end-to-end", async () => {
  const { executeTeachTask, executeListTaughtTasks, executeRunTaughtTask } = await import("../lib/server/jarvis-tools");

  // Teach task
  const teachRes = await executeTeachTask({
    name: "Automated Checkup",
    triggerPhrase: "daily checkup",
    description: "Runs tasks check and opens YouTube",
    steps: [
      { instruction: "Check my tasks for today", tool: "list_tasks" },
      { instruction: "Open YouTube", tool: "open_url", args: { destination: "youtube", searchQuery: "AI news" } },
    ],
  });

  assert.equal(teachRes.ok, true);
  assert.ok(teachRes.data?.task.id);

  // List taught tasks
  const listRes = await executeListTaughtTasks();
  assert.equal(listRes.ok, true);
  assert.ok(listRes.data!.tasks.length >= 1);

  // Run taught task by trigger
  const runRes = await executeRunTaughtTask({ triggerPhrase: "daily checkup" });
  assert.equal(runRes.ok, true);
  assert.equal(runRes.data?.completedSteps, 2);
  assert.equal(runRes.data?.stepResults.length, 2);
});

test("taught task scheduling and execution log lifecycle", async () => {
  const { initializeAgenticStore, createTaughtTask, scheduleTaughtTask, listDueTaughtTasks, recordTaskRunLog, listTaskRunLogs } = await import(
    "../lib/agentic-store"
  );
  const { DatabaseSync } = await import("node:sqlite");

  const db = initializeAgenticStore(new DatabaseSync(":memory:"));

  const task = createTaughtTask(db, {
    id: "tt_sched_1",
    name: "Park Routine",
    triggerPhrase: "park routine",
    description: "Runs while away at park",
    steps: [{ id: "s1", instruction: "Check industry news", tool: "get_industry_news" }],
  });

  // Initially manual -> not due
  let due = listDueTaughtTasks(db);
  assert.equal(due.length, 0);

  // Schedule to run in past (due immediately)
  const pastIso = new Date(Date.now() - 60_000).toISOString();
  scheduleTaughtTask(db, task.id, { type: "one_time", scheduledTime: pastIso });

  due = listDueTaughtTasks(db);
  assert.equal(due.length, 1);
  assert.equal(due[0].name, "Park Routine");

  // Record Run Log
  recordTaskRunLog(db, {
    id: "run_test_1",
    taskId: task.id,
    taskName: task.name,
    triggeredBy: "scheduler",
    status: "completed",
    stepResults: [{ stepIndex: 1, instruction: "Check industry news", result: { ok: true }, success: true }],
    summary: "Completed successfully",
    executedAt: new Date().toISOString(),
    durationMs: 142,
  });

  const logs = listTaskRunLogs(db, task.id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].triggeredBy, "scheduler");
  assert.equal(logs[0].status, "completed");
  assert.equal(logs[0].durationMs, 142);
});

