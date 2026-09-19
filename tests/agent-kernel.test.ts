import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

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

import { DatabaseSync } from "node:sqlite";

async function getKernel() {
  return import("../lib/server/kernel");
}

function setupTestDatabase(initializeKernelStore: (db: DatabaseSync) => DatabaseSync): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  return initializeKernelStore(db);
}

test("7.1 & 7.2 Agent Control Plane: Goal-to-Plan DAG generation, execution readiness, and event journal", async () => {
  const { initializeKernelStore, createMissionFromObjective, getExecutableTasks, saveMissionCheckpoint, getMissionJournal } = await getKernel();
  const db = setupTestDatabase(initializeKernelStore);
  const objective = "Analyze quantum computing breakthroughs and update executive dossier";

  const mission = createMissionFromObjective(objective, {
    collaborationMode: "delegated",
    maxSpendUsd: 0.50,
    database: db,
  });

  assert.ok(mission.id.startsWith("mis_"));
  assert.equal(mission.objective, objective);
  assert.equal(mission.status, "planning");
  assert.ok(mission.nodes.length >= 4);

  // Ready executable tasks should only be the ones with 0 dependencies
  const executable = getExecutableTasks(mission);
  assert.equal(executable.length, 1);
  assert.equal(executable[0].dependencies.length, 0);
  assert.equal(executable[0].assignedRole, "researcher");

  // Checkpoint persistence
  const chk = saveMissionCheckpoint(db, mission.id);
  assert.ok(chk.startsWith("chk_"));

  // Verify journal was recorded
  const journal = getMissionJournal(db, mission.id);
  assert.ok(journal.length >= 1);
  assert.ok(journal.some((j) => j.type === "goal_received"));
  assert.ok(journal.some((j) => j.type === "checkpoint_saved"));
});

test("7.1 Dynamic Replanning on Repeated Failure", async () => {
  const { initializeKernelStore, createMissionFromObjective, replanFailedTask, saveMissionGraph } = await getKernel();
  const db = setupTestDatabase(initializeKernelStore);
  const mission = createMissionFromObjective("Compile quarterly report", { database: db });
  saveMissionGraph(db, mission);
  const firstTaskId = mission.nodes[0].id;

  const replanned = replanFailedTask(db, mission.id, firstTaskId, "Network timeout connecting to external feed");
  assert.ok(replanned !== null);

  const recoveryNode = replanned.nodes.find((n) => n.title.includes("Recovery for"));
  assert.ok(recoveryNode !== null);
  assert.equal(recoveryNode?.status, "ready");
});

test("7.3 Workstation World State / Digital Twin Fact Persistence", async () => {
  const { initializeKernelStore, setWorldFact, getWorldFacts } = await getKernel();
  const db = setupTestDatabase(initializeKernelStore);

  setWorldFact(db, "metric", "cpu_load", 14.2, 1.0, "observed");
  setWorldFact(db, "device", "audio_volume", 65, 1.0, "observed");
  setWorldFact(db, "metric", "user_presence", "active_at_desk", 0.95, "inferred");

  const facts = getWorldFacts(db);
  assert.equal(facts.length, 3);

  const cpuFact = facts.find((f) => f.key === "cpu_load");
  assert.ok(cpuFact);
  assert.equal(cpuFact.value, 14.2);
  assert.equal(cpuFact.confidence, 1.0);
  assert.equal(cpuFact.source, "observed");
});

test("8. Model Router & Compute Scheduler", async () => {
  const { routeModelForRole, checkComputeThrottling } = await getKernel();

  // Planner should route to frontier reasoning model
  const plannerRoute = await routeModelForRole("planner");
  assert.equal(plannerRoute.role, "planner");
  assert.equal(plannerRoute.escalationLevel, "cloud_frontier");
  assert.ok(plannerRoute.selectedModel.includes("pro") || plannerRoute.selectedModel.includes("sonnet"));

  // Vision UI should route to vision-capable model
  const visionRoute = await routeModelForRole("vision_ui", { requiresVision: true });
  assert.equal(visionRoute.role, "vision_ui");
  assert.ok(visionRoute.selectedModel.includes("flash") || visionRoute.selectedModel.includes("sonnet"));

  // Compute Scheduler throttling checks
  const normalThrottle = checkComputeThrottling(20, 2048, true);
  assert.equal(normalThrottle.shouldThrottle, false);

  const highCpuThrottle = checkComputeThrottling(92, 4096, true);
  assert.equal(highCpuThrottle.shouldThrottle, true);
  assert.ok(highCpuThrottle.reason?.includes("CPU is high"));

  const batteryThrottle = checkComputeThrottling(65, 2048, false);
  assert.equal(batteryThrottle.shouldThrottle, true);
  assert.ok(batteryThrottle.reason?.includes("battery power"));
});

test("10. Verifying & Critic Agent Layer", async () => {
  const { verifyTaskExecution } = await getKernel();
  const missionId = "mis_test_critic";
  const taskId = "task_extract_data";

  // Case 1: Valid clean outcome
  const successOutcome = await verifyTaskExecution(
    missionId,
    taskId,
    "Extract Research Papers",
    "Find autonomous multi-agent papers on arXiv",
    { papers: [{ title: "Autonomous Multi-Agent Architecture", arxivId: "2405.12345" }] },
  );

  assert.equal(successOutcome.verified, true);
  assert.equal(successOutcome.verdict, "verified");
  assert.ok(successOutcome.confidence >= 0.9);

  // Case 2: Error in actual output
  const failedOutcome = await verifyTaskExecution(
    missionId,
    taskId,
    "Fetch API Data",
    "Query external REST endpoint",
    "Error: ECONNREFUSED 127.0.0.1:8080 - connection refused",
  );

  assert.equal(failedOutcome.verified, false);
  assert.equal(failedOutcome.verdict, "failed");
  assert.ok(failedOutcome.requiredRepairPlan !== undefined);
});

test("11. Secure Capability Broker, Tool Risk & Secret Redaction", async () => {
  const { classifyToolRisk, enforceCapabilityPolicy, redactSecrets, encryptVaultSecret, decryptVaultSecret } = await getKernel();

  // Risk Classification
  assert.equal(classifyToolRisk("get_system_status"), "read");
  assert.equal(classifyToolRisk("create_task"), "low_risk_write");
  assert.equal(classifyToolRisk("open_url"), "external_communication");
  assert.equal(classifyToolRisk("execute_terminal_command"), "sensitive");
  assert.equal(classifyToolRisk("delete_file"), "destructive");
  assert.equal(classifyToolRisk("restart_workstation"), "irreversible");

  // Policy Enforcement
  const safePolicy = enforceCapabilityPolicy("mis_safe", "get_system_status", "delegated");
  assert.equal(safePolicy.allowed, true);
  assert.equal(safePolicy.requiresUserApproval, false);

  const destructivePolicy = enforceCapabilityPolicy("mis_del", "delete_file", "delegated");
  assert.equal(destructivePolicy.allowed, false);
  assert.equal(destructivePolicy.requiresUserApproval, true);

  // Emergency lockdown blocks everything
  const lockdownPolicy = enforceCapabilityPolicy("mis_lock", "get_system_status", "lockdown");
  assert.equal(lockdownPolicy.allowed, false);
  assert.ok(lockdownPolicy.reason?.includes("LOCKDOWN"));

  // Secret Redaction
  const rawLog = "Connecting to provider using sk-abcdef12345678901234567890 and AIzaSyD9876543210zyxwvutsrqponmlkjihgf";
  const sanitized = redactSecrets(rawLog);
  assert.ok(!sanitized.includes("sk-abcdef"));
  assert.ok(!sanitized.includes("AIzaSyD987"));
  assert.ok(sanitized.includes("[REDACTED_SECRET]"));

  // AES-256 Local Vault Secret Encryption
  const secretToken = "ghp_PersonalAccessTokenSuperSecret12345";
  const encrypted = encryptVaultSecret(secretToken);
  assert.notEqual(encrypted, secretToken);
  const decrypted = decryptVaultSecret(encrypted);
  assert.equal(decrypted, secretToken);
});

test("13. Knowledge OS: 4-Layer Memory & Hybrid Retrieval", async () => {
  const { initializeKernelStore, rememberFact, rememberPreference, rememberProcedure, recallMemories, consolidateEpisodicMemories } = await getKernel();
  const db = setupTestDatabase(initializeKernelStore);

  rememberFact("Project Phoenix Milestone", "Core agent control plane migrated to DAG", ["architecture", "phoenix"], "semantic", 0.7, undefined, db);
  rememberPreference("Theme Preference", "Obsidian Neural Dark", "ui", db);
  rememberProcedure("Launch Dev Server", "npm run dev --hostname 127.0.0.1", "devops", db);

  // Recall semantic
  const semanticResults = recallMemories("DAG", { layer: "semantic", database: db });
  assert.equal(semanticResults.length, 1);
  assert.equal(semanticResults[0].title, "Project Phoenix Milestone");

  // Recall preference
  const prefResults = recallMemories("Obsidian", { layer: "preference", database: db });
  assert.equal(prefResults.length, 1);
  assert.equal(prefResults[0].content, "Obsidian Neural Dark");

  // Memory consolidation
  const consolidation = consolidateEpisodicMemories(db);
  assert.ok(consolidation.consolidatedCount >= 0);
});

test("15. Autonomous Research Engine: Evidence Graph & Contradiction Detection", async () => {
  const { initializeKernelStore, recordEvidenceClaim, listEvidenceClaims } = await getKernel();
  const db = setupTestDatabase(initializeKernelStore);
  const researchId = "res_quantum_ai_01";

  const claim1 = recordEvidenceClaim(
    researchId,
    "Quantum processors demonstrated quadratic speedup in discrete optimization",
    "https://arxiv.org/abs/2405.001",
    "Quantum Benchmarks 2024",
    "We observe quadratic speedup across 100 benchmark graphs.",
    0.95,
    db,
  );
  assert.equal(claim1.verified, true);

  const claim2 = recordEvidenceClaim(
    researchId,
    "Quantum processors did not demonstrate quadratic speedup in discrete optimization",
    "https://arxiv.org/abs/2405.002",
    "Rebuttal on Quantum Claims",
    "Classical heuristics matched or outperformed the quantum annealer.",
    0.85,
    db,
  );

  // Claim 2 should detect contradiction with Claim 1
  assert.ok(claim2.contradictedBy && claim2.contradictedBy.includes(claim1.id));

  const allClaims = listEvidenceClaims(researchId, db);
  assert.equal(allClaims.length, 2);
});

test("19. Event Bus 2.0 & 26. Collaboration Modes", async () => {
  const { initializeKernelStore, setCollaborationMode, getCollaborationMode, emitKernelEvent, listKernelEvents } = await getKernel();
  const db = setupTestDatabase(initializeKernelStore);

  // Mode switching
  const delegated = setCollaborationMode("delegated");
  assert.equal(delegated.mode, "delegated");
  assert.equal(getCollaborationMode(), "delegated");

  const lockdown = setCollaborationMode("lockdown", "Security anomaly detected");
  assert.equal(lockdown.mode, "lockdown");
  assert.ok(lockdown.message.includes("LOCKDOWN ACTIVATED"));
  assert.equal(getCollaborationMode(), "lockdown");

  // Event bus emission and listing
  emitKernelEvent(db, "telemetry.cpu_spike", "system_monitor", { cpuPercent: 95 });
  emitKernelEvent(db, "telemetry.memory_warning", "system_monitor", { memoryUsedMb: 7500 });
  emitKernelEvent(db, "mission.task_completed", "operator", { taskId: "task_42" });

  const telemetryEvents = listKernelEvents(db, "telemetry.");
  assert.equal(telemetryEvents.length, 2);
  assert.ok(telemetryEvents.some((e) => e.topic === "telemetry.memory_warning"));
  assert.ok(telemetryEvents.some((e) => e.topic === "telemetry.cpu_spike"));

  const allEvents = listKernelEvents(db);
  assert.ok(allEvents.length >= 3);
});
