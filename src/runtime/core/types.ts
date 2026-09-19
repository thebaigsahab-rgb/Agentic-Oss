/**
 * Industrial-Grade Event-Sourced Agent Execution Runtime
 * Core Domain Types, FSM States, Events, and Protocols
 */

export type FsmStatus =
  | "QUEUED"
  | "LEASED"
  | "RUNNING"
  | "AWAITING_APPROVAL"
  | "PAUSED"
  | "COMPENSATING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type CapabilityScope =
  | "net:fetch"
  | "fs:write"
  | "fs:read"
  | "shell:execute"
  | "llm:call";

export type ActionReversibility = "REVERSIBLE" | "IRREVERSIBLE";

export type StepExecutionStatus =
  | "PENDING"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "COMPENSATING"
  | "COMPENSATED";

export interface ActionStep {
  step_id: string;
  title: string;
  tool: string;
  reversibility: ActionReversibility;
  input_params: Record<string, unknown>;
  status: StepExecutionStatus;
  compensating_action?: {
    tool: string;
    input_params: Record<string, unknown>;
  };
  retry_count: number;
  max_retries: number;
  output?: unknown;
  error?: string;
  cost_usd?: number;
}

export interface BudgetEnvelope {
  max_cost_usd: number;
  current_cost_usd: number;
  max_wall_time_sec: number;
  max_tool_calls: number;
  tool_call_count: number;
}

export interface StepEvidence {
  artifact_id: string;
  type: string;
  hash: string; // SHA-256
  data: unknown;
  timestamp: number;
}

export interface JobCheckpoint {
  last_verified_step_id?: string;
  sequence_num: number;
  current_fsm_state: FsmStatus;
}

export interface FinalOutcome {
  artifact_references: string[];
  total_cost_usd: number;
  termination_reason: string;
  wall_time_ms: number;
}

export interface JobContext {
  job_id: string;
  goal: string;
  owner: string;
  capability_grants: CapabilityScope[];
  plan: {
    subtasks: ActionStep[];
    dependency_edges: [string, string][];
  };
  steps: ActionStep[];
  evidence: StepEvidence[];
  budget: BudgetEnvelope;
  checkpoint: JobCheckpoint;
  status: FsmStatus;
  final_outcome?: FinalOutcome;
  created_at: number;
  updated_at: number;
}

// ============================================================================
// Domain Event Definitions
// ============================================================================

export type DomainEventType =
  | "JobCreated"
  | "JobLeased"
  | "PlanProposed"
  | "StepProposed"
  | "StepActionExecuting"
  | "StepCompleted"
  | "StepFailed"
  | "StepCompensating"
  | "StepCompensated"
  | "ApprovalRequested"
  | "ApprovalResolved"
  | "JobPaused"
  | "JobResumed"
  | "JobCancelled"
  | "JobSucceeded"
  | "JobFailed";

export interface EventMetadata {
  worker_id?: string;
  fence_token?: number;
  actor?: string;
  timestamp: number;
}

export interface DomainEvent<T = Record<string, unknown>> {
  event_id: string;
  job_id: string;
  event_type: DomainEventType;
  sequence_num: number;
  payload: T;
  metadata: EventMetadata;
  created_at: number;
}

export interface JobSnapshotRecord {
  snapshot_id: string;
  job_id: string;
  last_sequence_num: number;
  state_blob: string;
  checksum: string;
  created_at: number;
}

export interface WorkerLeaseRecord {
  job_id: string;
  worker_id: string;
  fence_token: number;
  lease_expires_at: number;
  updated_at: number;
}

export interface IdempotencyRecord {
  idempotency_key: string;
  scope: string;
  job_id: string;
  created_at: number;
}

// Payload Interfaces for Specific Events
export interface JobCreatedPayload {
  goal: string;
  owner: string;
  capability_grants: CapabilityScope[];
  budget?: Partial<BudgetEnvelope>;
}

export interface JobLeasedPayload {
  worker_id: string;
  fence_token: number;
  lease_expires_at: number;
}

export interface PlanProposedPayload {
  subtasks: ActionStep[];
  dependency_edges: [string, string][];
}

export interface StepActionExecutingPayload {
  step_id: string;
  tool: string;
  input_params: Record<string, unknown>;
  reversibility: ActionReversibility;
}

export interface StepCompletedPayload {
  step_id: string;
  output: unknown;
  evidence_hash: string;
  cost_usd: number;
}

export interface StepFailedPayload {
  step_id: string;
  error: string;
  reversibility: ActionReversibility;
  can_retry: boolean;
}

export interface StepCompensatingPayload {
  step_id: string;
  compensating_tool: string;
  compensating_params: Record<string, unknown>;
}

export interface StepCompensatedPayload {
  step_id: string;
  output?: unknown;
}

export interface ApprovalRequestedPayload {
  step_id: string;
  approval_id: string;
  action_summary: string;
  reason: string;
  expires_at: number;
}

export interface ApprovalResolvedPayload {
  approval_id: string;
  decision: "APPROVED" | "REJECTED";
  actor: string;
  signature?: string;
}

export interface JobLifecyclePayload {
  reason?: string;
  actor: string;
}

export interface JobSucceededPayload {
  outcome: FinalOutcome;
}

export interface JobFailedPayload {
  reason: string;
  code: string;
  total_cost_usd?: number;
}
