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

test("resolveRelativeDate resolves today, tomorrow, and explicit dates accurately", async () => {
  const { resolveRelativeDate } = await import("../lib/server/jarvis-tools");

  const today = new Date().toISOString().slice(0, 10);
  assert.equal(resolveRelativeDate("today"), today);
  assert.equal(resolveRelativeDate(""), today);

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal(resolveRelativeDate("tomorrow"), tomorrow);

  const explicit = "2026-10-15";
  assert.equal(resolveRelativeDate(explicit), explicit);

  const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  assert.equal(resolveRelativeDate("in 3 days"), inThreeDays);
});

test("create_task, list_tasks, and complete_task manage workspace tasks", async () => {
  const { executeCreateTask, executeListTasks, executeCompleteTask } = await import("../lib/server/jarvis-tools");
  const { getDatabase } = await import("../lib/server/database");
  const { readWorkspaceState, writeWorkspaceState } = await import("../lib/workspace-store");

  const db = getDatabase();
  const initial = readWorkspaceState(db);

  // 1. Create task
  const title = `Automated J.A.R.V.I.S. Task ${Date.now()}`;
  const resCreate = await executeCreateTask({
    title,
    due: "tomorrow",
    priority: "high",
    notes: "Created via automated tool test",
  });

  assert.equal(resCreate.ok, true);
  assert.ok(resCreate.data);
  assert.equal(resCreate.data.title, title);
  assert.equal(resCreate.data.priority, "high");
  const taskId = resCreate.data.id;

  // 2. List tasks
  const resList = await executeListTasks({ search: title, status: "active" });
  assert.equal(resList.ok, true);
  assert.ok(resList.data);
  assert.equal(resList.data.tasks.some((t) => String(t.id) === String(taskId)), true);

  // 3. Complete task
  const resComplete = await executeCompleteTask({ taskId });
  assert.equal(resComplete.ok, true);
  assert.ok(resComplete.data?.completedTask);
  assert.equal(resComplete.data.completedTask.done, true);

  // 4. Complete ambiguous task returns candidates
  const duplicate1 = await executeCreateTask({ title: "Ambiguous Review Task" });
  const duplicate2 = await executeCreateTask({ title: "Ambiguous Review Task" });
  assert.equal(duplicate1.ok, true);
  assert.equal(duplicate2.ok, true);

  const resAmbiguous = await executeCompleteTask({ taskQuery: "Ambiguous Review Task" });
  assert.equal(resAmbiguous.ok, true);
  assert.ok(resAmbiguous.data?.candidates);
  assert.ok(resAmbiguous.data.candidates.length >= 2);
  assert.equal(resAmbiguous.error?.code, "MULTIPLE_MATCHES");

  // Clean up
  writeWorkspaceState(db, initial);
});

test("create_reminder and get_reminders validate URLs and store items", async () => {
  const { executeCreateReminder, executeGetReminders } = await import("../lib/server/jarvis-tools");
  const { getDatabase } = await import("../lib/server/database");
  const { readWorkspaceState, writeWorkspaceState } = await import("../lib/workspace-store");

  const db = getDatabase();
  const initial = readWorkspaceState(db);

  // Invalid URL validation
  const invalidUrlRes = await executeCreateReminder({
    note: "Check this link",
    url: "not-a-valid-url",
  });
  assert.equal(invalidUrlRes.ok, false);
  assert.equal(invalidUrlRes.error?.code, "INVALID_URL");

  // Valid reminder
  const validRes = await executeCreateReminder({
    title: "Read Tech News",
    note: "Review top AI updates",
    url: "https://news.ycombinator.com",
    accent: "blue",
  });
  assert.equal(validRes.ok, true);
  assert.ok(validRes.data);
  assert.equal(validRes.data.title, "Read Tech News");
  assert.equal(validRes.data.url, "https://news.ycombinator.com/");

  // List reminders
  const listRes = await executeGetReminders({ search: "Read Tech News" });
  assert.equal(listRes.ok, true);
  assert.ok(listRes.data);
  assert.ok(listRes.data.reminders.length >= 1);

  // Clean up
  writeWorkspaceState(db, initial);
});

test("read-only tools return predictable result structures", async () => {
  const { executeGetIndustryNews, executeGetDailyBrief, executeGetMentions, executeGetAudienceStats } = await import("../lib/server/jarvis-tools");

  const industryRes = await executeGetIndustryNews({ limit: 5 });
  assert.equal(industryRes.ok, true);
  assert.ok(Array.isArray(industryRes.data?.stories));

  const briefRes = await executeGetDailyBrief({ lookbackDays: 7 });
  assert.equal(briefRes.ok, true);
  assert.ok(Array.isArray(briefRes.data?.sections));

  const mentionsRes = await executeGetMentions({ limit: 5 });
  assert.equal(mentionsRes.ok, true);
  assert.ok(Array.isArray(mentionsRes.data?.mentions));

  const audienceRes = await executeGetAudienceStats();
  assert.equal(audienceRes.ok, true);
  assert.ok(Array.isArray(audienceRes.data?.accounts));
});

test("registerProposedAction and consumeProposedAction lifecycle works", async () => {
  const { registerProposedAction, consumeProposedAction } = await import("../lib/server/jarvis-tools");

  const proposed = registerProposedAction({
    type: "complete_task",
    summary: "Complete 2 candidate tasks",
    details: { taskQuery: "Test" },
    recordIds: ["task-1", "task-2"],
  });

  assert.ok(proposed.actionId.startsWith("act_"));
  assert.equal(proposed.summary, "Complete 2 candidate tasks");

  const consumed = consumeProposedAction(proposed.actionId);
  assert.equal(consumed?.actionId, proposed.actionId);

  // Consuming twice should yield undefined
  const consumedAgain = consumeProposedAction(proposed.actionId);
  assert.equal(consumedAgain, undefined);
});

test("agentic research tools: start_background_job and get_background_jobs", async () => {
  const { executeStartBackgroundJob, executeGetBackgroundJobs } = await import("../lib/server/jarvis-tools");

  const startRes = await executeStartBackgroundJob({ query: "Multi-agent reinforcement learning" });
  assert.equal(startRes.ok, true);
  assert.ok(startRes.data);
  assert.equal(startRes.data.query, "Multi-agent reinforcement learning");
  assert.ok(["queued", "running", "completed"].includes(startRes.data.status));

  const listRes = await executeGetBackgroundJobs({ limit: 5 });
  assert.equal(listRes.ok, true);
  assert.ok(listRes.data);
  assert.ok(listRes.data.jobs.length >= 1);
});

