import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "@/lib/server/database";
import type {
  CollaborationMode,
  MissionGraph,
  TaskNode,
  TaskNodeStatus,
} from "./types";
import {
  appendMissionJournal,
  getMissionGraph,
  saveMissionGraph,
  emitKernelEvent,
  grantCapability,
} from "./kernel-store";

/**
 * 7.1 Goal-to-Plan Engine
 * Converts a high-level natural language objective into a structured, dependency-linked Mission DAG.
 */
export function createMissionFromObjective(
  objective: string,
  options: {
    collaborationMode?: CollaborationMode;
    maxTimeMs?: number;
    maxSpendUsd?: number;
    maxToolCalls?: number;
    database?: DatabaseSync;
  } = {},
): MissionGraph {
  const missionId = `mis_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date().toISOString();

  // Deconstruct objective into structured sub-tasks based on operational primitives
  const nodes: TaskNode[] = [];
  const cleanObj = objective.trim().toLowerCase();

  // Node 1: Intelligence / Context Gathering
  const t1Id = `task_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  nodes.push({
    id: t1Id,
    missionId,
    title: "Gather Context & State",
    description: `Inspect workstation state and retrieve background knowledge for: "${objective}"`,
    assignedRole: "researcher",
    tool: "query_world_state",
    args: { query: objective },
    dependencies: [],
    status: "ready",
    maxRetries: 2,
    retryCount: 0,
    timeoutMs: 30000,
  });

  // Node 2: Core Execution / Tool Invocation
  const t2Id = `task_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  let toolName = "execute_action";
  if (cleanObj.includes("paper") || cleanObj.includes("arxiv") || cleanObj.includes("research")) {
    toolName = "search_arxiv";
  } else if (cleanObj.includes("code") || cleanObj.includes("refactor") || cleanObj.includes("test")) {
    toolName = "software_pipeline";
  } else if (cleanObj.includes("browse") || cleanObj.includes("web") || cleanObj.includes("url")) {
    toolName = "open_url";
  }

  nodes.push({
    id: t2Id,
    missionId,
    title: "Primary Operational Execution",
    description: `Execute core operational step for goal: "${objective}"`,
    assignedRole: "operator",
    tool: toolName,
    args: { objective, contextFrom: t1Id },
    dependencies: [t1Id],
    status: "pending",
    maxRetries: 3,
    retryCount: 0,
    timeoutMs: 60000,
  });

  // Node 3: Independent Verification (Track 10 Critic Layer)
  const t3Id = `task_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  nodes.push({
    id: t3Id,
    missionId,
    title: "Critic & Outcome Verification",
    description: `Verify that the outcome of task ${t2Id} satisfies the original objective.`,
    assignedRole: "critic",
    tool: "verify_outcome",
    args: { targetTaskId: t2Id, expectedOutcome: objective },
    dependencies: [t2Id],
    status: "pending",
    maxRetries: 2,
    retryCount: 0,
    timeoutMs: 30000,
  });

  // Node 4: Artifact Archival & Knowledge Synthesis (Track 13)
  const t4Id = `task_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  nodes.push({
    id: t4Id,
    missionId,
    title: "Synthesize Findings to Knowledge OS",
    description: "Store durable artifacts, evidence, and learned procedures into long-term memory.",
    assignedRole: "planner",
    tool: "save_memory",
    args: { missionId },
    dependencies: [t3Id],
    status: "pending",
    maxRetries: 2,
    retryCount: 0,
    timeoutMs: 20000,
  });

  const mission: MissionGraph = {
    id: missionId,
    title: objective.length > 60 ? `${objective.slice(0, 57)}...` : objective,
    objective,
    status: "planning",
    collaborationMode: options.collaborationMode || "delegated",
    nodes,
    budget: {
      maxTimeMs: options.maxTimeMs || 300000, // 5 mins default
      maxSpendUsd: options.maxSpendUsd || 0.25,
      maxToolCalls: options.maxToolCalls || 25,
      maxRetries: 5,
      usedSpendUsd: 0.0,
      usedToolCalls: 0,
    },
    successCriteria: [
      "All dependency nodes executed and verified",
      "Critic verification verdict equals 'verified'",
      "Telemetry trace logged and budget not exceeded",
    ],
    stopConditions: [
      "Explicit user abort or lockdown mode",
      "Exceeded budget or maximum retries reached",
      "Irreversible action denied by policy",
    ],
    createdAt: now,
    updatedAt: now,
  };

  const db = options.database || getDatabase();
  saveMissionGraph(db, mission);

  // Journal event
  appendMissionJournal(db, {
    missionId,
    type: "goal_received",
    payload: { objective, totalTasks: nodes.length },
    timestamp: now,
  });

  emitKernelEvent(db, "mission.created", "control_plane", { missionId, objective });

  // Issue scoped capability grants
  grantCapability(db, missionId, "system:read", "read", 300000, "Mission context read");
  grantCapability(db, missionId, "tool:execute", "low_risk_write", 300000, "Task operational dispatch");

  return mission;
}

/**
 * Evaluates which tasks in the DAG are ready for execution (all dependencies completed).
 */
export function getExecutableTasks(mission: MissionGraph): TaskNode[] {
  const completedIds = new Set(
    mission.nodes.filter((n) => n.status === "completed").map((n) => n.id),
  );

  return mission.nodes.filter((node) => {
    if (node.status !== "ready" && node.status !== "pending") return false;
    return node.dependencies.every((depId) => completedIds.has(depId));
  });
}

/**
 * 7.1 Re-plans dynamically when a task fails repeatedly.
 */
export function replanFailedTask(
  database: DatabaseSync,
  missionId: string,
  failedTaskId: string,
  errorReason: string,
): MissionGraph | null {
  const mission = getMissionGraph(database, missionId);
  if (!mission) return null;

  const failedNode = mission.nodes.find((n) => n.id === failedTaskId);
  if (!failedNode) return mission;

  const now = new Date().toISOString();

  // Create recovery compensation task inserted before dependent nodes
  const recoveryId = `rec_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const recoveryNode: TaskNode = {
    id: recoveryId,
    missionId,
    title: `Recovery for ${failedNode.title}`,
    description: `Fallback strategy due to failure: ${errorReason}`,
    assignedRole: "operator",
    tool: failedNode.tool === "search_arxiv" ? "search_web" : "fallback_executor",
    args: { ...failedNode.args, isRecovery: true, originalError: errorReason },
    dependencies: failedNode.dependencies,
    status: "ready",
    maxRetries: 2,
    retryCount: 0,
    timeoutMs: failedNode.timeoutMs,
  };

  // Re-link dependencies that were pointing to the failed task to the recovery task
  for (const node of mission.nodes) {
    if (node.dependencies.includes(failedTaskId)) {
      node.dependencies = node.dependencies.map((d) => (d === failedTaskId ? recoveryId : d));
    }
  }

  failedNode.status = "failed";
  failedNode.error = errorReason;
  mission.nodes.push(recoveryNode);
  mission.updatedAt = now;

  saveMissionGraph(database, mission);

  appendMissionJournal(database, {
    missionId,
    taskId: failedTaskId,
    type: "recovery_triggered",
    payload: { failedTaskId, recoveryTaskId: recoveryId, errorReason },
    timestamp: now,
  });

  emitKernelEvent(database, "mission.replanned", "control_plane", {
    missionId,
    failedTaskId,
    recoveryTaskId: recoveryId,
  });

  return mission;
}

/**
 * Creates a durable checkpoint that allows resuming after process restart.
 */
export function saveMissionCheckpoint(
  database: DatabaseSync,
  missionId: string,
): string {
  const checkpointId = `chk_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();

  database.prepare("UPDATE kernel_missions SET checkpoint_id = ?, updated_at = ? WHERE id = ?").run(
    checkpointId,
    now,
    missionId,
  );

  appendMissionJournal(database, {
    missionId,
    type: "checkpoint_saved",
    payload: { checkpointId },
    timestamp: now,
  });

  return checkpointId;
}
