import type { IRuntimeDb } from "../db";
import type { WorkerLeaseRecord } from "./types";

export interface LeaseAcquisitionResult {
  acquired: boolean;
  fenceToken: number;
  expiresAt: number;
  error?: string;
}

/**
 * Distributed Fencing & Lease Manager
 * Implements strict mutual exclusion and prevents split-brain zombie workers via monotonic fence tokens.
 */
export class LeaseManager {
  public static readonly DEFAULT_LEASE_DURATION_MS = 30 * 1000; // 30 seconds
  public static readonly DEFAULT_HEARTBEAT_INTERVAL_MS = 15 * 1000; // 15 seconds

  constructor(private readonly db: IRuntimeDb) {}

  /**
   * Atomically acquires or extends a worker lease for a job.
   * Increments the monotonic fence_token on every new worker acquisition.
   */
  public acquireLease(
    jobId: string,
    workerId: string,
    leaseDurationMs = LeaseManager.DEFAULT_LEASE_DURATION_MS
  ): LeaseAcquisitionResult {
    const now = Date.now();
    const newExpiresAt = now + leaseDurationMs;

    return this.db.transaction(() => {
      // 1. Inspect current lease row
      const currentLease = this.db
        .prepare<WorkerLeaseRecord>("SELECT * FROM worker_leases WHERE job_id = ?")
        .get(jobId);

      if (!currentLease) {
        // First lease registration
        const initialFence = 1;
        this.db
          .prepare(
            `INSERT INTO worker_leases (job_id, worker_id, fence_token, lease_expires_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(jobId, workerId, initialFence, newExpiresAt, now);

        return {
          acquired: true,
          fenceToken: initialFence,
          expiresAt: newExpiresAt,
        };
      }

      // Check if existing lease is owned by this worker (re-acquisition/extension)
      if (currentLease.worker_id === workerId) {
        // Keep existing fence token for same worker
        this.db
          .prepare(
            `UPDATE worker_leases 
             SET lease_expires_at = ?, updated_at = ?
             WHERE job_id = ? AND worker_id = ?`
          )
          .run(newExpiresAt, now, jobId, workerId);

        return {
          acquired: true,
          fenceToken: currentLease.fence_token,
          expiresAt: newExpiresAt,
        };
      }

      // Check if previous worker's lease expired
      if (currentLease.lease_expires_at <= now) {
        const nextFence = currentLease.fence_token + 1;
        const result = this.db
          .prepare(
            `UPDATE worker_leases
             SET worker_id = ?, fence_token = ?, lease_expires_at = ?, updated_at = ?
             WHERE job_id = ? AND (lease_expires_at <= ? OR worker_id = ?)`
          )
          .run(workerId, nextFence, newExpiresAt, now, jobId, now, workerId);

        if (result.changes > 0) {
          return {
            acquired: true,
            fenceToken: nextFence,
            expiresAt: newExpiresAt,
          };
        }
      }

      // Lease is held by another active worker
      return {
        acquired: false,
        fenceToken: currentLease.fence_token,
        expiresAt: currentLease.lease_expires_at,
        error: `Job is currently locked by worker '${currentLease.worker_id}' until ${new Date(currentLease.lease_expires_at).toISOString()}`,
      };
    });
  }

  /**
   * Extends the lease heartbeat for the current owner and fence token.
   */
  public renewLease(
    jobId: string,
    workerId: string,
    currentFenceToken: number,
    leaseDurationMs = LeaseManager.DEFAULT_LEASE_DURATION_MS
  ): boolean {
    const now = Date.now();
    const newExpiresAt = now + leaseDurationMs;

    const result = this.db
      .prepare(
        `UPDATE worker_leases
         SET lease_expires_at = ?, updated_at = ?
         WHERE job_id = ? AND worker_id = ? AND fence_token = ?`
      )
      .run(newExpiresAt, now, jobId, workerId, currentFenceToken);

    return result.changes > 0;
  }

  /**
   * Releases an active lease on graceful worker termination.
   */
  public releaseLease(jobId: string, workerId: string, currentFenceToken: number): boolean {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE worker_leases
         SET lease_expires_at = ?, updated_at = ?
         WHERE job_id = ? AND worker_id = ? AND fence_token = ?`
      )
      .run(0, now, jobId, workerId, currentFenceToken);

    return result.changes > 0;
  }

  /**
   * Verifies if a given worker and fence token represent a valid, unexpired lease.
   */
  public isLeaseValid(jobId: string, workerId: string, fenceToken: number): boolean {
    const row = this.getLease(jobId);
    if (!row) return false;

    return (
      row.worker_id === workerId &&
      row.fence_token === fenceToken &&
      row.lease_expires_at > Date.now()
    );
  }

  public getLease(jobId: string): WorkerLeaseRecord | undefined {
    return this.db
      .prepare<WorkerLeaseRecord>("SELECT * FROM worker_leases WHERE job_id = ?")
      .get(jobId);
  }

  /**
   * Starts an automated heartbeat timer to renew the lease in the background.
   */
  public startHeartbeat(
    jobId: string,
    workerId: string,
    fenceToken: number,
    intervalMs = LeaseManager.DEFAULT_HEARTBEAT_INTERVAL_MS
  ): () => void {
    const timer = setInterval(() => {
      const renewed = this.renewLease(jobId, workerId, fenceToken);
      if (!renewed) {
        clearInterval(timer);
      }
    }, intervalMs);

    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }

    return () => {
      clearInterval(timer);
    };
  }
}
