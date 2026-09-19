import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  AutonomousMission,
  ComputerActionType,
  ComputerSkill,
  ComputerUseLogRecord,
  MissionStatus,
  MissionSubTask,
  ExecutiveDebrief,
  ScreenState,
} from "@/lib/computer-use-types";

export function initializeComputerSkillsStore(database: DatabaseSync): DatabaseSync {
  database.exec(`
    CREATE TABLE IF NOT EXISTS computer_use_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_phrase TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'browser',
      parameters TEXT NOT NULL,
      steps TEXT NOT NULL,
      raw_demonstration TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      success_rate REAL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_comp_skills_trigger ON computer_use_skills(trigger_phrase);
    CREATE INDEX IF NOT EXISTS idx_comp_skills_created ON computer_use_skills(created_at DESC);

    CREATE TABLE IF NOT EXISTS computer_use_missions (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'away',
      user_away INTEGER NOT NULL DEFAULT 1,
      planned_subtasks TEXT NOT NULL,
      current_subtask_index INTEGER NOT NULL DEFAULT 0,
      total_subtasks INTEGER NOT NULL DEFAULT 0,
      current_screen TEXT,
      active_action TEXT,
      debrief TEXT,
      error TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_comp_missions_status ON computer_use_missions(status);
    CREATE INDEX IF NOT EXISTS idx_comp_missions_created ON computer_use_missions(created_at DESC);

    CREATE TABLE IF NOT EXISTS computer_use_logs (
      id TEXT PRIMARY KEY,
      mission_id TEXT,
      skill_id TEXT,
      step_number INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      action_payload TEXT NOT NULL,
      thought TEXT,
      result TEXT NOT NULL,
      cursor_position TEXT,
      screen_url TEXT,
      screen_title TEXT,
      executed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comp_logs_mission ON computer_use_logs(mission_id);
    CREATE INDEX IF NOT EXISTS idx_comp_logs_executed ON computer_use_logs(executed_at DESC);
  `);

  // Seed default core computer skills if table is empty
  try {
    const existing = database.prepare("SELECT COUNT(*) as count FROM computer_use_skills").get() as { count: number };
    if (existing.count === 0) {
      seedDefaultComputerSkills(database);
    }
  } catch (err) {
    console.error("Failed to seed initial computer skills", err);
  }

  return database;
}

function seedDefaultComputerSkills(database: DatabaseSync) {
  const defaultSkills: Array<Omit<ComputerSkill, "createdAt" | "updatedAt" | "runCount" | "successRate">> = [
    {
      id: "skill_hn_digest",
      name: "Hacker News AI Digest",
      triggerPhrase: "hacker news ai digest",
      description: "Navigates to Hacker News, scans for top AI/ML discussions, extracts trending stories, and logs a summary.",
      category: "browser",
      parameters: [
        { name: "query", type: "string", description: "Search keyword or topic", defaultValue: "AI", required: false },
      ],
      steps: [
        {
          id: "step_1",
          action: "navigate",
          description: "Open Hacker News frontpage or search",
          value: "https://news.ycombinator.com",
        },
        {
          id: "step_2",
          action: "extract_data",
          description: "Extract top stories, points, and comment links",
          target: { selector: ".athing" },
        },
      ],
    },
    {
      id: "skill_github_trending",
      name: "GitHub Trending Scanner",
      triggerPhrase: "scan github trending",
      description: "Visits GitHub Trending repositories, extracts top open-source projects, stars, and descriptions.",
      category: "browser",
      parameters: [
        { name: "language", type: "string", description: "Programming language", defaultValue: "typescript", required: false },
      ],
      steps: [
        {
          id: "step_1",
          action: "navigate",
          description: "Navigate to GitHub Trending",
          value: "https://github.com/trending",
        },
        {
          id: "step_2",
          action: "extract_data",
          description: "Extract repository names and star counts",
          target: { selector: "article.Box-row" },
        },
      ],
    },
    {
      id: "skill_sys_audit",
      name: "Operating System Health Audit",
      triggerPhrase: "audit system health",
      description: "Runs system diagnostics, checks memory, disk space, and active processes like a system administrator.",
      category: "system",
      parameters: [],
      steps: [
        {
          id: "step_1",
          action: "run_cli",
          description: "Check Node version and platform status",
          value: "node -e 'console.log(JSON.stringify({platform: process.platform, arch: process.arch, memory: process.memoryUsage(), uptime: process.uptime()}))'",
        },
      ],
    },
  ];

  for (const skill of defaultSkills) {
    createComputerSkill(database, skill);
  }
}

function parseSkillRow(row: Record<string, unknown>): ComputerSkill {
  let parameters = [];
  let steps = [];
  let rawDemonstration = undefined;

  try {
    parameters = JSON.parse(String(row.parameters));
  } catch {}
  try {
    steps = JSON.parse(String(row.steps));
  } catch {}
  if (row.raw_demonstration) {
    try {
      rawDemonstration = JSON.parse(String(row.raw_demonstration));
    } catch {}
  }

  return {
    id: String(row.id),
    name: String(row.name),
    triggerPhrase: String(row.trigger_phrase),
    description: String(row.description || ""),
    category: (row.category as ComputerSkill["category"]) || "browser",
    parameters,
    steps,
    rawDemonstration,
    runCount: Number(row.run_count) || 0,
    successRate: typeof row.success_rate === "number" ? row.success_rate : 1.0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : undefined,
  };
}

export function createComputerSkill(
  database: DatabaseSync,
  skill: Omit<ComputerSkill, "id" | "createdAt" | "updatedAt" | "runCount" | "successRate"> & {
    id?: string;
    runCount?: number;
    successRate?: number;
  },
): ComputerSkill {
  const now = new Date().toISOString();
  const id = skill.id || `skill_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const trigger = skill.triggerPhrase.toLowerCase().trim();

  const stmt = database.prepare(`
    INSERT INTO computer_use_skills (
      id, name, trigger_phrase, description, category, parameters, steps, raw_demonstration,
      run_count, success_rate, created_at, updated_at, last_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    skill.name.trim(),
    trigger,
    skill.description || null,
    skill.category || "custom",
    JSON.stringify(skill.parameters || []),
    JSON.stringify(skill.steps || []),
    skill.rawDemonstration ? JSON.stringify(skill.rawDemonstration) : null,
    skill.runCount || 0,
    skill.successRate ?? 1.0,
    now,
    now,
    null,
  );

  return {
    ...skill,
    id,
    triggerPhrase: trigger,
    runCount: skill.runCount || 0,
    successRate: skill.successRate ?? 1.0,
    createdAt: now,
    updatedAt: now,
  };
}

export function getComputerSkill(database: DatabaseSync, id: string): ComputerSkill | null {
  const stmt = database.prepare(`SELECT * FROM computer_use_skills WHERE id = ?`);
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseSkillRow(row);
}

export function findComputerSkillByTrigger(database: DatabaseSync, phrase: string): ComputerSkill | null {
  const norm = phrase.toLowerCase().trim();
  const stmt = database.prepare(`
    SELECT * FROM computer_use_skills
    WHERE trigger_phrase = ? OR lower(name) = ?
    LIMIT 1
  `);
  let row = stmt.get(norm, norm) as Record<string, unknown> | undefined;

  if (!row) {
    const stripped = norm.replace(/^(run\s+skill|execute\s+skill|skill|please\s+run\s+skill)\s+/i, "").trim();
    if (stripped && stripped !== norm) {
      row = stmt.get(stripped, stripped) as Record<string, unknown> | undefined;
    }
  }

  if (!row) {
    const all = listComputerSkills(database, 100);
    const match = all.find((s) => {
      const tp = s.triggerPhrase.toLowerCase();
      const nm = s.name.toLowerCase();
      return (
        norm === tp ||
        norm === nm ||
        norm.includes(tp) ||
        norm.includes(nm) ||
        (tp.length > 3 && tp.includes(norm))
      );
    });
    if (match) return match;
    return null;
  }

  return parseSkillRow(row);
}

export function listComputerSkills(database: DatabaseSync, limit = 50): ComputerSkill[] {
  const stmt = database.prepare(`SELECT * FROM computer_use_skills ORDER BY created_at DESC LIMIT ?`);
  const rows = stmt.all(limit) as Array<Record<string, unknown>>;
  return rows.map(parseSkillRow);
}

export function updateComputerSkill(
  database: DatabaseSync,
  id: string,
  updates: Partial<Pick<ComputerSkill, "name" | "triggerPhrase" | "description" | "steps" | "parameters" | "category">>,
): ComputerSkill | null {
  const existing = getComputerSkill(database, id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const name = updates.name !== undefined ? updates.name.trim() : existing.name;
  const trigger = updates.triggerPhrase !== undefined ? updates.triggerPhrase.toLowerCase().trim() : existing.triggerPhrase;
  const desc = updates.description !== undefined ? updates.description : existing.description;
  const cat = updates.category !== undefined ? updates.category : existing.category;
  const params = updates.parameters !== undefined ? JSON.stringify(updates.parameters) : JSON.stringify(existing.parameters);
  const steps = updates.steps !== undefined ? JSON.stringify(updates.steps) : JSON.stringify(existing.steps);

  const stmt = database.prepare(`
    UPDATE computer_use_skills
    SET name = ?, trigger_phrase = ?, description = ?, category = ?, parameters = ?, steps = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(name, trigger, desc, cat, params, steps, now, id);

  return getComputerSkill(database, id);
}

export function deleteComputerSkill(database: DatabaseSync, id: string): boolean {
  const stmt = database.prepare(`DELETE FROM computer_use_skills WHERE id = ?`);
  const res = stmt.run(id);
  return res.changes > 0;
}

export function recordSkillRun(database: DatabaseSync, id: string, success: boolean): void {
  const now = new Date().toISOString();
  const skill = getComputerSkill(database, id);
  if (!skill) return;

  const newCount = skill.runCount + 1;
  const newSuccessRate = ((skill.successRate || 1.0) * skill.runCount + (success ? 1 : 0)) / newCount;

  const stmt = database.prepare(`
    UPDATE computer_use_skills
    SET run_count = ?, success_rate = ?, last_run_at = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(newCount, Math.round(newSuccessRate * 100) / 100, now, now, id);
}

// ================= Autonomous Missions =================

function parseMissionRow(row: Record<string, unknown>): AutonomousMission {
  let plannedSubtasks: MissionSubTask[] = [];
  let debrief: ExecutiveDebrief | undefined = undefined;
  let currentScreen: ScreenState | undefined = undefined;
  let activeAction = undefined;

  try {
    plannedSubtasks = JSON.parse(String(row.planned_subtasks));
  } catch {}
  if (row.debrief) {
    try {
      debrief = JSON.parse(String(row.debrief));
    } catch {}
  }
  if (row.current_screen) {
    try {
      currentScreen = JSON.parse(String(row.current_screen));
    } catch {}
  }
  if (row.active_action) {
    try {
      activeAction = JSON.parse(String(row.active_action));
    } catch {}
  }

  return {
    id: String(row.id),
    goal: String(row.goal),
    status: row.status as MissionStatus,
    mode: (row.mode as AutonomousMission["mode"]) || "away",
    userAway: Boolean(row.user_away),
    plannedSubtasks,
    currentSubtaskIndex: Number(row.current_subtask_index) || 0,
    totalSubtasks: Number(row.total_subtasks) || 0,
    currentScreen,
    activeAction,
    debrief,
    error: row.error ? String(row.error) : undefined,
    durationMs: typeof row.duration_ms === "number" ? row.duration_ms : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

export function createAutonomousMission(
  database: DatabaseSync,
  mission: Omit<AutonomousMission, "id" | "createdAt" | "updatedAt"> & { id?: string },
): AutonomousMission {
  const now = new Date().toISOString();
  const id = mission.id || `mission_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

  const stmt = database.prepare(`
    INSERT INTO computer_use_missions (
      id, goal, status, mode, user_away, planned_subtasks, current_subtask_index, total_subtasks,
      current_screen, active_action, debrief, error, duration_ms, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    mission.goal,
    mission.status,
    mission.mode || "away",
    mission.userAway ? 1 : 0,
    JSON.stringify(mission.plannedSubtasks || []),
    mission.currentSubtaskIndex || 0,
    mission.totalSubtasks || (mission.plannedSubtasks?.length || 0),
    mission.currentScreen ? JSON.stringify(mission.currentScreen) : null,
    mission.activeAction ? JSON.stringify(mission.activeAction) : null,
    mission.debrief ? JSON.stringify(mission.debrief) : null,
    mission.error || null,
    mission.durationMs || null,
    now,
    now,
    mission.completedAt || null,
  );

  return {
    ...mission,
    id,
    createdAt: now,
    updatedAt: now,
  };
}

export function getAutonomousMission(database: DatabaseSync, id: string): AutonomousMission | null {
  const stmt = database.prepare(`SELECT * FROM computer_use_missions WHERE id = ?`);
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseMissionRow(row);
}

export function getActiveAutonomousMission(database: DatabaseSync): AutonomousMission | null {
  const stmt = database.prepare(`
    SELECT * FROM computer_use_missions
    WHERE status IN ('running', 'planning', 'queued')
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = stmt.get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseMissionRow(row);
}

export function listAutonomousMissions(database: DatabaseSync, limit = 20): AutonomousMission[] {
  const stmt = database.prepare(`SELECT * FROM computer_use_missions ORDER BY created_at DESC LIMIT ?`);
  const rows = stmt.all(limit) as Array<Record<string, unknown>>;
  return rows.map(parseMissionRow);
}

export function updateAutonomousMission(
  database: DatabaseSync,
  id: string,
  updates: Partial<
    Pick<
      AutonomousMission,
      | "status"
      | "plannedSubtasks"
      | "currentSubtaskIndex"
      | "currentScreen"
      | "activeAction"
      | "debrief"
      | "error"
      | "durationMs"
      | "completedAt"
    >
  >,
): AutonomousMission | null {
  const existing = getAutonomousMission(database, id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const nextStatus = updates.status ?? existing.status;
  const nextSubtasks = updates.plannedSubtasks ? JSON.stringify(updates.plannedSubtasks) : JSON.stringify(existing.plannedSubtasks);
  const nextSubtaskIndex = updates.currentSubtaskIndex ?? existing.currentSubtaskIndex;
  const nextScreen = updates.currentScreen !== undefined ? JSON.stringify(updates.currentScreen) : (existing.currentScreen ? JSON.stringify(existing.currentScreen) : null);
  const nextAction = updates.activeAction !== undefined ? JSON.stringify(updates.activeAction) : (existing.activeAction ? JSON.stringify(existing.activeAction) : null);
  const nextDebrief = updates.debrief !== undefined ? JSON.stringify(updates.debrief) : (existing.debrief ? JSON.stringify(existing.debrief) : null);
  const nextError = updates.error ?? existing.error ?? null;
  const nextDuration = updates.durationMs ?? existing.durationMs ?? null;
  const nextCompletedAt = updates.completedAt ?? existing.completedAt ?? null;

  const stmt = database.prepare(`
    UPDATE computer_use_missions
    SET status = ?, planned_subtasks = ?, current_subtask_index = ?, current_screen = ?,
        active_action = ?, debrief = ?, error = ?, duration_ms = ?, updated_at = ?, completed_at = ?
    WHERE id = ?
  `);

  stmt.run(
    nextStatus,
    nextSubtasks,
    nextSubtaskIndex,
    nextScreen,
    nextAction,
    nextDebrief,
    nextError,
    nextDuration,
    now,
    nextCompletedAt,
    id,
  );

  return getAutonomousMission(database, id);
}

// ================= Computer Use Logs =================

export function recordComputerUseLog(database: DatabaseSync, log: ComputerUseLogRecord): void {
  const stmt = database.prepare(`
    INSERT INTO computer_use_logs (
      id, mission_id, skill_id, step_number, action_type, action_payload,
      thought, result, cursor_position, screen_url, screen_title, executed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    log.id,
    log.missionId || null,
    log.skillId || null,
    log.stepNumber,
    log.actionType,
    JSON.stringify(log.actionPayload),
    log.thought || null,
    JSON.stringify(log.result),
    log.cursorPosition ? JSON.stringify(log.cursorPosition) : null,
    log.screenUrl || null,
    log.screenTitle || null,
    log.executedAt,
  );
}

export function listComputerUseLogs(database: DatabaseSync, missionId?: string, limit = 50): ComputerUseLogRecord[] {
  let rows: Array<Record<string, unknown>>;
  if (missionId) {
    const stmt = database.prepare(`
      SELECT * FROM computer_use_logs
      WHERE mission_id = ?
      ORDER BY executed_at DESC
      LIMIT ?
    `);
    rows = stmt.all(missionId, limit) as Array<Record<string, unknown>>;
  } else {
    const stmt = database.prepare(`
      SELECT * FROM computer_use_logs
      ORDER BY executed_at DESC
      LIMIT ?
    `);
    rows = stmt.all(limit) as Array<Record<string, unknown>>;
  }

  return rows.map((row) => ({
    id: String(row.id),
    missionId: row.mission_id ? String(row.mission_id) : undefined,
    skillId: row.skill_id ? String(row.skill_id) : undefined,
    stepNumber: Number(row.step_number) || 0,
    actionType: row.action_type as ComputerActionType,
    actionPayload: JSON.parse(String(row.action_payload)),
    thought: row.thought ? String(row.thought) : undefined,
    result: JSON.parse(String(row.result)),
    cursorPosition: row.cursor_position ? JSON.parse(String(row.cursor_position)) : undefined,
    screenUrl: row.screen_url ? String(row.screen_url) : undefined,
    screenTitle: row.screen_title ? String(row.screen_title) : undefined,
    executedAt: String(row.executed_at),
  }));
}
