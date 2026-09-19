/**
 * Teach-by-Demonstration (TBD) Safe Execution Engine
 *
 * Implements stateful AST runner supporting mandatory dry-run simulation,
 * multi-anchor drift halting, anti-guessing safeguards, parameter injection defense,
 * postcondition rollback compensation, and the interactive control plane.
 */

import { randomUUID } from "node:crypto";
import { DriftDetector, UiDriftError, AmbiguousTargetError } from "./drift";
import { AuditLogger } from "./audit";
import type {
  CompiledSkill,
  ActionNode,
  ExecutionPlanManifest,
  ProjectedStepSummary,
  PreconditionCheckResult,
  ExecutionState,
  StepExecutionRecord,
  TargetGroundingCandidate,
  RiskLevel,
} from "./types";

export interface TargetEnvironmentAdapter {
  getCurrentUrl(): string;
  getCurrentElements(): TargetGroundingCandidate[];
  checkElementExists(selector: string): boolean;
  checkFileExists(path: string): boolean;
  getVisibleText(): string;
  navigate(url: string): Promise<void>;
  click(element: TargetGroundingCandidate): Promise<void>;
  type(element: TargetGroundingCandidate, text: string, masked?: boolean): Promise<void>;
  select(element: TargetGroundingCandidate, value: string): Promise<void>;
  waitForCondition(condition: string, timeoutMs: number): Promise<boolean>;
  captureState(): { url: string; domHtml: string; screenshotBuffer?: Buffer };
}

export class ExecutionBlockedError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(`[EXECUTION_BLOCKED:${code}] ${message}`);
    this.name = "ExecutionBlockedError";
    this.code = code;
  }
}

export class PostconditionFailureError extends Error {
  public readonly code = "POSTCONDITION_FAILED";
  public readonly stepId: string;
  constructor(stepId: string, message: string) {
    super(`[POSTCONDITION_FAILED] Step ${stepId}: ${message}`);
    this.name = "PostconditionFailureError";
    this.stepId = stepId;
  }
}

export class SkillExecutor {
  private skill: CompiledSkill;
  private adapter: TargetEnvironmentAdapter;
  private driftDetector: DriftDetector;
  private auditLogger: AuditLogger;
  private executionId: string;
  private state: ExecutionState = "IDLE";
  private currentStepIndex: number = 0;
  private approvedStepIds: Set<string> = new Set();
  private stepRecords: StepExecutionRecord[] = [];
  private executedNodesForRollback: ActionNode[] = [];
  private isPaused: boolean = false;
  private isCancelled: boolean = false;

  constructor(params: {
    skill: CompiledSkill;
    adapter: TargetEnvironmentAdapter;
    auditLogger: AuditLogger;
    driftDetector?: DriftDetector;
  }) {
    this.skill = params.skill;
    this.adapter = params.adapter;
    this.auditLogger = params.auditLogger;
    this.driftDetector = params.driftDetector || new DriftDetector();
    this.executionId = `exec_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }

  public getExecutionId(): string {
    return this.executionId;
  }

  public getState(): ExecutionState {
    return this.state;
  }

  public getStepRecords(): ReadonlyArray<StepExecutionRecord> {
    return this.stepRecords;
  }

  // --------------------------------------------------------------------------
  // Dry-Run Simulation Mode (Simulate-Before-Actuate)
  // --------------------------------------------------------------------------

  /**
   * Performs a mandatory dry-run simulation of the skill AST without mutating state.
   * Inspects entire DAG, verifies preconditions, checks targets, and generates manifest.
   */
  public async simulateDryRun(
    runtimeParameters: Record<string, unknown> = {}
  ): Promise<ExecutionPlanManifest> {
    this.assertSkillActive();
    this.state = "DRY_RUNNING";

    this.auditLogger.append({
      eventType: "DRY_RUN_SIMULATION",
      actor: "system:dry-runner",
      skillId: this.skill.skillId,
      payload: { executionId: this.executionId, runtimeParameters },
    });

    const projectedSteps: ProjectedStepSummary[] = [];
    const preconditionChecks: PreconditionCheckResult[] = [];
    const projectedSideEffects: string[] = [];
    const requiredApprovalGates: string[] = [];
    const blockers: string[] = [];
    let totalEstimatedDurationMs = 0;

    for (const node of this.skill.ast) {
      // 1. Resolve payload parameter
      const resolvedValue = this.resolvePayloadValue(node, runtimeParameters);
      const targetSummary = node.targets.ariaSelector || node.targets.cssSelector || node.targets.textFallback || "Target Node";

      // 2. Preconditions evaluation without mutating
      for (const guard of node.guards.preconditions) {
        const satisfied = this.evaluatePrecondition(guard);
        preconditionChecks.push({
          stepId: node.stepId,
          guard,
          satisfied,
          diagnostic: satisfied ? undefined : `Precondition failed: ${guard.type} (${guard.expression})`,
        });
        if (!satisfied) {
          blockers.push(`Step ${node.stepId}: Precondition ${guard.type} failed`);
        }
      }

      // 3. Side effects projection
      if (node.governance.riskLevel === "CRITICAL" || node.governance.riskLevel === "HIGH") {
        projectedSideEffects.push(`[${node.governance.riskLevel}] ${node.actionType} on "${targetSummary}"`);
      }

      // 4. Approval requirements
      if (node.governance.requiresExplicitApproval) {
        requiredApprovalGates.push(node.stepId);
      }

      const stepDuration = node.guards.timeoutMs || 2000;
      totalEstimatedDurationMs += stepDuration;

      projectedSteps.push({
        stepId: node.stepId,
        actionType: node.actionType,
        targetSummary,
        riskLevel: node.governance.riskLevel,
        requiresApproval: node.governance.requiresExplicitApproval,
        estimatedDurationMs: stepDuration,
        hasRollback: Boolean(node.governance.rollbackAction),
        resolvedParameters: resolvedValue !== undefined ? { [node.payload?.parameterKey || "value"]: resolvedValue } : {},
      });
    }

    const canExecuteLive = blockers.length === 0;
    this.state = "IDLE";

    return {
      manifestId: `manifest_${randomUUID().slice(0, 8)}`,
      skillId: this.skill.skillId,
      skillVersion: this.skill.version,
      dryRun: true,
      generatedAt: Date.now(),
      projectedSteps,
      preconditionChecks,
      projectedSideEffects,
      requiredApprovalGates,
      estimatedTotalDurationMs: totalEstimatedDurationMs,
      canExecuteLive,
      blockers,
    };
  }

  // --------------------------------------------------------------------------
  // Live Actuation Mode
  // --------------------------------------------------------------------------

  /**
   * Executes the skill against the target environment.
   * Enforces zero guessing on drift, approval gates, postcondition rollback, and audit logging.
   */
  public async executeLive(
    runtimeParameters: Record<string, unknown> = {},
    actor: string = "operator"
  ): Promise<{ success: boolean; state: ExecutionState; records: StepExecutionRecord[] }> {
    this.assertSkillActive();
    this.state = "RUNNING";

    this.auditLogger.append({
      eventType: "EXECUTION_STARTED",
      actor,
      skillId: this.skill.skillId,
      payload: { executionId: this.executionId, parameters: runtimeParameters },
    });

    try {
      for (let i = this.currentStepIndex; i < this.skill.ast.length; i++) {
        this.currentStepIndex = i;
        const node = this.skill.ast[i];

        // 1. Control Plane Check: Cancelled?
        if (this.isCancelled) {
          this.state = "CANCELLED";
          await this.executeRollbackSequence("Workflow cancelled by operator.");
          return { success: false, state: "CANCELLED", records: this.stepRecords };
        }

        // 2. Control Plane Check: Paused?
        if (this.isPaused) {
          this.state = "PAUSED";
          return { success: false, state: "PAUSED", records: this.stepRecords };
        }

        // 3. Precondition verification
        for (const guard of node.guards.preconditions) {
          const satisfied = this.evaluatePrecondition(guard);
          if (!satisfied) {
            throw new ExecutionBlockedError(
              "PRECONDITION_UNMET",
              `Precondition ${guard.type} (${guard.expression}) failed for step ${node.stepId}`
            );
          }
        }

        // 4. Governance & Approval Gate
        if (node.governance.requiresExplicitApproval && !this.approvedStepIds.has(node.stepId)) {
          this.state = "PENDING_APPROVAL";
          this.auditLogger.append({
            eventType: "APPROVAL_REQUESTED",
            actor,
            skillId: this.skill.skillId,
            stepId: node.stepId,
            payload: { riskLevel: node.governance.riskLevel, actionType: node.actionType },
          });
          return { success: false, state: "PENDING_APPROVAL", records: this.stepRecords };
        }

        // 5. Grounding with Anti-Guessing Drift Detection
        let targetElement: TargetGroundingCandidate | undefined;
        let driftScore = 1.0;

        if (node.actionType !== "NAVIGATE" && node.actionType !== "WAIT_CONDITION") {
          const activeCandidates = this.adapter.getCurrentElements();
          try {
            targetElement = this.driftDetector.resolveOrHalt(node.targets, activeCandidates, node.stepId);
            driftScore = this.driftDetector.evaluateTarget(node.targets, activeCandidates).topScore;
          } catch (err) {
            if (err instanceof UiDriftError || err instanceof AmbiguousTargetError) {
              this.state = "ABORTED_DRIFT";
              this.auditLogger.append({
                eventType: "UI_DRIFT_DETECTED",
                actor: "system:drift-detector",
                skillId: this.skill.skillId,
                stepId: node.stepId,
                payload: {
                  code: err.code,
                  details: err.message,
                  evaluation: err.evaluation,
                  capturedState: this.adapter.captureState(),
                },
              });
              // Zero clicks performed; halt execution immediately
              return { success: false, state: "ABORTED_DRIFT", records: this.stepRecords };
            }
            throw err;
          }
        }

        // 6. Actuate Step with Parameter Injection Defense
        const startTime = Date.now();
        const resolvedValue = this.resolvePayloadValue(node, runtimeParameters);

        await this.actuateNode(node, targetElement, resolvedValue);
        const durationMs = Date.now() - startTime;

        // 7. Postcondition Verification
        const postconditionPassed = await this.verifyPostconditions(node, resolvedValue);
        if (!postconditionPassed) {
          // Postcondition failure triggers rollback compensation
          const stepRecord: StepExecutionRecord = {
            stepId: node.stepId,
            actionType: node.actionType,
            status: "FAILED",
            driftScore,
            durationMs,
            error: "Postcondition failed to satisfy expected condition within timeout.",
            compensated: false,
          };
          this.stepRecords.push(stepRecord);

          this.state = "COMPENSATING";
          await this.executeRollbackSequence(`Postcondition failed on step ${node.stepId}`);
          this.state = "FAILED_COMPENSATED";
          return { success: false, state: "FAILED_COMPENSATED", records: this.stepRecords };
        }

        // Record successful step
        this.stepRecords.push({
          stepId: node.stepId,
          actionType: node.actionType,
          status: "SUCCESS",
          driftScore,
          durationMs,
          compensated: false,
        });

        this.auditLogger.append({
          eventType: "STEP_EXECUTED",
          actor,
          skillId: this.skill.skillId,
          stepId: node.stepId,
          payload: { actionType: node.actionType, durationMs, driftScore },
        });

        // Stage for rollback if necessary later
        if (node.governance.rollbackAction) {
          this.executedNodesForRollback.push(node);
        }
      }

      this.state = "COMPLETED";
      this.auditLogger.append({
        eventType: "EXECUTION_COMPLETED",
        actor,
        skillId: this.skill.skillId,
        payload: { executionId: this.executionId, totalSteps: this.stepRecords.length },
      });

      return { success: true, state: "COMPLETED", records: this.stepRecords };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.state = "FAILED";
      this.auditLogger.append({
        eventType: "EXECUTION_FAILED",
        actor,
        skillId: this.skill.skillId,
        payload: { executionId: this.executionId, error: errorMsg },
      });
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Operator Control Plane Commands (APPROVE, PAUSE, RESUME, CANCEL, REVOKE)
  // --------------------------------------------------------------------------

  public approve(stepId: string, actor: string = "operator"): void {
    this.approvedStepIds.add(stepId);
    this.auditLogger.append({
      eventType: "APPROVAL_GRANTED",
      actor,
      skillId: this.skill.skillId,
      stepId,
      payload: { stepId },
    });
  }

  public pause(actor: string = "operator"): void {
    this.isPaused = true;
    this.state = "PAUSED";
    this.auditLogger.append({
      eventType: "APPROVAL_REQUESTED", // Pause event
      actor,
      skillId: this.skill.skillId,
      payload: { action: "PAUSE" },
    });
  }

  public resume(): void {
    this.isPaused = false;
    this.state = "RUNNING";
  }

  public async cancel(actor: string = "operator"): Promise<void> {
    this.isCancelled = true;
    this.state = "CANCELLED";
    await this.executeRollbackSequence("Operator invoked CANCEL command.");
  }

  public revoke(actor: string = "operator"): void {
    this.skill.status = "TOMBSTONED";
    this.isCancelled = true;
    this.state = "REVOKED";
    this.auditLogger.append({
      eventType: "SKILL_REVOKED",
      actor,
      skillId: this.skill.skillId,
      payload: { reason: "Operator invoked REVOKE command." },
    });
  }

  // --------------------------------------------------------------------------
  // Compensating Rollback Engine
  // --------------------------------------------------------------------------

  private async executeRollbackSequence(reason: string): Promise<void> {
    this.auditLogger.append({
      eventType: "ROLLBACK_TRIGGERED",
      actor: "system:compensation-engine",
      skillId: this.skill.skillId,
      payload: { reason, nodesToCompensate: this.executedNodesForRollback.length },
    });

    // Compensate in reverse execution order (LIFO)
    while (this.executedNodesForRollback.length > 0) {
      const node = this.executedNodesForRollback.pop()!;
      const rollbackNode = node.governance.rollbackAction;
      if (!rollbackNode) continue;

      try {
        const activeCandidates = this.adapter.getCurrentElements();
        let targetElement: TargetGroundingCandidate | undefined;
        if (rollbackNode.actionType !== "NAVIGATE" && rollbackNode.actionType !== "WAIT_CONDITION") {
          targetElement = this.driftDetector.resolveOrHalt(rollbackNode.targets, activeCandidates, rollbackNode.stepId);
        }
        await this.actuateNode(rollbackNode, targetElement, rollbackNode.payload?.literalValue);
      } catch (rollbackErr) {
        // Log compensation error without breaking chain
        this.auditLogger.append({
          eventType: "EXECUTION_FAILED",
          actor: "system:compensation-engine",
          skillId: this.skill.skillId,
          stepId: rollbackNode.stepId,
          payload: { error: String(rollbackErr) },
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Internal Actuation & Guard Helpers
  // --------------------------------------------------------------------------

  private assertSkillActive(): void {
    if (this.skill.status === "TOMBSTONED") {
      throw new ExecutionBlockedError("SKILL_REVOKED", `Skill ${this.skill.skillId} is TOMBSTONED and cannot be executed.`);
    }
  }

  private resolvePayloadValue(
    node: ActionNode,
    runtimeParameters: Record<string, unknown>
  ): string | number | boolean | undefined {
    if (node.payload?.parameterKey) {
      const runtimeVal = runtimeParameters[node.payload.parameterKey];
      if (runtimeVal !== undefined) {
        // Defensive Type Assertion: Parameters are treated strictly as literals, NEVER code
        return typeof runtimeVal === "object" ? JSON.stringify(runtimeVal) : (runtimeVal as string | number | boolean);
      }
    }
    return node.payload?.literalValue;
  }

  private evaluatePrecondition(guard: ActionNode["guards"]["preconditions"][0]): boolean {
    switch (guard.type) {
      case "ELEMENT_EXISTS":
        return this.adapter.checkElementExists(guard.expression);
      case "URL_MATCHES":
        return this.adapter.getCurrentUrl().includes(guard.expression);
      case "FILE_EXISTS":
        return this.adapter.checkFileExists(guard.expression);
      default:
        return false;
    }
  }

  private async verifyPostconditions(node: ActionNode, resolvedValue?: unknown): Promise<boolean> {
    if (!node.guards.postconditions || node.guards.postconditions.length === 0) {
      return true;
    }

    for (const post of node.guards.postconditions) {
      switch (post.type) {
        case "VISIBLE_TEXT": {
          const expected = (node.payload?.parameterKey && resolvedValue !== undefined)
            ? String(resolvedValue)
            : post.expected;
          const text = this.adapter.getVisibleText();
          if (!text.includes(expected)) return false;
          break;
        }
        case "ELEMENT_REMOVED": {
          const exists = this.adapter.checkElementExists(post.expected);
          if (exists) return false;
          break;
        }
        case "URL_CHANGED": {
          const url = this.adapter.getCurrentUrl();
          if (!url.includes(post.expected)) return false;
          break;
        }
      }
    }

    return true;
  }

  private async actuateNode(
    node: ActionNode,
    target: TargetGroundingCandidate | undefined,
    resolvedValue: string | number | boolean | undefined
  ): Promise<void> {
    // INVARIANT: All actions are declarative primitives. ZERO eval(), ZERO bash scripts.
    switch (node.actionType) {
      case "NAVIGATE":
        await this.adapter.navigate(String(resolvedValue || ""));
        break;
      case "CLICK":
        if (!target) throw new Error(`Click action requires resolved element target for step ${node.stepId}`);
        await this.adapter.click(target);
        break;
      case "TYPE":
        if (!target) throw new Error(`Type action requires resolved element target for step ${node.stepId}`);
        await this.adapter.type(target, String(resolvedValue ?? ""), node.payload?.masked);
        break;
      case "SELECT":
        if (!target) throw new Error(`Select action requires resolved element target for step ${node.stepId}`);
        await this.adapter.select(target, String(resolvedValue ?? ""));
        break;
      case "WAIT_CONDITION":
        await this.adapter.waitForCondition(String(resolvedValue ?? ""), node.guards.timeoutMs || 5000);
        break;
      default:
        throw new Error(`Unsupported declarative action type: ${(node as ActionNode).actionType}`);
    }
  }
}
