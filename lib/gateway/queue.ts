import type { GatewayJob, GatewayJobStatus } from "./types";

/**
 * In-Memory & Transactional Job Queue for the WhatsApp Gateway & Relay
 */
export class GatewayJobQueue {
  private static instance: GatewayJobQueue | null = null;
  private readonly jobs = new Map<string, GatewayJob>();
  private readonly leaseTimeouts = new Map<string, number>();
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startWatchdog();
  }

  public static getInstance(): GatewayJobQueue {
    if (!GatewayJobQueue.instance) {
      GatewayJobQueue.instance = new GatewayJobQueue();
    }
    return GatewayJobQueue.instance;
  }

  public enqueueJob(job: GatewayJob): GatewayJob {
    job.updatedAt = Date.now();
    this.jobs.set(job.id, { ...job });
    return job;
  }

  public getJob(jobId: string): GatewayJob | undefined {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : undefined;
  }

  public listJobs(filter?: { status?: GatewayJobStatus; senderNumber?: string }): GatewayJob[] {
    let result = Array.from(this.jobs.values());
    if (filter?.status) {
      result = result.filter((j) => j.status === filter.status);
    }
    if (filter?.senderNumber) {
      result = result.filter((j) => j.senderNumber === filter.senderNumber);
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Leases the next pending queued job to a polling home relay client.
   */
  public leaseNextJob(leaseTimeoutMs = 60 * 1000): GatewayJob | null {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.status === "queued") {
        job.status = "running";
        job.updatedAt = now;
        this.leaseTimeouts.set(job.id, now + leaseTimeoutMs);
        return { ...job };
      }
    }
    return null;
  }

  /**
   * Completes a leased job with success or failure.
   */
  public completeJob(
    jobId: string,
    update: { status: "succeeded" | "failed" | "cancelled"; result?: string; error?: string }
  ): GatewayJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    job.status = update.status;
    job.result = update.result;
    job.error = update.error;
    job.updatedAt = Date.now();
    this.leaseTimeouts.delete(jobId);

    return { ...job };
  }

  public updateJobStatus(jobId: string, status: GatewayJobStatus): GatewayJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.status = status;
    job.updatedAt = Date.now();
    return { ...job };
  }

  public clear(): void {
    this.jobs.clear();
    this.leaseTimeouts.clear();
  }

  public destroy(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private startWatchdog(): void {
    this.watchdogTimer = setInterval(() => {
      const now = Date.now();
      for (const [jobId, expiresAt] of this.leaseTimeouts.entries()) {
        if (now > expiresAt) {
          const job = this.jobs.get(jobId);
          if (job && job.status === "running") {
            job.status = "failed";
            job.error = "Job lease expired without response from home agent relay.";
            job.updatedAt = now;
          }
          this.leaseTimeouts.delete(jobId);
        }
      }
    }, 15 * 1000);

    if (this.watchdogTimer && typeof this.watchdogTimer.unref === "function") {
      this.watchdogTimer.unref();
    }
  }
}

export const globalJobQueue = GatewayJobQueue.getInstance();
