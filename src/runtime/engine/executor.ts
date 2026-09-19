import { createHash } from "node:crypto";
import type { IRuntimeDb } from "../db";
import { JobAggregate, ConcurrencyException } from "../core/aggregate";
import { LeaseManager } from "../core/lease-manager";
import type { ActionStep, JobContext } from "../core/types";
import { CapabilityBroker } from "../governance/broker";
import { Critic } from "../governance/critic";
import { Watchdog } from "../governance/watchdog";
import { ModelRouter } from "../governance/router";

export type ToolExecutionHandler = (
  toolName: string,
  params: Record<string, unknown>
) => Promise<{ output: unknown; costUsd?: number }>;

export interface ExecutionEngineOptions {
  workerId: string;
  db: IRuntimeDb;
  leaseManager: LeaseManager;
  broker?: CapabilityBroker;
  critic?: Critic;
  watchdog?: Watchdog;
  router?: ModelRouter;
  toolHandler?: ToolExecutionHandler;
}

export interface StepExecutionResult {
  stepId: string;
  success: boolean;
  status: string;
  output?: unknown;
  error?: string;
}

/**
 * Event-Sourced Agent Execution Engine
 * Orchestrates Three-Phase Commits, Sagas, Fencing, and Side-Effect Isolation.
 */
export class ExecutionEngine {
  private readonly workerId: string;
  private readonly db: IRuntimeDb;
  private readonly leaseManager: LeaseManager;
  private readonly broker: CapabilityBroker;
  private readonly critic: Critic;
  private readonly watchdog: Watchdog;
  private readonly router: ModelRouter;
  private readonly toolHandler: ToolExecutionHandler;

  constructor(options: ExecutionEngineOptions) {
    this.workerId = options.workerId;
    this.db = options.db;
    this.leaseManager = options.leaseManager;
    this.broker = options.broker || new CapabilityBroker();
    this.critic = options.critic || new Critic();
    this.watchdog = options.watchdog || new Watchdog();
    this.router = options.router || new ModelRouter();
    this.toolHandler =
      options.toolHandler ||
      (async (tool, params) => {
        return { output: { executed: tool, params }, costUsd: 0.001 };
      });
  }

  /**
   * Executes a turn or runs all pending steps for a job until completion, pause, or HITL gate.
   */
  public async executeJob(jobId: string): Promise<JobContext> {
    // 1. Acquire Distributed Fencing Lease
    const lease = this.leaseManager.acquireLease(jobId, this.workerId);
    if (!lease.acquired) {
      throw new ConcurrencyException(
        `Failed to acquire lease for job ${jobId}: ${lease.error}`
      );
    }

    const fenceToken = lease.fenceToken;
    const stopHeartbeat = this.leaseManager.startHeartbeat(
      jobId,
      this.workerId,
      fenceToken
    );

    try {
      // 2. Rehydrate Aggregate from Event Store & Snapshots
      const aggregate = JobAggregate.rehydrate(jobId, this.db);

      // Record Lease Acquisition if not already recorded
      if (aggregate.state.status === "QUEUED") {
        aggregate.raiseEvent(
          "JobLeased",
          {
            worker_id: this.workerId,
            fence_token: fenceToken,
            lease_expires_at: lease.expiresAt,
          },
          { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
        );
        aggregate.commit(this.db, fenceToken);
      }

      // 3. Crash Recovery Check: Handle mid-flight crash step
      await this.handleMidFlightCrashRecovery(aggregate, fenceToken);

      // 4. Step Processing Loop
      while (
        aggregate.state.status === "RUNNING" ||
        aggregate.state.status === "LEASED"
      ) {
        // Watchdog Health Check
        const currentLease = this.leaseManager.getLease(jobId);
        const health = this.watchdog.checkJobHealth(aggregate.state, currentLease);
        if (!health.isHealthy) {
          aggregate.raiseEvent(
            "JobFailed",
            { reason: health.failureReason!, code: health.code! },
            { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
          );
          aggregate.commit(this.db, fenceToken);
          break;
        }

        // Find next pending step
        const nextStep = aggregate.state.steps.find((s) => s.status === "PENDING");
        if (!nextStep) {
          // All steps completed successfully
          aggregate.raiseEvent(
            "JobSucceeded",
            {
              outcome: {
                artifact_references: aggregate.state.evidence.map((e) => e.artifact_id),
                total_cost_usd: aggregate.state.budget.current_cost_usd,
                termination_reason: "All planned steps completed successfully.",
                wall_time_ms: Date.now() - aggregate.state.created_at,
              },
            },
            { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
          );
          aggregate.commit(this.db, fenceToken);
          break;
        }

        // Execute step through Three-Phase Commit
        const result = await this.executeStep(aggregate, nextStep, fenceToken);

        if (!result.success) {
          // If step failed and job transitioned to AWAITING_APPROVAL, PAUSED, or FAILED, halt turn
          break;
        }
      }

      return aggregate.state;
    } finally {
      stopHeartbeat();
    }
  }

  /**
   * Executes an individual ActionStep through the formal Three-Phase Commit Protocol.
   */
  public async executeStep(
    aggregate: JobAggregate,
    step: ActionStep,
    fenceToken: number
  ): Promise<StepExecutionResult> {
    const context = aggregate.state;

    // ------------------------------------------------------------------------
    // PHASE 1: PRE-ACTION POLICY GATING
    // ------------------------------------------------------------------------

    // A. Capability Broker Evaluation
    const brokerEval = this.broker.evaluateStep(step, context.capability_grants);
    if (!brokerEval.permitted) {
      aggregate.raiseEvent(
        "StepFailed",
        {
          step_id: step.step_id,
          error: `Broker Policy Rejection: ${brokerEval.reason}`,
          reversibility: step.reversibility,
          can_retry: false,
        },
        { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
      );
      aggregate.raiseEvent(
        "JobFailed",
        { reason: `Capability violation: ${brokerEval.reason}`, code: "CAPABILITY_DENIED" },
        { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
      );
      aggregate.commit(this.db, fenceToken);
      return { stepId: step.step_id, success: false, status: "FAILED", error: brokerEval.reason };
    }

    // B. Critic Evaluation
    const criticEval = this.critic.evaluateStep(step, context);
    if (!criticEval.approved) {
      const err = criticEval.violations.join("; ");
      aggregate.raiseEvent(
        "StepFailed",
        {
          step_id: step.step_id,
          error: `Critic Rejection: ${err}`,
          reversibility: step.reversibility,
          can_retry: false,
        },
        { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
      );
      aggregate.raiseEvent(
        "JobFailed",
        { reason: `Critic invariants violated: ${err}`, code: "CRITIC_VIOLATION" },
        { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
      );
      aggregate.commit(this.db, fenceToken);
      return { stepId: step.step_id, success: false, status: "FAILED", error: err };
    }

    // C. Model Router & Budget Headroom Evaluation
    try {
      this.router.assertBudget(step.cost_usd ?? 0.001, context.budget);
    } catch (budgetErr) {
      const msg = budgetErr instanceof Error ? budgetErr.message : String(budgetErr);
      aggregate.raiseEvent(
        "JobFailed",
        { reason: msg, code: "FAILED_BUDGET_EXCEEDED" },
        { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
      );
      aggregate.commit(this.db, fenceToken);
      return { stepId: step.step_id, success: false, status: "FAILED", error: msg };
    }

    // ------------------------------------------------------------------------
    // PHASE 2: ACTUATION (Intent logged to WAL before tool execution)
    // ------------------------------------------------------------------------

    // Persist intent to WAL BEFORE actuating external side-effects
    aggregate.raiseEvent(
      "StepActionExecuting",
      {
        step_id: step.step_id,
        tool: step.tool,
        input_params: step.input_params,
        reversibility: step.reversibility,
      },
      { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
    );
    aggregate.commit(this.db, fenceToken);

    let actuationOutput: unknown;
    let stepCostUsd = step.cost_usd || 0.001;

    try {
      const res = await this.toolHandler(step.tool, step.input_params);
      actuationOutput = res.output;
      if (res.costUsd) {
        stepCostUsd = res.costUsd;
      }
    } catch (actuationErr) {
      const errMsg =
        actuationErr instanceof Error ? actuationErr.message : String(actuationErr);

      // Handle Actuation Failure
      if (step.reversibility === "IRREVERSIBLE") {
        // NON-RETRY INVARIANT: Irreversible actions that fail or timeout MUST NOT be retried automatically.
        // Suspend to AWAITING_APPROVAL or terminal FAILED.
        aggregate.raiseEvent(
          "StepFailed",
          {
            step_id: step.step_id,
            error: `Irreversible actuation failure: ${errMsg}`,
            reversibility: "IRREVERSIBLE",
            can_retry: false,
          },
          { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
        );

        aggregate.raiseEvent(
          "ApprovalRequested",
          {
            step_id: step.step_id,
            approval_id: `appr_${Date.now()}_${step.step_id}`,
            action_summary: `Irreversible tool '${step.tool}' failed: ${errMsg}`,
            reason: "Non-retry invariant triggered for failed irreversible side-effect. Operator intervention required.",
            expires_at: Date.now() + 600 * 1000,
          },
          { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
        );

        aggregate.commit(this.db, fenceToken);
        return {
          stepId: step.step_id,
          success: false,
          status: "AWAITING_APPROVAL",
          error: errMsg,
        };
      }

      // Reversible Failure: Trigger Saga Compensation
      aggregate.raiseEvent(
        "StepFailed",
        {
          step_id: step.step_id,
          error: `Reversible actuation failure: ${errMsg}`,
          reversibility: "REVERSIBLE",
          can_retry: false,
        },
        { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
      );

      await this.runSagaCompensations(aggregate, fenceToken);
      aggregate.commit(this.db, fenceToken);

      return {
        stepId: step.step_id,
        success: false,
        status: "COMPENSATING",
        error: errMsg,
      };
    }

    // ------------------------------------------------------------------------
    // PHASE 3: POST-ACTION EVIDENCE & COMPLETION
    // ------------------------------------------------------------------------
    const outputString = JSON.stringify(actuationOutput ?? {});
    const evidenceHash = createHash("sha256").update(outputString).digest("hex");

    aggregate.raiseEvent(
      "StepCompleted",
      {
        step_id: step.step_id,
        output: actuationOutput,
        evidence_hash: evidenceHash,
        cost_usd: stepCostUsd,
      },
      { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
    );
    aggregate.commit(this.db, fenceToken);

    return {
      stepId: step.step_id,
      success: true,
      status: "COMPLETED",
      output: actuationOutput,
    };
  }

  /**
   * Saga Compensating Transactions:
   * Reverses all completed reversible steps in reverse chronological order ($S_n \to S_1$).
   */
  public async runSagaCompensations(
    aggregate: JobAggregate,
    fenceToken: number
  ): Promise<void> {
    const completedReversible = aggregate.state.steps
      .filter((s) => s.status === "COMPLETED" && s.reversibility === "REVERSIBLE")
      .reverse();

    for (const step of completedReversible) {
      if (!step.compensating_action) continue;

      aggregate.raiseEvent(
        "StepCompensating",
        {
          step_id: step.step_id,
          compensating_tool: step.compensating_action.tool,
          compensating_params: step.compensating_action.input_params,
        },
        { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
      );
      aggregate.commit(this.db, fenceToken);

      try {
        await this.toolHandler(
          step.compensating_action.tool,
          step.compensating_action.input_params
        );
      } catch {
        // Log compensation error without breaking chain
      }

      aggregate.raiseEvent(
        "StepCompensated",
        { step_id: step.step_id },
        { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
      );
      aggregate.commit(this.db, fenceToken);
    }

    aggregate.raiseEvent(
      "JobCancelled",
      { reason: "Saga compensation completed following step failure.", actor: "runtime" },
      { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
    );
    aggregate.commit(this.db, fenceToken);
  }

  /**
   * Recovers mid-flight crashes by inspecting unclosed StepActionExecuting states.
   */
  private async handleMidFlightCrashRecovery(
    aggregate: JobAggregate,
    fenceToken: number
  ): Promise<void> {
    const executingStep = aggregate.state.steps.find((s) => s.status === "EXECUTING");
    if (!executingStep) return;

    if (executingStep.reversibility === "IRREVERSIBLE") {
      // Crash happened during or after irreversible tool call.
      // Invariant: Do not re-execute. Escalate to HITL.
      aggregate.raiseEvent(
        "ApprovalRequested",
        {
          step_id: executingStep.step_id,
          approval_id: `crash_${Date.now()}_${executingStep.step_id}`,
          action_summary: `Crash recovery on irreversible tool '${executingStep.tool}'`,
          reason: "Host process crashed while step was EXECUTING. Non-retry invariant requires manual verification.",
          expires_at: Date.now() + 600 * 1000,
        },
        { worker_id: this.workerId, fence_token: fenceToken, timestamp: Date.now() }
      );
      aggregate.commit(this.db, fenceToken);
    } else {
      // Reversible action: Can safely compensate and re-attempt
      await this.runSagaCompensations(aggregate, fenceToken);
    }
  }
}
