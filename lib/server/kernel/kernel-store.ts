import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  CapabilityGrant,
  EvidenceClaim,
  KernelEvent,
  MemoryItem,
  MemoryLayer,
  MissionGraph,
  MissionJournalEvent,
  TaskNode,
  TaskNodeStatus,
  ToolRiskLevel,
  VaultSecret,
  WatchdogReport,
  WorldStateFact,
  AgentTelemetryTrace,
  CollaborationMode,
} from "./types";

export function initializeKernelStore(database: DatabaseSync): DatabaseSync {
  database.exec(`
    -- 7. Agent Control Plane & Mission DAG
    CREATE TABLE IF NOT EXISTS kernel_missions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL,
      collaboration_mode TEXT NOT NULL DEFAULT 'delegated',
      budget TEXT NOT NULL,
      success_criteria TEXT NOT NULL,
      stop_conditions TEXT NOT NULL,
      checkpoint_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_kmissions_status ON kernel_missions(status);
    CREATE INDEX IF NOT EXISTS idx_kmissions_created ON kernel_missions(created_at DESC);

    CREATE TABLE IF NOT EXISTS kernel_tasks (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      assigned_role TEXT NOT NULL,
      tool TEXT,
      args TEXT,
      dependencies TEXT NOT NULL,
      status TEXT NOT NULL,
      max_retries INTEGER NOT NULL DEFAULT 3,
      retry_count INTEGER NOT NULL DEFAULT 0,
      timeout_ms INTEGER NOT NULL DEFAULT 60000,
      output TEXT,
      error TEXT,
      confidence_score REAL,
      verification_evidence TEXT,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ktasks_mission ON kernel_tasks(mission_id);
    CREATE INDEX IF NOT EXISTS idx_ktasks_status ON kernel_tasks(status);

    -- 7.2 Durable Mission Journal (Event Sourcing)
    CREATE TABLE IF NOT EXISTS kernel_mission_journal (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      task_id TEXT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kmjournal_mission ON kernel_mission_journal(mission_id);
    CREATE INDEX IF NOT EXISTS idx_kmjournal_ts ON kernel_mission_journal(timestamp DESC);

    -- 7.3 Workstation World State (Digital Twin)
    CREATE TABLE IF NOT EXISTS kernel_world_state (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kworld_cat_key ON kernel_world_state(category, key);

    -- 11. Secure Capability Broker
    CREATE TABLE IF NOT EXISTS kernel_capability_grants (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      purpose TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kcap_mission ON kernel_capability_grants(mission_id);

    CREATE TABLE IF NOT EXISTS kernel_vault_secrets (
      key TEXT PRIMARY KEY,
      encrypted_value TEXT NOT NULL,
      category TEXT NOT NULL,
      allowed_scopes TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 13. Knowledge OS — 4 Memory Layers
    CREATE TABLE IF NOT EXISTS kernel_knowledge_memory (
      id TEXT PRIMARY KEY,
      layer TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 1.0,
      source_mission_id TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kmem_layer ON kernel_knowledge_memory(layer);
    CREATE INDEX IF NOT EXISTS idx_kmem_importance ON kernel_knowledge_memory(importance DESC);

    -- 15. Research Engine Evidence Graph
    CREATE TABLE IF NOT EXISTS kernel_evidence_graph (
      id TEXT PRIMARY KEY,
      research_id TEXT NOT NULL,
      claim TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_title TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      contradicted_by TEXT,
      verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kevid_research ON kernel_evidence_graph(research_id);

    -- 19. Event Bus 2.0
    CREATE TABLE IF NOT EXISTS kernel_event_bus (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kevents_topic ON kernel_event_bus(topic);
    CREATE INDEX IF NOT EXISTS idx_kevents_ts ON kernel_event_bus(timestamp DESC);

    -- 20. Observability & Telemetry Traces
    CREATE TABLE IF NOT EXISTS kernel_telemetry_traces (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      model_used TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      total_cost_usd REAL NOT NULL,
      latency_ms INTEGER NOT NULL,
      tool_calls_count INTEGER NOT NULL,
      error_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ktraces_mission ON kernel_telemetry_traces(mission_id);

    -- 9.2 Watchdog Supervisor Incidents
    CREATE TABLE IF NOT EXISTS kernel_watchdog_incidents (
      incident_id TEXT PRIMARY KEY,
      trigger_component TEXT NOT NULL,
      error_detected TEXT NOT NULL,
      recovery_action_taken TEXT NOT NULL,
      recovered INTEGER NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);

  return database;
}

// ----------------------------------------------------
// Mission CRUD & DAG Persistence
// ----------------------------------------------------
export function saveMissionGraph(database: DatabaseSync, mission: MissionGraph): void {
  database.prepare(`
    INSERT INTO kernel_missions (
      id, title, objective, status, collaboration_mode, budget, success_criteria, stop_conditions, checkpoint_id, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      collaboration_mode = excluded.collaboration_mode,
      budget = excluded.budget,
      checkpoint_id = excluded.checkpoint_id,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at
  `).run(
    mission.id,
    mission.title,
    mission.objective,
    mission.status,
    mission.collaborationMode,
    JSON.stringify(mission.budget),
    JSON.stringify(mission.successCriteria),
    JSON.stringify(mission.stopConditions),
    mission.checkpointId || null,
    mission.createdAt,
    mission.updatedAt,
    mission.completedAt || null,
  );

  for (const node of mission.nodes) {
    database.prepare(`
      INSERT INTO kernel_tasks (
        id, mission_id, title, description, assigned_role, tool, args, dependencies, status, max_retries, retry_count, timeout_ms, output, error, confidence_score, verification_evidence, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        retry_count = excluded.retry_count,
        output = excluded.output,
        error = excluded.error,
        confidence_score = excluded.confidence_score,
        verification_evidence = excluded.verification_evidence,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at
    `).run(
      node.id,
      node.missionId,
      node.title,
      node.description,
      node.assignedRole,
      node.tool || null,
      node.args ? JSON.stringify(node.args) : null,
      JSON.stringify(node.dependencies),
      node.status,
      node.maxRetries,
      node.retryCount,
      node.timeoutMs,
      node.output ? JSON.stringify(node.output) : null,
      node.error || null,
      node.confidenceScore || null,
      node.verificationEvidence || null,
      node.startedAt || null,
      node.completedAt || null,
    );
  }
}

export function getMissionGraph(database: DatabaseSync, missionId: string): MissionGraph | null {
  const row = database.prepare("SELECT * FROM kernel_missions WHERE id = ?").get(missionId) as Record<string, unknown> | undefined;
  if (!row) return null;

  const taskRows = database.prepare("SELECT * FROM kernel_tasks WHERE mission_id = ? ORDER BY id ASC").all(missionId) as Array<Record<string, unknown>>;
  const nodes: TaskNode[] = taskRows.map((t) => ({
    id: String(t.id),
    missionId: String(t.mission_id),
    title: String(t.title),
    description: String(t.description),
    assignedRole: t.assigned_role as TaskNode["assignedRole"],
    tool: t.tool ? String(t.tool) : undefined,
    args: t.args ? JSON.parse(String(t.args)) : undefined,
    dependencies: JSON.parse(String(t.dependencies || "[]")),
    status: t.status as TaskNodeStatus,
    maxRetries: Number(t.max_retries),
    retryCount: Number(t.retry_count),
    timeoutMs: Number(t.timeout_ms),
    output: t.output ? JSON.parse(String(t.output)) : undefined,
    error: t.error ? String(t.error) : undefined,
    confidenceScore: t.confidence_score ? Number(t.confidence_score) : undefined,
    verificationEvidence: t.verification_evidence ? String(t.verification_evidence) : undefined,
    startedAt: t.started_at ? String(t.started_at) : undefined,
    completedAt: t.completed_at ? String(t.completed_at) : undefined,
  }));

  return {
    id: String(row.id),
    title: String(row.title),
    objective: String(row.objective),
    status: row.status as MissionGraph["status"],
    collaborationMode: (row.collaboration_mode as CollaborationMode) || "delegated",
    budget: JSON.parse(String(row.budget || "{}")),
    successCriteria: JSON.parse(String(row.success_criteria || "[]")),
    stopConditions: JSON.parse(String(row.stop_conditions || "[]")),
    checkpointId: row.checkpoint_id ? String(row.checkpoint_id) : undefined,
    nodes,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

export function listMissions(database: DatabaseSync, limit = 20): MissionGraph[] {
  const rows = database.prepare("SELECT id FROM kernel_missions ORDER BY created_at DESC LIMIT ?").all(limit) as Array<{ id: string }>;
  return rows.map((r) => getMissionGraph(database, r.id)).filter((m): m is MissionGraph => m !== null);
}

// ----------------------------------------------------
// Journal Event Sourcing
// ----------------------------------------------------
export function appendMissionJournal(
  database: DatabaseSync,
  event: Omit<MissionJournalEvent, "id">,
): MissionJournalEvent {
  const id = `jrn_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  database.prepare(`
    INSERT INTO kernel_mission_journal (id, mission_id, task_id, type, payload, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    event.missionId,
    event.taskId || null,
    event.type,
    JSON.stringify(event.payload),
    event.timestamp,
  );
  return { id, ...event };
}

export function getMissionJournal(database: DatabaseSync, missionId: string): MissionJournalEvent[] {
  const rows = database.prepare(
    "SELECT * FROM kernel_mission_journal WHERE mission_id = ? ORDER BY timestamp ASC",
  ).all(missionId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    missionId: String(r.mission_id),
    taskId: r.task_id ? String(r.task_id) : undefined,
    type: r.type as MissionJournalEvent["type"],
    payload: JSON.parse(String(r.payload || "{}")),
    timestamp: String(r.timestamp),
  }));
}

// ----------------------------------------------------
// Digital Twin / World State
// ----------------------------------------------------
export function setWorldFact(
  database: DatabaseSync,
  category: WorldStateFact["category"],
  key: string,
  value: unknown,
  confidence = 1.0,
  source: "observed" | "inferred" = "observed",
): void {
  const id = `wfact_${category}_${key}`;
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO kernel_world_state (id, category, key, value, confidence, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(category, key) DO UPDATE SET
      value = excluded.value,
      confidence = excluded.confidence,
      source = excluded.source,
      updated_at = excluded.updated_at
  `).run(id, category, key, JSON.stringify(value), confidence, source, now);
}

export function getWorldFacts(database: DatabaseSync, category?: string): WorldStateFact[] {
  const query = category
    ? "SELECT * FROM kernel_world_state WHERE category = ? ORDER BY updated_at DESC"
    : "SELECT * FROM kernel_world_state ORDER BY category ASC, updated_at DESC";
  const rows = (category ? database.prepare(query).all(category) : database.prepare(query).all()) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    category: r.category as WorldStateFact["category"],
    key: String(r.key),
    value: JSON.parse(String(r.value || "null")),
    confidence: Number(r.confidence),
    source: r.source as "observed" | "inferred",
    updatedAt: String(r.updated_at),
  }));
}

// ----------------------------------------------------
// Knowledge OS (4 Memory Layers)
// ----------------------------------------------------
export function saveMemoryItem(database: DatabaseSync, item: Omit<MemoryItem, "id" | "createdAt" | "lastAccessedAt" | "accessCount">): MemoryItem {
  const id = `mem_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO kernel_knowledge_memory (
      id, layer, title, content, tags, importance, confidence, source_mission_id, access_count, created_at, last_accessed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    item.layer,
    item.title,
    item.content,
    JSON.stringify(item.tags),
    item.importance,
    item.confidence,
    item.sourceMissionId || null,
    now,
    now,
  );

  return {
    ...item,
    id,
    accessCount: 0,
    createdAt: now,
    lastAccessedAt: now,
  };
}

export function searchKnowledgeMemory(
  database: DatabaseSync,
  query: string,
  layer?: MemoryLayer,
  limit = 10,
): MemoryItem[] {
  const cleanQ = query.trim().toLowerCase();
  let sql = "SELECT * FROM kernel_knowledge_memory WHERE 1=1";
  const params: Array<string | number> = [];

  if (layer) {
    sql += " AND layer = ?";
    params.push(layer);
  }

  if (cleanQ) {
    sql += " AND (LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?)";
    const wild = `%${cleanQ}%`;
    params.push(wild, wild, wild);
  }

  sql += " ORDER BY (importance * confidence) DESC, last_accessed_at DESC LIMIT ?";
  params.push(limit);

  const rows = database.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const now = new Date().toISOString();

  // Update access count and timestamp
  for (const r of rows) {
    database.prepare("UPDATE kernel_knowledge_memory SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?").run(now, String(r.id));
  }

  return rows.map((r) => ({
    id: String(r.id),
    layer: r.layer as MemoryLayer,
    title: String(r.title),
    content: String(r.content),
    tags: JSON.parse(String(r.tags || "[]")),
    importance: Number(r.importance),
    confidence: Number(r.confidence),
    sourceMissionId: r.source_mission_id ? String(r.source_mission_id) : undefined,
    accessCount: Number(r.access_count) + 1,
    createdAt: String(r.created_at),
    lastAccessedAt: now,
  }));
}

// ----------------------------------------------------
// Capability Grants
// ----------------------------------------------------
export function grantCapability(
  database: DatabaseSync,
  missionId: string,
  scope: string,
  riskLevel: ToolRiskLevel,
  ttlMs = 15 * 60 * 1000,
  purpose = "Automated execution",
): CapabilityGrant {
  const id = `cap_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  database.prepare(`
    INSERT INTO kernel_capability_grants (
      id, mission_id, scope, risk_level, issued_at, expires_at, revoked, purpose
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, missionId, scope, riskLevel, issuedAt, expiresAt, purpose);

  return {
    id,
    missionId,
    scope,
    riskLevel,
    issuedAt,
    expiresAt,
    revoked: false,
    purpose,
  };
}

export function verifyCapability(
  database: DatabaseSync,
  missionId: string,
  scope: string,
): { allowed: boolean; riskLevel?: ToolRiskLevel; reason?: string } {
  const now = new Date().toISOString();
  const grant = database.prepare(`
    SELECT * FROM kernel_capability_grants
    WHERE mission_id = ? AND scope = ? AND revoked = 0 AND expires_at > ?
    ORDER BY issued_at DESC LIMIT 1
  `).get(missionId, scope, now) as Record<string, unknown> | undefined;

  if (!grant) {
    return { allowed: false, reason: `No active, unexpired capability grant for scope '${scope}'` };
  }
  return { allowed: true, riskLevel: grant.risk_level as ToolRiskLevel };
}

// ----------------------------------------------------
// Event Bus 2.0
// ----------------------------------------------------
export function emitKernelEvent(
  database: DatabaseSync,
  topic: string,
  source: string,
  payload: Record<string, unknown>,
): KernelEvent {
  const id = `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const timestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO kernel_event_bus (id, topic, source, payload, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, topic, source, JSON.stringify(payload), timestamp);

  return { id, topic, source, payload, timestamp };
}

export function listKernelEvents(database: DatabaseSync, topicPrefix?: string, limit = 50): KernelEvent[] {
  let sql = "SELECT * FROM kernel_event_bus";
  const params: Array<string | number> = [];
  if (topicPrefix) {
    sql += " WHERE topic LIKE ?";
    params.push(`${topicPrefix}%`);
  }
  sql += " ORDER BY timestamp DESC LIMIT ?";
  params.push(limit);

  const rows = database.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    topic: String(r.topic),
    source: String(r.source),
    payload: JSON.parse(String(r.payload || "{}")),
    timestamp: String(r.timestamp),
  }));
}

// ----------------------------------------------------
// Telemetry & Watchdog Reports
// ----------------------------------------------------
export function recordTelemetryTrace(database: DatabaseSync, trace: Omit<AgentTelemetryTrace, "id" | "recordedAt">): void {
  const id = `trc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO kernel_telemetry_traces (
      id, mission_id, step_name, model_used, prompt_tokens, completion_tokens, total_cost_usd, latency_ms, tool_calls_count, error_count, status, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    trace.missionId,
    trace.stepName,
    trace.modelUsed,
    trace.promptTokens,
    trace.completionTokens,
    trace.totalCostUsd,
    trace.latencyMs,
    trace.toolCallsCount,
    trace.errorCount,
    trace.status,
    now,
  );
}

export function recordWatchdogIncident(database: DatabaseSync, report: WatchdogReport): void {
  database.prepare(`
    INSERT INTO kernel_watchdog_incidents (
      incident_id, trigger_component, error_detected, recovery_action_taken, recovered, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(incident_id) DO UPDATE SET
      recovered = excluded.recovered
  `).run(
    report.incidentId,
    report.triggerComponent,
    report.errorDetected,
    report.recoveryActionTaken,
    report.recovered ? 1 : 0,
    report.timestamp,
  );
}
