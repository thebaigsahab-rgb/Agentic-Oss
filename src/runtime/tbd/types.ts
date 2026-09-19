/**
 * Teach-by-Demonstration (TBD) Safe Runtime - Data Contracts & Declarative AST
 *
 * Industrial-grade, typed specifications for multimodal user recordings,
 * parameter extraction, multi-anchor targets, human-in-the-loop verification,
 * drift detection, and immutable audit logs.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ActionType =
  | "NAVIGATE"
  | "CLICK"
  | "TYPE"
  | "SELECT"
  | "DRAG_DROP"
  | "FILE_UPLOAD"
  | "WAIT_CONDITION";

export type PreconditionType = "ELEMENT_EXISTS" | "URL_MATCHES" | "FILE_EXISTS";
export type PostconditionType = "VISIBLE_TEXT" | "ELEMENT_REMOVED" | "URL_CHANGED";

export interface VisualAnchor {
  perceptualHash: string; // 64-bit dHash / pHash hex string
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  referenceScreenshotPath: string;
}

export interface ActionTargets {
  ariaSelector?: string;
  cssSelector?: string;
  xpath?: string;
  textFallback?: string;
  visualAnchor: VisualAnchor;
}

export interface ActionPayload {
  parameterKey?: string;
  literalValue?: string | number | boolean;
  masked?: boolean;
}

export interface PreconditionGuard {
  type: PreconditionType;
  expression: string;
}

export interface PostconditionGuard {
  type: PostconditionType;
  expected: string;
}

export interface ActionGuards {
  preconditions: PreconditionGuard[];
  postconditions: PostconditionGuard[];
  timeoutMs: number;
}

export interface ActionGovernance {
  riskLevel: RiskLevel;
  requiresExplicitApproval: boolean;
  rollbackAction?: ActionNode;
}

export interface ActionNode {
  stepId: string;
  actionType: ActionType;
  targets: ActionTargets;
  payload?: ActionPayload;
  guards: ActionGuards;
  governance: ActionGovernance;
}

// ----------------------------------------------------------------------------
// Multimodal Demonstration Raw Ingestion Interfaces
// ----------------------------------------------------------------------------

export interface RawMouseInteraction {
  type: "mousedown" | "mouseup" | "click" | "dblclick" | "contextmenu";
  x: number;
  y: number;
  button: "left" | "middle" | "right";
  durationMs?: number;
}

export interface RawKeyboardInteraction {
  key: string;
  code: string;
  modifiers: {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
  };
  value?: string;
  isPassword?: boolean;
}

export interface RawDomMetadata {
  tagName: string;
  cssSelector: string;
  xpath: string;
  ariaRole?: string;
  ariaName?: string;
  ariaDescription?: string;
  innerText?: string;
  formField?: {
    name?: string;
    type?: string;
    inputMode?: string;
    autocomplete?: string;
  };
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface RawVisualSnapshot {
  viewport: { width: number; height: number; dpiScale: number };
  screenshotBuffer?: Buffer | Uint8Array;
  screenshotBase64?: string;
  referencePath?: string;
  perceptualHash: string;
}

export interface RawDemonstrationEvent {
  eventId: string;
  timestamp: number;
  timeSinceLastEventMs: number; // For hesitation detection
  category: "INPUT" | "NAVIGATION" | "FORK" | "MODAL";
  mouse?: RawMouseInteraction;
  keyboard?: RawKeyboardInteraction;
  targetDom?: RawDomMetadata;
  visual?: RawVisualSnapshot;
  navigationUrl?: string;
  modalState?: {
    detected: boolean;
    modalTitle?: string;
    isDismissal?: boolean;
  };
  sanitized: boolean;
}

export interface RawRecordingSession {
  sessionId: string;
  name: string;
  targetEnvironment: {
    userAgent: string;
    platform: string;
    screenResolution: { width: number; height: number };
  };
  events: RawDemonstrationEvent[];
  startedAt: number;
  endedAt: number;
}

// ----------------------------------------------------------------------------
// Parameter Extraction & Manifest
// ----------------------------------------------------------------------------

export type ParameterType = "string" | "number" | "boolean";

export interface ParameterDefinition {
  name: string;
  type: ParameterType;
  description: string;
  defaultValue?: string | number | boolean;
  required: boolean;
  validationRegex?: string;
  enumValues?: Array<string | number>;
}

export interface SkillParameters {
  $schema?: string;
  title: string;
  type: "object";
  properties: Record<string, ParameterDefinition>;
  required: string[];
}

// ----------------------------------------------------------------------------
// Human-in-the-Loop (HITL) Verification & Skill Lifecycle
// ----------------------------------------------------------------------------

export type DraftStatus = "PENDING_REVIEW" | "VERIFIED" | "REJECTED";

export interface SkillDraft {
  draftId: string;
  name: string;
  description: string;
  suggestedVersion: string;
  parameters: SkillParameters;
  nodes: ActionNode[];
  rawSessionId: string;
  status: DraftStatus;
  createdAt: number;
  analysisNotes: string[];
}

export interface HumanReviewDecision {
  operatorId: string;
  decision: "APPROVE" | "REJECT";
  reviewNotes: string;
  confirmedParameters: SkillParameters;
  nodeOverrides?: Array<{
    stepId: string;
    riskLevel?: RiskLevel;
    requiresExplicitApproval?: boolean;
    rollbackAction?: ActionNode;
  }>;
}

export interface SkillVerificationRecord {
  verifiedBy: string;
  verifiedAt: number;
  hmacSignature: string;
  reviewNotes: string;
}

export interface SkillTestFixture {
  domFixtures: Record<string, string>; // stepId or stateKey -> HTML mock
  baselineVisuals: Record<string, { perceptualHash: string; base64?: string }>;
  mockEnvironment: Record<string, string>;
  testPayloads: Array<Record<string, unknown>>;
}

export type SkillStatus = "ACTIVE" | "TOMBSTONED";

export interface CompiledSkill {
  skillId: string;
  name: string;
  version: string; // SemVer MAJOR.MINOR.PATCH
  contentHash: string; // SHA-256 of canonical AST + params
  ast: ActionNode[];
  parameters: SkillParameters;
  verification: SkillVerificationRecord;
  status: SkillStatus;
  testFixture: SkillTestFixture;
  createdAt: number;
  updatedAt: number;
}

// ----------------------------------------------------------------------------
// Drift Detection & Multi-Anchor Grounding
// ----------------------------------------------------------------------------

export interface TargetGroundingCandidate {
  elementId: string;
  domSelector: string;
  xpath: string;
  ariaRole?: string;
  ariaName?: string;
  perceptualHash: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  visibleText?: string;
}

export interface AnchorWeights {
  wAria: number; // default 0.40
  wDom: number; // default 0.35
  wVisual: number; // default 0.25
}

export interface ElementMatchScore {
  candidate: TargetGroundingCandidate;
  totalScore: number;
  ariaScore: number;
  domScore: number;
  visualScore: number;
}

export interface DriftEvaluationResult {
  matched: boolean;
  bestCandidate?: TargetGroundingCandidate;
  topScore: number;
  competingScoreDelta: number;
  ambiguous: boolean;
  driftDetected: boolean;
  details: string;
  candidatesScored: ElementMatchScore[];
}

// ----------------------------------------------------------------------------
// Execution & Dry-Run Simulation
// ----------------------------------------------------------------------------

export interface ProjectedStepSummary {
  stepId: string;
  actionType: ActionType;
  targetSummary: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  estimatedDurationMs: number;
  hasRollback: boolean;
  resolvedParameters: Record<string, unknown>;
}

export interface PreconditionCheckResult {
  stepId: string;
  guard: PreconditionGuard;
  satisfied: boolean;
  diagnostic?: string;
}

export interface ExecutionPlanManifest {
  manifestId: string;
  skillId: string;
  skillVersion: string;
  dryRun: boolean;
  generatedAt: number;
  projectedSteps: ProjectedStepSummary[];
  preconditionChecks: PreconditionCheckResult[];
  projectedSideEffects: string[];
  requiredApprovalGates: string[]; // stepIds
  estimatedTotalDurationMs: number;
  canExecuteLive: boolean;
  blockers: string[];
}

export type ExecutionState =
  | "IDLE"
  | "DRY_RUNNING"
  | "PENDING_APPROVAL"
  | "RUNNING"
  | "PAUSED"
  | "COMPENSATING"
  | "COMPLETED"
  | "FAILED"
  | "FAILED_COMPENSATED"
  | "ABORTED_DRIFT"
  | "CANCELLED"
  | "REVOKED";

export interface StepExecutionRecord {
  stepId: string;
  actionType: ActionType;
  status: "SUCCESS" | "FAILED" | "SKIPPED" | "COMPENSATED";
  driftScore?: number;
  durationMs: number;
  output?: unknown;
  error?: string;
  compensated: boolean;
}

// ----------------------------------------------------------------------------
// Audit Trail & Proposal Types
// ----------------------------------------------------------------------------

export interface AuditLogEntry {
  sequenceNum: number;
  timestamp: number;
  eventType:
    | "DEMONSTRATION_RECORDED"
    | "SKILL_DRAFT_CREATED"
    | "SKILL_VERIFIED"
    | "SKILL_REVOKED"
    | "DRY_RUN_SIMULATION"
    | "EXECUTION_STARTED"
    | "APPROVAL_REQUESTED"
    | "APPROVAL_GRANTED"
    | "APPROVAL_REJECTED"
    | "UI_DRIFT_DETECTED"
    | "STEP_EXECUTED"
    | "ROLLBACK_TRIGGERED"
    | "EXECUTION_COMPLETED"
    | "EXECUTION_FAILED"
    | "UNAUTHORIZED_MODIFICATION_BLOCKED"
    | "PATCH_PROPOSED";
  skillId?: string;
  stepId?: string;
  actor: string;
  payload: Record<string, unknown>;
  previousHash: string;
  entryHash: string; // SHA-256(prevHash + timestamp + eventType + json(payload) + actor)
}

export interface ProposedSkillPatch {
  proposalId: string;
  skillId: string;
  baseVersion: string;
  proposedVersion: string;
  rationale: string;
  targetStepId: string;
  proposedPatch: Partial<ActionNode>;
  telemetryEvidence: {
    failureCount: number;
    degradedSelectorScores: number[];
    avgLatencyMs: number;
  };
  isMerged: false;
  stagedAt: number;
}
