import type { DatabaseSync } from "node:sqlite";

export type AgenticJobType = "paper_research" | "web_deep_dive" | "autonomous_task";
export type AgenticJobStatus = "queued" | "running" | "completed" | "failed";

export type AcademicPaper = {
  id: string;
  title: string;
  authors: string[];
  summary: string;
  published: string;
  pdfUrl?: string;
  url: string;
};

export type ResearchDossier = {
  title: string;
  topic: string;
  executiveSummary: string;
  keyInsights: string[];
  papers: AcademicPaper[];
  recommendedActions: string[];
  synthesizedAt: string;
};

export type AgenticJob = {
  id: string;
  type: AgenticJobType;
  query: string;
  status: AgenticJobStatus;
  progress?: string;
  dossier?: ResearchDossier;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type TaughtTaskStep = {
  id: string;
  instruction: string;
  tool?: string;
  args?: Record<string, unknown>;
};

export type TaughtTask = {
  id: string;
  name: string;
  triggerPhrase: string;
  description?: string;
  steps: TaughtTaskStep[];
  scheduleType?: "manual" | "one_time" | "recurring";
  scheduledTime?: string;
  intervalMinutes?: number;
  status?: "active" | "paused" | "running" | "completed";
  lastRunResult?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  runCount: number;
};

export type TaughtTaskRunRecord = {
  id: string;
  taskId: string;
  taskName: string;
  triggeredBy: "user" | "scheduler" | "voice";
  status: "completed" | "failed";
  stepResults: Array<{ stepIndex: number; instruction: string; result: unknown; success: boolean }>;
  summary?: string;
  executedAt: string;
  durationMs?: number;
};

export function initializeAgenticStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agentic_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      query TEXT NOT NULL,
      status TEXT NOT NULL,
      progress TEXT,
      dossier TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agentic_jobs_status ON agentic_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_agentic_jobs_created_at ON agentic_jobs(created_at DESC);

    CREATE TABLE IF NOT EXISTS taught_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_phrase TEXT NOT NULL,
      description TEXT,
      steps TEXT NOT NULL,
      schedule_type TEXT DEFAULT 'manual',
      scheduled_time TEXT,
      interval_minutes INTEGER,
      status TEXT DEFAULT 'active',
      last_run_result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT,
      run_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_taught_tasks_trigger ON taught_tasks(trigger_phrase);
    CREATE INDEX IF NOT EXISTS idx_taught_tasks_created_at ON taught_tasks(created_at DESC);

    CREATE TABLE IF NOT EXISTS taught_task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      status TEXT NOT NULL,
      step_results TEXT NOT NULL,
      summary TEXT,
      executed_at TEXT NOT NULL,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_taught_task_runs_task ON taught_task_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_taught_task_runs_executed ON taught_task_runs(executed_at DESC);
  `);

  // Migrate any existing taught_tasks tables that might lack new columns
  try {
    const columns = database.prepare("PRAGMA table_info(taught_tasks)").all() as Array<{ name: string }>;
    const colNames = new Set(columns.map((c) => c.name));
    if (!colNames.has("schedule_type")) {
      database.exec("ALTER TABLE taught_tasks ADD COLUMN schedule_type TEXT DEFAULT 'manual'");
    }
    if (!colNames.has("scheduled_time")) {
      database.exec("ALTER TABLE taught_tasks ADD COLUMN scheduled_time TEXT");
    }
    if (!colNames.has("interval_minutes")) {
      database.exec("ALTER TABLE taught_tasks ADD COLUMN interval_minutes INTEGER");
    }
    if (!colNames.has("status")) {
      database.exec("ALTER TABLE taught_tasks ADD COLUMN status TEXT DEFAULT 'active'");
    }
    if (!colNames.has("last_run_result")) {
      database.exec("ALTER TABLE taught_tasks ADD COLUMN last_run_result TEXT");
    }
  } catch {}

  return database;
}

export function createAgenticJob(
  database: DatabaseSync,
  job: Omit<AgenticJob, "createdAt" | "updatedAt">,
): AgenticJob {
  const now = new Date().toISOString();
  const stmt = database.prepare(`
    INSERT INTO agentic_jobs (id, type, query, status, progress, dossier, error, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    job.id,
    job.type,
    job.query,
    job.status,
    job.progress || null,
    job.dossier ? JSON.stringify(job.dossier) : null,
    job.error || null,
    now,
    now,
    job.completedAt || null,
  );

  return {
    ...job,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateAgenticJob(
  database: DatabaseSync,
  id: string,
  updates: Partial<Pick<AgenticJob, "status" | "progress" | "dossier" | "error" | "completedAt">>,
): AgenticJob | null {
  const existing = getAgenticJob(database, id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const nextStatus = updates.status ?? existing.status;
  const nextProgress = updates.progress ?? existing.progress;
  const nextDossier = updates.dossier !== undefined ? updates.dossier : existing.dossier;
  const nextError = updates.error ?? existing.error;
  const nextCompletedAt = updates.completedAt ?? existing.completedAt;

  const stmt = database.prepare(`
    UPDATE agentic_jobs
    SET status = ?, progress = ?, dossier = ?, error = ?, updated_at = ?, completed_at = ?
    WHERE id = ?
  `);

  stmt.run(
    nextStatus,
    nextProgress || null,
    nextDossier ? JSON.stringify(nextDossier) : null,
    nextError || null,
    now,
    nextCompletedAt || null,
    id,
  );

  return {
    ...existing,
    status: nextStatus,
    progress: nextProgress,
    dossier: nextDossier,
    error: nextError,
    updatedAt: now,
    completedAt: nextCompletedAt,
  };
}

export function getAgenticJob(database: DatabaseSync, id: string): AgenticJob | null {
  const stmt = database.prepare(`
    SELECT id, type, query, status, progress, dossier, error, created_at, updated_at, completed_at
    FROM agentic_jobs
    WHERE id = ?
  `);
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  let parsedDossier: ResearchDossier | undefined;
  if (typeof row.dossier === "string") {
    try {
      parsedDossier = JSON.parse(row.dossier);
    } catch {}
  }

  return {
    id: String(row.id),
    type: row.type as AgenticJobType,
    query: String(row.query),
    status: row.status as AgenticJobStatus,
    progress: typeof row.progress === "string" ? row.progress : undefined,
    dossier: parsedDossier,
    error: typeof row.error === "string" ? row.error : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: typeof row.completed_at === "string" ? row.completed_at : undefined,
  };
}

export function listAgenticJobs(database: DatabaseSync, limit = 20): AgenticJob[] {
  const stmt = database.prepare(`
    SELECT id, type, query, status, progress, dossier, error, created_at, updated_at, completed_at
    FROM agentic_jobs
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    let parsedDossier: ResearchDossier | undefined;
    if (typeof row.dossier === "string") {
      try {
        parsedDossier = JSON.parse(row.dossier);
      } catch {}
    }
    return {
      id: String(row.id),
      type: row.type as AgenticJobType,
      query: String(row.query),
      status: row.status as AgenticJobStatus,
      progress: typeof row.progress === "string" ? row.progress : undefined,
      dossier: parsedDossier,
      error: typeof row.error === "string" ? row.error : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: typeof row.completed_at === "string" ? row.completed_at : undefined,
    };
  });
}

function parseTaughtTaskRow(row: Record<string, unknown>): TaughtTask {
  let steps: TaughtTaskStep[] = [];
  try {
    steps = JSON.parse(String(row.steps));
  } catch {}

  return {
    id: String(row.id),
    name: String(row.name),
    triggerPhrase: String(row.trigger_phrase),
    description: typeof row.description === "string" ? row.description : undefined,
    steps,
    scheduleType: (typeof row.schedule_type === "string" ? row.schedule_type : "manual") as TaughtTask["scheduleType"],
    scheduledTime: typeof row.scheduled_time === "string" ? row.scheduled_time : undefined,
    intervalMinutes: typeof row.interval_minutes === "number" ? row.interval_minutes : undefined,
    status: (typeof row.status === "string" ? row.status : "active") as TaughtTask["status"],
    lastRunResult: typeof row.last_run_result === "string" ? row.last_run_result : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastRunAt: typeof row.last_run_at === "string" ? row.last_run_at : undefined,
    runCount: Number(row.run_count) || 0,
  };
}

export function createTaughtTask(
  database: DatabaseSync,
  task: Omit<TaughtTask, "createdAt" | "updatedAt" | "runCount">,
): TaughtTask {
  const now = new Date().toISOString();
  const stmt = database.prepare(`
    INSERT INTO taught_tasks (id, name, trigger_phrase, description, steps, schedule_type, scheduled_time, interval_minutes, status, last_run_result, created_at, updated_at, last_run_at, run_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    task.id,
    task.name,
    task.triggerPhrase.toLowerCase().trim(),
    task.description || null,
    JSON.stringify(task.steps),
    task.scheduleType || "manual",
    task.scheduledTime || null,
    task.intervalMinutes || null,
    task.status || "active",
    task.lastRunResult || null,
    now,
    now,
    task.lastRunAt || null,
    0,
  );

  return {
    ...task,
    triggerPhrase: task.triggerPhrase.toLowerCase().trim(),
    scheduleType: task.scheduleType || "manual",
    status: task.status || "active",
    createdAt: now,
    updatedAt: now,
    runCount: 0,
  };
}

export function getTaughtTask(database: DatabaseSync, id: string): TaughtTask | null {
  const stmt = database.prepare(`
    SELECT id, name, trigger_phrase, description, steps, schedule_type, scheduled_time, interval_minutes, status, last_run_result, created_at, updated_at, last_run_at, run_count
    FROM taught_tasks
    WHERE id = ?
  `);
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseTaughtTaskRow(row);
}

export function findTaughtTaskByTrigger(database: DatabaseSync, phrase: string): TaughtTask | null {
  const normalized = phrase.toLowerCase().trim();
  const stmt = database.prepare(`
    SELECT id, name, trigger_phrase, description, steps, schedule_type, scheduled_time, interval_minutes, status, last_run_result, created_at, updated_at, last_run_at, run_count
    FROM taught_tasks
    WHERE trigger_phrase = ? OR lower(name) = ?
    LIMIT 1
  `);
  let row = stmt.get(normalized, normalized) as Record<string, unknown> | undefined;

  if (!row) {
    const stripped = normalized.replace(/^(run|execute|start|launch|trigger|do|please\s+run|please\s+execute)\s+/i, "").trim();
    if (stripped && stripped !== normalized) {
      row = stmt.get(stripped, stripped) as Record<string, unknown> | undefined;
    }
  }

  if (!row) {
    const all = listTaughtTasks(database, 50);
    const matched = all.find((t) => {
      const tp = t.triggerPhrase.toLowerCase();
      const nm = t.name.toLowerCase();
      return (
        normalized === tp ||
        normalized === nm ||
        normalized.includes(tp) ||
        normalized.includes(nm) ||
        (tp.length > 3 && tp.includes(normalized))
      );
    });
    if (matched) {
      return matched;
    }
    return null;
  }

  return parseTaughtTaskRow(row);
}

export function listTaughtTasks(database: DatabaseSync, limit = 50): TaughtTask[] {
  const stmt = database.prepare(`
    SELECT id, name, trigger_phrase, description, steps, schedule_type, scheduled_time, interval_minutes, status, last_run_result, created_at, updated_at, last_run_at, run_count
    FROM taught_tasks
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit) as Array<Record<string, unknown>>;
  return rows.map(parseTaughtTaskRow);
}

export function listDueTaughtTasks(database: DatabaseSync): TaughtTask[] {
  const nowIso = new Date().toISOString();
  const stmt = database.prepare(`
    SELECT id, name, trigger_phrase, description, steps, schedule_type, scheduled_time, interval_minutes, status, last_run_result, created_at, updated_at, last_run_at, run_count
    FROM taught_tasks
    WHERE status = 'active' AND (
      (schedule_type = 'one_time' AND scheduled_time IS NOT NULL AND scheduled_time <= ?)
      OR
      (schedule_type = 'recurring' AND interval_minutes IS NOT NULL AND (
        last_run_at IS NULL OR datetime(last_run_at, '+' || interval_minutes || ' minutes') <= datetime('now')
      ))
    )
  `);
  const rows = stmt.all(nowIso) as Array<Record<string, unknown>>;
  return rows.map(parseTaughtTaskRow);
}

export function scheduleTaughtTask(
  database: DatabaseSync,
  taskId: string,
  schedule: { type: "manual" | "one_time" | "recurring"; scheduledTime?: string; inMinutes?: number; intervalMinutes?: number },
): TaughtTask | null {
  const now = new Date();
  let scheduledTime = schedule.scheduledTime;
  if (schedule.inMinutes && schedule.inMinutes > 0) {
    scheduledTime = new Date(now.getTime() + schedule.inMinutes * 60_000).toISOString();
  }

  const stmt = database.prepare(`
    UPDATE taught_tasks
    SET schedule_type = ?, scheduled_time = ?, interval_minutes = ?, status = 'active', updated_at = ?
    WHERE id = ?
  `);
  stmt.run(
    schedule.type,
    scheduledTime || null,
    schedule.intervalMinutes || null,
    now.toISOString(),
    taskId,
  );
  return getTaughtTask(database, taskId);
}

export function recordTaughtTaskRun(database: DatabaseSync, id: string, lastResult?: string, nextStatus?: string): boolean {
  const now = new Date().toISOString();
  const stmt = database.prepare(`
    UPDATE taught_tasks
    SET run_count = run_count + 1, last_run_at = ?, last_run_result = COALESCE(?, last_run_result), status = COALESCE(?, status), updated_at = ?
    WHERE id = ?
  `);
  const res = stmt.run(now, lastResult || null, nextStatus || null, now, id);
  return res.changes > 0;
}

export function deleteTaughtTask(database: DatabaseSync, id: string): boolean {
  const stmt = database.prepare(`DELETE FROM taught_tasks WHERE id = ?`);
  const res = stmt.run(id);
  return res.changes > 0;
}

export function recordTaskRunLog(database: DatabaseSync, log: TaughtTaskRunRecord): void {
  const stmt = database.prepare(`
    INSERT INTO taught_task_runs (id, task_id, task_name, triggered_by, status, step_results, summary, executed_at, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    log.id,
    log.taskId,
    log.taskName,
    log.triggeredBy,
    log.status,
    JSON.stringify(log.stepResults),
    log.summary || null,
    log.executedAt,
    log.durationMs || null,
  );
}

export function listTaskRunLogs(database: DatabaseSync, taskId?: string, limit = 50): TaughtTaskRunRecord[] {
  let rows: Array<Record<string, unknown>>;
  if (taskId) {
    const stmt = database.prepare(`
      SELECT id, task_id, task_name, triggered_by, status, step_results, summary, executed_at, duration_ms
      FROM taught_task_runs
      WHERE task_id = ?
      ORDER BY executed_at DESC
      LIMIT ?
    `);
    rows = stmt.all(taskId, limit) as Array<Record<string, unknown>>;
  } else {
    const stmt = database.prepare(`
      SELECT id, task_id, task_name, triggered_by, status, step_results, summary, executed_at, duration_ms
      FROM taught_task_runs
      ORDER BY executed_at DESC
      LIMIT ?
    `);
    rows = stmt.all(limit) as Array<Record<string, unknown>>;
  }

  return rows.map((row) => {
    let stepResults = [];
    try {
      stepResults = JSON.parse(String(row.step_results));
    } catch {}
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      taskName: String(row.task_name),
      triggeredBy: row.triggered_by as TaughtTaskRunRecord["triggeredBy"],
      status: row.status as TaughtTaskRunRecord["status"],
      stepResults,
      summary: typeof row.summary === "string" ? row.summary : undefined,
      executedAt: String(row.executed_at),
      durationMs: typeof row.duration_ms === "number" ? row.duration_ms : undefined,
    };
  });
}

