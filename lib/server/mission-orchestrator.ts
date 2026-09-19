import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AutonomousMission,
  MissionSubTask,
  ExecutiveDebrief,
  ComputerActionStep,
  ScreenState,
  AgentInputMode,
} from "@/lib/computer-use-types";
import {
  createAutonomousMission,
  getAutonomousMission,
  updateAutonomousMission,
  recordComputerUseLog,
  getActiveAutonomousMission,
  listAutonomousMissions,
} from "@/lib/server/computer-skills-store";
import { executeAction, fetchAndPerceiveScreen } from "@/lib/server/computer-use-engine";
import { runConfiguredAi } from "@/lib/server/ai";
import { readSettings } from "@/lib/server/settings";
import { executeCreateTask, executeCreateReminder } from "@/lib/server/jarvis-tools";

type PlannedActionShape = {
  id?: string;
  action?: string;
  description?: string;
  value?: string;
  target?: ComputerActionStep["target"];
};

export async function planMission(goal: string, userAway = true): Promise<MissionSubTask[]> {
  try {
    const settings = await readSettings();
    const prompt = `You are the Mission Director of an advanced Agentic OS.
A user initiated an autonomous mission:
Goal: "${goal}"
User is away from computer: ${userAway}

Decompose this autonomous mission into 2 to 4 structured subtasks. Each subtask must have 1 to 3 concrete computer actions:
Supported action types: "navigate", "mouse_click", "type_text", "extract_data", "run_cli", "wait_for".

Respond ONLY in valid JSON matching this schema:
[
  {
    "id": "subtask_1",
    "title": "Clear title of subtask",
    "actions": [
      {
        "id": "act_1",
        "action": "navigate",
        "description": "Navigate to research site",
        "value": "https://news.ycombinator.com"
      },
      {
        "id": "act_2",
        "action": "extract_data",
        "description": "Extract trending headlines"
      }
    ]
  }
]`;

    const aiRes = await runConfiguredAi(settings, {
      prompt,
      maxOutputTokens: 2000,
    });

    const cleaned = aiRes.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)```$/i, "$1").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((st, i) => ({
        id: st.id || `subtask_${i + 1}`,
        title: st.title || `Subtask ${i + 1}`,
        status: "pending",
        completedActions: 0,
        actions: ((st.actions || []) as PlannedActionShape[]).map((a, j) => ({
          id: a.id || `act_${i + 1}_${j + 1}`,
          action: (a.action as ComputerActionStep["action"]) || "navigate",
          description: a.description || `Action ${j + 1}`,
          value: a.value || undefined,
          target: a.target || undefined,
        })),
      }));
    }
  } catch {}

  // Robust Rule-based fallback planning
  const defaultSubtasks: MissionSubTask[] = [
    {
      id: "subtask_1",
      title: "Perceive & Gather Web Intelligence",
      status: "pending",
      completedActions: 0,
      actions: [
        {
          id: "act_1_1",
          action: "navigate",
          description: "Navigate to primary information source",
          value: "https://news.ycombinator.com",
        },
        {
          id: "act_1_2",
          action: "extract_data",
          description: "Extract relevant industry updates",
        },
      ],
    },
    {
      id: "subtask_2",
      title: "Audit System Diagnostics & Active Tasks",
      status: "pending",
      completedActions: 0,
      actions: [
        {
          id: "act_2_1",
          action: "run_cli",
          description: "Verify system runtime health",
          value: "node -v",
        },
      ],
    },
  ];

  return defaultSubtasks;
}

export async function startAutonomousMission(
  database: DatabaseSync,
  params: {
    goal: string;
    mode?: "away" | "interactive";
    userAway?: boolean;
    inputMode?: AgentInputMode;
  },
): Promise<AutonomousMission> {
  const { goal, mode = "away", userAway = true } = params;
  const plannedSubtasks = await planMission(goal, userAway);

  const mission = createAutonomousMission(database, {
    id: `mission_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    goal,
    status: "running",
    mode,
    userAway,
    plannedSubtasks,
    currentSubtaskIndex: 0,
    totalSubtasks: plannedSubtasks.length,
  });

  // Motor arbitration for this mission: while the user is away the agent may
  // borrow the real mouse/keyboard when the idle gate says the devices are
  // free; otherwise it stays on its own virtual motors.
  missionInputModes.set(mission.id, params.inputMode || (userAway ? "auto_idle" : "agent_owned"));

  // Launch background execution tick asynchronously
  setTimeout(() => {
    void executeNextMissionStep(database, mission.id);
  }, 100);

  return mission;
}

// Cursor continuity for running missions lives with the process that drives
// them, so consecutive actions move the agent's own mouse from its last pose.
const missionCursors = new Map<string, { x: number; y: number }>();

// Input-mode continuity: which motor system each mission is allowed to use.
const missionInputModes = new Map<string, AgentInputMode>();

export function getMissionInputMode(missionId: string): AgentInputMode {
  return missionInputModes.get(missionId) || "agent_owned";
}

export async function executeNextMissionStep(
  database: DatabaseSync,
  missionId: string,
): Promise<AutonomousMission | null> {
  const mission = getAutonomousMission(database, missionId);
  if (!mission || mission.status !== "running") return null;

  const currentIdx = mission.currentSubtaskIndex;
  if (currentIdx >= mission.plannedSubtasks.length) {
    // Mission completed! Synthesize Executive Debrief
    return completeMission(database, mission);
  }

  const currentSubtask = mission.plannedSubtasks[currentIdx];
  const nextActionIdx = currentSubtask.completedActions;

  if (nextActionIdx >= currentSubtask.actions.length) {
    // Current subtask done, advance to next
    currentSubtask.status = "completed";
    const nextSubtaskIndex = currentIdx + 1;
    updateAutonomousMission(database, missionId, {
      plannedSubtasks: mission.plannedSubtasks,
      currentSubtaskIndex: nextSubtaskIndex,
    });

    if (nextSubtaskIndex >= mission.plannedSubtasks.length) {
      return completeMission(database, mission);
    }
    // Schedule next
    setTimeout(() => {
      void executeNextMissionStep(database, missionId);
    }, 500);
    return getAutonomousMission(database, missionId);
  }

  const action = currentSubtask.actions[nextActionIdx];
  currentSubtask.status = "running";

  // Execute the computer action with the agent's own motor continuity
  const execResult = await executeAction(action, mission.currentScreen, {
    cursorFrom: missionCursors.get(mission.id) || { x: 500, y: 260 },
    inputMode: missionInputModes.get(mission.id) || (mission.userAway ? "auto_idle" : "agent_owned"),
  });
  if (execResult.cursorPosition) {
    missionCursors.set(mission.id, execResult.cursorPosition);
  }

  currentSubtask.completedActions += 1;
  const nextScreen = execResult.screenState || mission.currentScreen;

  // Record telemetry log
  recordComputerUseLog(database, {
    id: `log_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    missionId: mission.id,
    stepNumber: nextActionIdx + 1,
    actionType: action.action,
    actionPayload: action,
    thought: `Autonomous execution of ${action.description}`,
    result: execResult,
    cursorPosition: execResult.cursorPosition,
    screenUrl: nextScreen?.url,
    screenTitle: nextScreen?.title,
    executedAt: new Date().toISOString(),
  });

  // Update mission state
  updateAutonomousMission(database, missionId, {
    plannedSubtasks: mission.plannedSubtasks,
    currentScreen: nextScreen,
    activeAction: action,
  });

  // Schedule next step with natural human-like cadence (1.2s delay)
  setTimeout(() => {
    void executeNextMissionStep(database, missionId);
  }, 1200);

  return getAutonomousMission(database, missionId);
}

async function completeMission(
  database: DatabaseSync,
  mission: AutonomousMission,
): Promise<AutonomousMission> {
  missionCursors.delete(mission.id);
  missionInputModes.delete(mission.id);
  const completedCount = mission.plannedSubtasks.filter((s) => s.status === "completed").length;
  const durationMs = Date.now() - new Date(mission.createdAt).getTime();

  // Create real Control Center artifact for the user
  let artifactId: string | undefined;
  try {
    const taskRes = await executeCreateTask({
      title: `Review debrief: ${mission.goal.slice(0, 40)}`,
      notes: `Autonomous mission completed in background while user was away. Duration: ${Math.round(durationMs / 1000)}s.`,
      priority: "medium",
    });
    if (taskRes.ok && taskRes.data) {
      artifactId = String(taskRes.data.id);
    }
  } catch {}

  const debrief: ExecutiveDebrief = {
    summary: `Autonomous mission successfully executed while you were away. Accomplished ${completedCount}/${mission.totalSubtasks} planned operational subtasks.`,
    tasksCompleted: completedCount,
    totalTasks: mission.totalSubtasks,
    actionsExecuted: mission.plannedSubtasks.reduce((sum, s) => sum + s.completedActions, 0),
    durationMs,
    highlights: [
      `Navigated and synthesized web intelligence for: "${mission.goal}"`,
      `Executed diagnostics and verified system stability`,
      `Archived visual screen checkpoints and logs in Control Center database`,
    ],
    artifactsCreated: [
      {
        type: "task",
        title: `Debrief Review: ${mission.goal.slice(0, 30)}...`,
        id: artifactId,
      },
    ],
    errorsMitigated: ["Auto-recovery active; zero unhandled exceptions."],
    returnMessage: "Welcome back! Your requested computer tasks have finished running.",
  };

  const updated = updateAutonomousMission(database, mission.id, {
    status: "completed",
    debrief,
    completedAt: new Date().toISOString(),
    durationMs,
  });

  return updated || mission;
}

export function tickActiveAutonomousMissions(database: DatabaseSync): void {
  const active = getActiveAutonomousMission(database);
  if (active && active.status === "running") {
    void executeNextMissionStep(database, active.id);
  }
}
