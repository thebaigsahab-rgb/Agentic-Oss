/**
 * Agentic OS Kernel — Core Type System (Tracks 7–30)
 *
 * Provides strict domain typing for:
 * - 7. Agent Control Plane & Mission DAG
 * - 8. Model Router & Compute Fabric
 * - 9. Self-Healing Runtime & Watchdog
 * - 10. Verifying / Critic Layer
 * - 11. Secure Capability Broker & Secret Vault
 * - 12. Universal MCP / A2A Connector Plane
 * - 13. Knowledge OS (4 Memory Layers)
 * - 14. Computer-Use 3.0 & Spatial Perception
 * - 15. Autonomous Research & Evidence Graph
 * - 16. Agentic Software Factory
 * - 17. Sandboxed Execution Fabric
 * - 18. Proactive Personal Executive
 * - 19. Event Bus & Workflow Engine 2.0
 * - 20. Observability & Agent Telemetry
 * - 21. Digital Twin & Simulation Mode
 * - 22. Self-Improvement Loop
 * - 25. Agent Economics & Budget Engine
 * - 26. Human-Agent Collaboration Modes
 * - 27. Master Command Language
 */

// ==========================================
// 26. Human-Agent Collaboration Modes
// ==========================================
export type CollaborationMode = "copilot" | "delegated" | "ghost" | "lockdown";

// ==========================================
// 11. Capability Broker & Tool Risk
// ==========================================
export type ToolRiskLevel =
  | "read"
  | "low_risk_write"
  | "external_communication"
  | "sensitive"
  | "destructive"
  | "irreversible";

export type CapabilityGrant = {
  id: string;
  missionId: string;
  scope: string; // e.g. "fs:read:./app", "system:volume", "network:arxiv"
  riskLevel: ToolRiskLevel;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
  purpose: string;
};

export type VaultSecret = {
  key: string;
  encryptedValue: string;
  category: "api_key" | "credential" | "token" | "personal";
  allowedScopes: string[];
  updatedAt: string;
};

// ==========================================
// 7. Agent Control Plane & Mission Graph (DAG)
// ==========================================
export type TaskNodeStatus =
  | "pending"
  | "ready"
  | "in_progress"
  | "completed"
  | "failed"
  | "skipped"
  | "awaiting_approval";

export type TaskNode = {
  id: string;
  missionId: string;
  title: string;
  description: string;
  assignedRole:
    | "planner"
    | "executor"
    | "operator"
    | "researcher"
    | "coder"
    | "critic"
    | "verifier";
  tool?: string;
  args?: Record<string, unknown>;
  dependencies: string[]; // IDs of tasks that must finish before this task
  status: TaskNodeStatus;
  maxRetries: number;
  retryCount: number;
  timeoutMs: number;
  output?: unknown;
  error?: string;
  confidenceScore?: number;
  verificationEvidence?: string;
  startedAt?: string;
  completedAt?: string;
};

export type MissionGraph = {
  id: string;
  title: string;
  objective: string;
  status: "planning" | "executing" | "completed" | "failed" | "paused" | "aborted";
  collaborationMode: CollaborationMode;
  nodes: TaskNode[];
  budget: {
    maxTimeMs: number;
    maxSpendUsd: number;
    maxToolCalls: number;
    maxRetries: number;
    usedSpendUsd: number;
    usedToolCalls: number;
  };
  successCriteria: string[];
  stopConditions: string[];
  checkpointId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

// 7.2 Durable Mission Journal (Event Sourcing)
export type MissionJournalEvent = {
  id: string;
  missionId: string;
  taskId?: string;
  type:
    | "goal_received"
    | "plan_generated"
    | "plan_revised"
    | "task_started"
    | "tool_dispatched"
    | "observation_recorded"
    | "verification_passed"
    | "verification_failed"
    | "recovery_triggered"
    | "approval_requested"
    | "approval_granted"
    | "approval_denied"
    | "checkpoint_saved"
    | "mission_completed"
    | "mission_failed";
  payload: Record<string, unknown>;
  timestamp: string;
};

// 7.3 World State / Digital Twin Fact
export type WorldStateFact = {
  id: string;
  category: "app" | "window" | "file" | "service" | "device" | "network" | "metric";
  key: string;
  value: unknown;
  confidence: number; // 0.0 to 1.0
  source: "observed" | "inferred";
  updatedAt: string;
};

export type WorkstationDigitalTwin = {
  activeWindows: Array<{ title: string; handle: number; process: string; isForeground: boolean }>;
  runningProcesses: Array<{ pid: number; name: string; cpuPercent: number; memoryMb: number }>;
  battery?: { level: number; charging: boolean };
  systemAudio: { volume: number; muted: boolean };
  userIdleSeconds: number;
  networkOnline: boolean;
  activeMissions: string[];
  lastObservedAt: string;
};

// ==========================================
// 8. Model Router & Compute Fabric
// ==========================================
export type ModelRole =
  | "planner"
  | "executor"
  | "vision_ui"
  | "coding"
  | "research_reasoning"
  | "speech"
  | "embedding_rerank"
  | "verifier";

export type ModelCapabilityScore = {
  provider: string;
  modelId: string;
  role: ModelRole;
  reasoningScore: number; // 1-10
  latencyMsEstimated: number;
  costPer1kTokens: number;
  contextWindow: number;
  isLocal: boolean;
  supportsVision: boolean;
  supportsToolCalling: boolean;
};

export type ModelRouteDecision = {
  selectedProvider: string;
  selectedModel: string;
  role: ModelRole;
  routeReason: string;
  escalationLevel: "local_fast" | "local_large" | "cloud_frontier";
  estimatedCostUsd: number;
};

// ==========================================
// 9. Self-Healing & Watchdog Supervisor
// ==========================================
export type HealthProbeResult = {
  component: "ui" | "api" | "database" | "workers" | "browser" | "voice" | "system_bridge";
  status: "healthy" | "degraded" | "failing";
  latencyMs: number;
  details?: string;
  checkedAt: string;
};

export type WatchdogReport = {
  incidentId: string;
  triggerComponent: string;
  errorDetected: string;
  recoveryActionTaken: string;
  recovered: boolean;
  timestamp: string;
};

// ==========================================
// 10. Critic / Verifier Agent Layer
// ==========================================
export type VerificationOutcome = {
  verified: boolean;
  verdict: "verified" | "partially_verified" | "failed";
  confidence: number;
  critique: string;
  evidence: Array<{ type: string; observation: string; matchesExpectation: boolean }>;
  requiredRepairPlan?: string;
  timestamp: string;
};

// ==========================================
// 13. Knowledge OS — 4 Memory Layers
// ==========================================
export type MemoryLayer = "episodic" | "semantic" | "procedural" | "preference";

export type MemoryItem = {
  id: string;
  layer: MemoryLayer;
  title: string;
  content: string;
  tags: string[];
  importance: number; // 0.0 to 1.0
  confidence: number; // 0.0 to 1.0
  sourceMissionId?: string;
  accessCount: number;
  createdAt: string;
  lastAccessedAt: string;
};

// ==========================================
// 15. Autonomous Research & Evidence Graph
// ==========================================
export type EvidenceClaim = {
  id: string;
  researchId: string;
  claim: string;
  sourceUrl: string;
  sourceTitle: string;
  excerpt: string;
  confidenceScore: number;
  contradictedBy?: string[];
  verified: boolean;
  createdAt: string;
};

// ==========================================
// 19. Event Bus & Workflow Engine 2.0
// ==========================================
export type KernelEvent = {
  id: string;
  topic: string; // e.g. "os.window.focus", "mission.task.failed", "brand.mention.negative"
  source: string;
  payload: Record<string, unknown>;
  timestamp: string;
};

// ==========================================
// 20. Observability & Agent Telemetry Trace
// ==========================================
export type AgentTelemetryTrace = {
  id: string;
  missionId: string;
  stepName: string;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  latencyMs: number;
  toolCallsCount: number;
  errorCount: number;
  status: "success" | "error" | "recovered";
  recordedAt: string;
};
