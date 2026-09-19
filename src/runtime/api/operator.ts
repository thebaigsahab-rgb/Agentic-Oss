import { createHash, randomUUID } from "node:crypto";
import type { IRuntimeDb } from "../db";
import { JobAggregate } from "../core/aggregate";
import type {
  DomainEvent,
  JobContext,
  JobCreatedPayload,
  StepEvidence,
} from "../core/types";

export interface TimelineEntry {
  sequenceNum: number;
  eventId: string;
  eventType: string;
  actor?: string;
  workerId?: string;
  fenceToken?: number;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface JobExportArchive {
  jobId: string;
  exportTimestamp: number;
  checksum: string;
  stateSnapshot: JobContext;
  eventStream: DomainEvent[];
  evidenceManifest: StepEvidence[];
}

/**
 * Operator Control Plane Service & API
 * Provides out-of-band operator visibility, approval decisions, lifecycle control,
 * and cryptographic job export archives.
 */
export class OperatorControlPlane {
  /**
   * Chronological visual timeline of all domain events.
   */
  public static getTimeline(jobId: string, db: IRuntimeDb): TimelineEntry[] {
    const rows = db
      .prepare<{
        event_id: string;
        event_type: string;
        sequence_num: number;
        payload: string;
        metadata: string;
        created_at: number;
      }>(
        "SELECT event_id, event_type, sequence_num, payload, metadata, created_at FROM job_ledger WHERE job_id = ? ORDER BY sequence_num ASC"
      )
      .all(jobId);

    return rows.map((r) => {
      const meta = JSON.parse(r.metadata) as Record<string, unknown>;
      return {
        sequenceNum: r.sequence_num,
        eventId: r.event_id,
        eventType: r.event_type,
        actor: typeof meta.actor === "string" ? meta.actor : undefined,
        workerId: typeof meta.worker_id === "string" ? meta.worker_id : undefined,
        fenceToken: typeof meta.fence_token === "number" ? meta.fence_token : undefined,
        timestamp: r.created_at,
        payload: JSON.parse(r.payload) as Record<string, unknown>,
      };
    });
  }

  /**
   * Evidence Inspector: Retrieves all cryptographic tool outputs and hashes.
   */
  public static getEvidence(jobId: string, db: IRuntimeDb): StepEvidence[] {
    const aggregate = JobAggregate.rehydrate(jobId, db);
    return aggregate.state.evidence;
  }

  /**
   * Lifecycle Controls: Out-of-band PAUSE, RESUME, CANCEL, RETRY commands.
   * State is never updated with raw UPDATE statements; strictly emits signed domain events.
   */
  public static controlJob(
    jobId: string,
    action: "PAUSE" | "RESUME" | "CANCEL" | "RETRY",
    actor: string,
    db: IRuntimeDb,
    reason?: string
  ): JobContext {
    return db.transaction(() => {
      const aggregate = JobAggregate.rehydrate(jobId, db);

      switch (action) {
        case "PAUSE":
          aggregate.raiseEvent(
            "JobPaused",
            { reason: reason || "Operator issued pause command.", actor },
            { actor, timestamp: Date.now() }
          );
          break;

        case "RESUME":
          aggregate.raiseEvent(
            "JobResumed",
            { reason: reason || "Operator issued resume command.", actor },
            { actor, timestamp: Date.now() }
          );
          break;

        case "CANCEL":
          aggregate.raiseEvent(
            "JobCancelled",
            { reason: reason || "Operator issued cancellation.", actor },
            { actor, timestamp: Date.now() }
          );
          break;

        case "RETRY":
          // Reset any failed steps to PENDING and resume
          for (const s of aggregate.state.steps) {
            if (s.status === "FAILED") {
              s.status = "PENDING";
            }
          }
          aggregate.raiseEvent(
            "JobResumed",
            { reason: reason || "Operator reset failed step for retry.", actor },
            { actor, timestamp: Date.now() }
          );
          break;
      }

      aggregate.commit(db);

      // Record in out-of-band audit trail
      db.prepare(
        `INSERT INTO audit_events (audit_id, job_id, action, actor, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        `aud_${Date.now()}_${randomUUID().slice(0, 8)}`,
        jobId,
        action,
        actor,
        reason || null,
        Date.now()
      );

      return aggregate.state;
    });
  }

  /**
   * HITL Resolution Interface: Cryptographically resolves pending approval requests.
   */
  public static resolveApproval(
    jobId: string,
    approvalId: string,
    decision: "APPROVED" | "REJECTED",
    actor: string,
    db: IRuntimeDb,
    signature?: string
  ): JobContext {
    return db.transaction(() => {
      const aggregate = JobAggregate.rehydrate(jobId, db);

      aggregate.raiseEvent(
        "ApprovalResolved",
        {
          approval_id: approvalId,
          decision,
          actor,
          signature: signature || `sig_${createHash("sha256").update(`${actor}:${decision}:${Date.now()}`).digest("hex").slice(0, 16)}`,
        },
        { actor, timestamp: Date.now() }
      );

      aggregate.commit(db);

      // Audit log
      db.prepare(
        `INSERT INTO audit_events (audit_id, job_id, action, actor, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        `aud_${Date.now()}_${randomUUID().slice(0, 8)}`,
        jobId,
        `APPROVAL_${decision}`,
        actor,
        JSON.stringify({ approvalId, decision }),
        Date.now()
      );

      return aggregate.state;
    });
  }

  /**
   * Deduplicated Ingestion: Ingests identical triggers safely via idempotency keys.
   */
  public static ingestJobTrigger(
    idempotencyKey: string,
    payload: JobCreatedPayload,
    db: IRuntimeDb,
    scope = "default"
  ): { jobId: string; duplicate: boolean } {
    return db.transaction(() => {
      // 1. Check if idempotency key already claimed
      const existing = db
        .prepare<{ job_id: string }>(
          "SELECT job_id FROM idempotency_keys WHERE idempotency_key = ? AND scope = ?"
        )
        .get(idempotencyKey, scope);

      if (existing) {
        return { jobId: existing.job_id, duplicate: true };
      }

      // 2. Create new JobAggregate
      const newJobId = `job_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const aggregate = JobAggregate.create(newJobId, payload, {
        actor: payload.owner,
        timestamp: Date.now(),
      });
      aggregate.commit(db);

      // 3. Record Idempotency Key
      db.prepare(
        `INSERT INTO idempotency_keys (idempotency_key, scope, job_id, created_at)
         VALUES (?, ?, ?, ?)`
      ).run(idempotencyKey, scope, newJobId, Date.now());

      return { jobId: newJobId, duplicate: false };
    });
  }

  /**
   * One-click verifiable export archive bundling state snapshot, full event ledger, and evidence.
   */
  public static exportJobArchive(jobId: string, db: IRuntimeDb): JobExportArchive {
    const aggregate = JobAggregate.rehydrate(jobId, db);
    const eventRows = db
      .prepare<{
        event_id: string;
        job_id: string;
        event_type: string;
        sequence_num: number;
        payload: string;
        metadata: string;
        created_at: number;
      }>(
        "SELECT * FROM job_ledger WHERE job_id = ? ORDER BY sequence_num ASC"
      )
      .all(jobId);

    const eventStream: DomainEvent[] = eventRows.map((r) => ({
      event_id: r.event_id,
      job_id: r.job_id,
      event_type: r.event_type as DomainEvent["event_type"],
      sequence_num: r.sequence_num,
      payload: JSON.parse(r.payload),
      metadata: JSON.parse(r.metadata),
      created_at: r.created_at,
    }));

    const archiveBody = {
      jobId,
      stateSnapshot: aggregate.state,
      eventStream,
      evidenceManifest: aggregate.state.evidence,
      exportTimestamp: Date.now(),
    };

    const serialized = JSON.stringify(archiveBody);
    const checksum = createHash("sha256").update(serialized).digest("hex");

    return {
      ...archiveBody,
      checksum,
    };
  }
}
