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

test("computer_use_skills SQLite store lifecycle", async () => {
  const {
    initializeComputerSkillsStore,
    createComputerSkill,
    getComputerSkill,
    findComputerSkillByTrigger,
    listComputerSkills,
    updateComputerSkill,
    deleteComputerSkill,
  } = await import("../lib/server/computer-skills-store");

  const db = new DatabaseSync(":memory:");
  initializeComputerSkillsStore(db);

  // 1. Should have seeded default skills
  const seeded = listComputerSkills(db);
  assert.ok(seeded.length >= 3, "Seeded at least 3 default skills");

  // 2. Create custom skill
  const skill = createComputerSkill(db, {
    name: "ArXiv LLM Agent Search",
    triggerPhrase: "search arxiv agents",
    description: "Searches arXiv for latest multi-agent papers",
    category: "browser",
    parameters: [{ name: "query", type: "string", description: "Search query", defaultValue: "agents", required: false }],
    steps: [
      { id: "step_1", action: "navigate", description: "Open arXiv", value: "https://arxiv.org" },
      { id: "step_2", action: "extract_data", description: "Extract top papers" },
    ],
  });

  assert.ok(skill.id.startsWith("skill_"));
  assert.equal(skill.name, "ArXiv LLM Agent Search");

  // 3. Get by ID
  const retrieved = getComputerSkill(db, skill.id);
  assert.ok(retrieved);
  assert.equal(retrieved.name, "ArXiv LLM Agent Search");

  // 4. Find by trigger phrase
  const byTrigger = findComputerSkillByTrigger(db, "search arxiv agents");
  assert.ok(byTrigger);
  assert.equal(byTrigger.id, skill.id);

  // Natural language variation
  const natural = findComputerSkillByTrigger(db, "please run skill search arxiv agents");
  assert.ok(natural);
  assert.equal(natural.id, skill.id);

  // 5. Update skill
  const updated = updateComputerSkill(db, skill.id, { description: "Updated description" });
  assert.ok(updated);
  assert.equal(updated.description, "Updated description");

  // 6. Delete skill
  const deleted = deleteComputerSkill(db, skill.id);
  assert.equal(deleted, true);
  assert.equal(getComputerSkill(db, skill.id), null);
});

test("computer_use_missions and logs store lifecycle", async () => {
  const {
    initializeComputerSkillsStore,
    createAutonomousMission,
    updateAutonomousMission,
    getActiveAutonomousMission,
    recordComputerUseLog,
    listComputerUseLogs,
  } = await import("../lib/server/computer-skills-store");

  const db = new DatabaseSync(":memory:");
  initializeComputerSkillsStore(db);

  const mission = createAutonomousMission(db, {
    id: "mission_test_1",
    goal: "I am going outside: research agents and create brief",
    status: "running",
    mode: "away",
    userAway: true,
    plannedSubtasks: [
      {
        id: "sub_1",
        title: "Perceive Web",
        status: "pending",
        completedActions: 0,
        actions: [{ id: "act_1", action: "navigate", description: "Nav", value: "https://news.ycombinator.com" }],
      },
    ],
    currentSubtaskIndex: 0,
    totalSubtasks: 1,
  });

  assert.equal(mission.status, "running");

  // Get active mission
  const active = getActiveAutonomousMission(db);
  assert.ok(active);
  assert.equal(active.id, "mission_test_1");

  // Update mission status to completed with debrief
  const updated = updateAutonomousMission(db, "mission_test_1", {
    status: "completed",
    debrief: {
      summary: "Mission completed successfully while away",
      tasksCompleted: 1,
      totalTasks: 1,
      actionsExecuted: 2,
      durationMs: 4500,
      highlights: ["Extracted top articles"],
      artifactsCreated: [],
      errorsMitigated: [],
      returnMessage: "Welcome back!",
    },
  });
  assert.equal(updated?.status, "completed");

  // Record action log
  recordComputerUseLog(db, {
    id: "log_1",
    missionId: "mission_test_1",
    stepNumber: 1,
    actionType: "navigate",
    actionPayload: { id: "a1", action: "navigate", description: "Nav" },
    thought: "Navigating to website",
    result: { success: true, action: { id: "a1", action: "navigate", description: "Nav" }, durationMs: 100 },
    screenUrl: "https://news.ycombinator.com",
    screenTitle: "Hacker News",
    executedAt: new Date().toISOString(),
  });

  const logs = listComputerUseLogs(db, "mission_test_1");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actionType, "navigate");
});

test("parsePageToScreenState extracts interactive elements with coordinates", async () => {
  const { parsePageToScreenState } = await import("../lib/server/computer-use-engine");

  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Test OS Portal</title></head>
      <body>
        <a href="https://example.com/login">Login to Portal</a>
        <input type="text" name="searchQuery" placeholder="Search knowledge base" />
        <button type="submit">Submit Query</button>
        <p>Welcome to the autonomous OS test environment with automated perception.</p>
      </body>
    </html>
  `;

  const screen = parsePageToScreenState(html, "https://example.com/portal");
  assert.equal(screen.title, "Test OS Portal");
  assert.ok(screen.elements.length >= 3, "Parsed links, inputs, buttons");

  const linkElem = screen.elements.find((e) => e.tag === "a");
  assert.ok(linkElem);
  assert.equal(linkElem.text, "Login to Portal");
  assert.ok(linkElem.center.x > 0 && linkElem.center.y > 0, "Assigned normalized coordinates");

  const inputElem = screen.elements.find((e) => e.tag === "input");
  assert.ok(inputElem);
  assert.equal(inputElem.typable, true);
});

test("executeAction executes simulated and CLI primitives with self-healing", async () => {
  const { executeAction } = await import("../lib/server/computer-use-engine");

  // Test run_cli
  const cliRes = await executeAction({
    id: "act_cli",
    action: "run_cli",
    description: "Check Node version",
    value: "node -v",
  });
  assert.equal(cliRes.success, true);
  assert.ok(String((cliRes.output as { stdout?: string })?.stdout).includes("v22"));

  // Test command safety blocking
  const dangerousRes = await executeAction({
    id: "act_danger",
    action: "run_cli",
    description: "Blocked command",
    value: "rm -rf /",
  });
  assert.equal(dangerousRes.success, false);
  assert.ok(dangerousRes.error?.includes("security guardrails"));

  // Test mouse click with self-healing
  const mockScreen = {
    url: "https://example.com",
    title: "Example",
    viewport: { width: 1280, height: 800 },
    elements: [
      {
        id: "elem_btn",
        tag: "button",
        text: "Confirm Submission",
        bbox: { top: 100, left: 100, width: 120, height: 40 },
        center: { x: 160, y: 120 },
        clickable: true,
        typable: false,
      },
    ],
    scrollOffset: { x: 0, y: 0 },
    capturedAt: new Date().toISOString(),
  };

  const clickRes = await executeAction(
    {
      id: "act_click",
      action: "mouse_click",
      description: "Click confirm submission button",
      target: { text: "Confirm" },
    },
    mockScreen,
  );
  assert.equal(clickRes.success, true);
  assert.equal(clickRes.cursorPosition?.x, 160);
  assert.equal(clickRes.cursorPosition?.y, 120);
});

test("synthesizeDemonstrationToSkill generates parameterized skill", async () => {
  const { synthesizeDemonstrationToSkill } = await import("../lib/server/demonstration-synthesizer");

  const synthesized = await synthesizeDemonstrationToSkill({
    skillName: "Hacker News Query",
    triggerPhrase: "search hacker news",
    description: "Search Hacker News for a topic",
    events: [
      {
        timestamp: Date.now(),
        action: "navigate",
        targetUrl: "https://news.ycombinator.com",
      },
      {
        timestamp: Date.now() + 500,
        action: "type_text",
        value: "artificial intelligence",
      },
      {
        timestamp: Date.now() + 1000,
        action: "mouse_click",
        elementText: "Search",
      },
    ],
  });

  assert.equal(synthesized.name, "Hacker News Query");
  assert.equal(synthesized.triggerPhrase, "search hacker news");
  assert.ok(synthesized.steps.length >= 2);
  assert.ok(synthesized.parameters.length >= 1, "Inferred parameter from typed input");
});

test("Jarvis computer use tools integration", async () => {
  const {
    executeStartComputerMission,
    executeRunComputerSkill,
    executeTeachComputerSkill,
    executeGetComputerStatus,
  } = await import("../lib/server/jarvis-tools");

  // 1. executeStartComputerMission
  const missionRes = await executeStartComputerMission({
    goal: "I am going outside: test mission",
    mode: "away",
  });
  assert.equal(missionRes.ok, true);
  assert.ok(missionRes.data?.mission.id);

  // 2. executeGetComputerStatus
  const statusRes = await executeGetComputerStatus();
  assert.equal(statusRes.ok, true);
  assert.ok(statusRes.data?.totalSkills !== undefined);

  // 3. executeTeachComputerSkill
  const teachRes = await executeTeachComputerSkill({
    name: "Test Skill",
    triggerPhrase: "test run skill",
    description: "A simple test routine",
    steps: [
      { action: "run_cli", description: "Print test", value: "node -e 'console.log(\"hello\")'" },
    ],
  });
  assert.equal(teachRes.ok, true);

  // 4. executeRunComputerSkill
  const runRes = await executeRunComputerSkill({
    triggerPhrase: "test run skill",
  });
  assert.equal(runRes.ok, true);
  assert.equal(runRes.data?.completedSteps, 1);
});
