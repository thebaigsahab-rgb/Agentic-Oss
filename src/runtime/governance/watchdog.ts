import type { IRuntimeDb } from "../db";
import type { JobContext, WorkerLeaseRecord } from "../core/types";

export interface WatchdogHealthReport {
  isHealthy: boolean;
  failureReason?: string;
  code?: "WALL_TIME_EXCEEDED" | "TOOL_CALLS_EXCEEDED" | "LEASE_EXPIRED" | "STEP_TIMEOUT";
}

/**
 * Watchdog & Deadlock Supervisor
 * Enforces wall-clock deadlines, tool call caps, and flags zombie worker leases.
 */
export class Watchdog {
  public static readonly DEFAULT_STEP_TIMEOUT_MS = 60 * 1000; // 60 seconds

  /**
   * Evaluates aggregate health against hard budget invariants and active lease validity.
   */
  public checkJobHealth(
    job: JobContext,
    lease?: WorkerLeaseRecord,
    stepTimeoutMs = Watchdog.DEFAULT_STEP_TIMEOUT_MS
  ): WatchdogHealthReport {
    const now = Date.now();

    // 1. Wall-Clock Budget Invariant
    const maxWallTimeMs = job.budget.max_wall_time_sec * 1000;
    const elapsedWallTimeMs = now - job.created_at;
    if (elapsedWallTimeMs > maxWallTimeMs) {
      return {
        isHealthy: false,
        failureReason: `Job exceeded maximum allowed wall-clock execution time (${job.budget.max_wall_time_sec}s).`,
        code: "WALL_TIME_EXCEEDED",
      };
    }

    // 2. Tool Call Count Budget Invariant
    if (job.budget.tool_call_count > job.budget.max_tool_calls) {
      return {
        isHealthy: false,
        failureReason: `Job exceeded maximum allowed tool call budget (${job.budget.max_tool_calls} calls).`,
        code: "TOOL_CALLS_EXCEEDED",
      };
    }

    // 3. Worker Lease Expiration Invariant (if currently executing)
    if (lease && (job.status === "RUNNING" || job.status === "LEASED")) {
      if (lease.lease_expires_at < now) {
        return {
          isHealthy: false,
          failureReason: `Worker lease expired at ${new Date(lease.lease_expires_at).toISOString()}. Worker marked as zombie.`,
          code: "LEASE_EXPIRED",
        };
      }
    }

    // 4. Stalled Execution Step Invariant
    const activeStep = job.steps.find((s) => s.status === "EXECUTING");
    if (activeStep && now - job.updated_at > stepTimeoutMs) {
      return {
        isHealthy: false,
        failureReason: `Step '${activeStep.step_id}' has been executing for > ${stepTimeoutMs / 1000}s without heartbeat.`,
        code: "STEP_TIMEOUT",
      };
    }

    return { isHealthy: true };
  }

  /**
   * Sweeps SQLite for expired worker leases holding active jobs.
   * Returns list of orphaned job_ids eligible for lease re-acquisition.
   */
  public sweepZombieWorkers(db: IRuntimeDb): string[] {
    const now = Date.now();
    const rows = db
      .prepare<{ job_id: string }>(
        "SELECT job_id FROM worker_leases WHERE lease_expires_at < ?"
      )
      .all(now);

    return rows.map((r) => r.job_id);
  }
}
