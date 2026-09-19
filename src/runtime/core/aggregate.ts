import { createHash, randomUUID } from "node:crypto";
import type { IRuntimeDb } from "../db";
import type {
  ActionStep,
  DomainEvent,
  DomainEventType,
  EventMetadata,
  JobContext,
  JobCreatedPayload,
  JobFailedPayload,
  JobSnapshotRecord,
  JobSucceededPayload,
  PlanProposedPayload,
  StepActionExecutingPayload,
  StepCompletedPayload,
  StepFailedPayload,
  StepEvidence,
  ApprovalResolvedPayload,
} from "./types";

export class ConcurrencyException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyException";
  }
}

export class IntegrityException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityException";
  }
}

/**
 * Event-Sourced Aggregate Root for Agent Job execution.
 * Guarantees zero lost state, strict monotonic sequencing, and checksummed snapshot projections.
 */
export class JobAggregate {
  private _state!: JobContext;
  private readonly _uncommittedEvents: DomainEvent[] = [];
  private _lastSnapshotSequence = 0;
  private static readonly SNAPSHOT_FREQUENCY = 5;

  private constructor() {}

  public get state(): Readonly<JobContext> {
    return this._state;
  }

  public get uncommittedEvents(): readonly DomainEvent[] {
    return this._uncommittedEvents;
  }

  /**
   * Initializes a brand new JobAggregate and emits the initial JobCreated event.
   */
  public static create(
    jobId: string,
    payload: JobCreatedPayload,
    metadata: EventMetadata = { timestamp: Date.now() }
  ): JobAggregate {
    const aggregate = new JobAggregate();
    aggregate._state = {
      job_id: jobId,
      goal: payload.goal,
      owner: payload.owner,
      capability_grants: payload.capability_grants,
      plan: { subtasks: [], dependency_edges: [] },
      steps: [],
      evidence: [],
      budget: {
        max_cost_usd: payload.budget?.max_cost_usd ?? 1.0,
        current_cost_usd: 0,
        max_wall_time_sec: payload.budget?.max_wall_time_sec ?? 3600,
        max_tool_calls: payload.budget?.max_tool_calls ?? 50,
        tool_call_count: 0,
      },
      checkpoint: {
        sequence_num: 0,
        current_fsm_state: "QUEUED",
      },
      status: "QUEUED",
      created_at: metadata.timestamp,
      updated_at: metadata.timestamp,
    };

    aggregate.raiseEvent("JobCreated", payload, metadata);
    return aggregate;
  }

  /**
   * Rehydrates an aggregate strictly from the SQLite event store and snapshots.
   */
  public static rehydrate(jobId: string, db: IRuntimeDb): JobAggregate {
    const aggregate = new JobAggregate();

    // 1. Check for latest snapshot projection
    const snapshotRow = db
      .prepare<JobSnapshotRecord>(
        "SELECT * FROM job_snapshots WHERE job_id = ? ORDER BY last_sequence_num DESC LIMIT 1"
      )
      .get(jobId);

    let fromSequence = 0;

    if (snapshotRow) {
      // Validate snapshot checksum
      const computedHash = createHash("sha256")
        .update(snapshotRow.state_blob)
        .digest("hex");

      if (computedHash !== snapshotRow.checksum) {
        throw new IntegrityException(
          `Corrupted snapshot detected for job ${jobId}. Checksum mismatch.`
        );
      }

      aggregate._state = JSON.parse(snapshotRow.state_blob) as JobContext;
      fromSequence = snapshotRow.last_sequence_num;
      aggregate._lastSnapshotSequence = snapshotRow.last_sequence_num;
    }

    // 2. Query subsequent events in monotonic sequence order
    const events = db
      .prepare<{
        event_id: string;
        job_id: string;
        event_type: string;
        sequence_num: number;
        payload: string;
        metadata: string;
        created_at: number;
      }>(
        "SELECT * FROM job_ledger WHERE job_id = ? AND sequence_num > ? ORDER BY sequence_num ASC"
      )
      .all(jobId, fromSequence);

    if (!snapshotRow && events.length === 0) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // 3. Replay events through state reduction
    for (const row of events) {
      const event: DomainEvent = {
        event_id: row.event_id,
        job_id: row.job_id,
        event_type: row.event_type as DomainEventType,
        sequence_num: row.sequence_num,
        payload: JSON.parse(row.payload),
        metadata: JSON.parse(row.metadata),
        created_at: row.created_at,
      };

      aggregate.apply(event, true);
    }

    return aggregate;
  }

  /**
   * Raises a new domain event, applies state reduction, and buffers for commit.
   */
  public raiseEvent<T = unknown>(
    eventType: DomainEventType,
    payload: T,
    metadata: EventMetadata = { timestamp: Date.now() }
  ): DomainEvent<T> {
    const nextSeq = (this._state?.checkpoint?.sequence_num ?? 0) + 1;
    const event: DomainEvent<T> = {
      event_id: `evt_${Date.now()}_${randomUUID().slice(0, 8)}`,
      job_id: this._state?.job_id || (payload as Record<string, string>)?.job_id || "",
      event_type: eventType,
      sequence_num: nextSeq,
      payload,
      metadata: {
        ...metadata,
        timestamp: metadata.timestamp || Date.now(),
      },
      created_at: Date.now(),
    };

    this.apply(event as DomainEvent, false);
    this._uncommittedEvents.push(event as DomainEvent);
    return event;
  }

  /**
   * Pure state reducer applying domain event transitions.
   */
  private apply(event: DomainEvent, isReplaying: boolean): void {
    if (!this._state && event.event_type !== "JobCreated") {
      throw new IntegrityException(
        `Cannot apply event ${event.event_type} before JobCreated.`
      );
    }

    const payload = event.payload as Record<string, unknown>;

    switch (event.event_type) {
      case "JobCreated": {
        const p = payload as unknown as JobCreatedPayload;
        if (isReplaying) {
          this._state = {
            job_id: event.job_id,
            goal: p.goal,
            owner: p.owner,
            capability_grants: p.capability_grants,
            plan: { subtasks: [], dependency_edges: [] },
            steps: [],
            evidence: [],
            budget: {
              max_cost_usd: p.budget?.max_cost_usd ?? 1.0,
              current_cost_usd: 0,
              max_wall_time_sec: p.budget?.max_wall_time_sec ?? 3600,
              max_tool_calls: p.budget?.max_tool_calls ?? 50,
              tool_call_count: 0,
            },
            checkpoint: {
              sequence_num: event.sequence_num,
              current_fsm_state: "QUEUED",
            },
            status: "QUEUED",
            created_at: event.created_at,
            updated_at: event.created_at,
          };
        }
        break;
      }

      case "JobLeased": {
        this._state.status = "LEASED";
        break;
      }

      case "PlanProposed": {
        const p = payload as unknown as PlanProposedPayload;
        this._state.plan = {
          subtasks: p.subtasks,
          dependency_edges: p.dependency_edges,
        };
        this._state.steps = p.subtasks.map((s) => ({ ...s, status: "PENDING" }));
        break;
      }

      case "StepProposed": {
        const step = payload.step as ActionStep;
        this._state.steps.push({ ...step, status: "PENDING" });
        break;
      }

      case "StepActionExecuting": {
        const p = payload as unknown as StepActionExecutingPayload;
        this._state.status = "RUNNING";
        const step = this._state.steps.find((s) => s.step_id === p.step_id);
        if (step) {
          step.status = "EXECUTING";
          step.tool = p.tool;
          step.input_params = p.input_params;
          step.reversibility = p.reversibility;
        }
        this._state.budget.tool_call_count += 1;
        this._state.checkpoint.last_verified_step_id = p.step_id;
        break;
      }

      case "StepCompleted": {
        const p = payload as unknown as StepCompletedPayload;
        const step = this._state.steps.find((s) => s.step_id === p.step_id);
        if (step) {
          step.status = "COMPLETED";
          step.output = p.output;
          step.cost_usd = p.cost_usd || 0;
        }
        this._state.budget.current_cost_usd += p.cost_usd || 0;

        const evidenceItem: StepEvidence = {
          artifact_id: `art_${Date.now()}_${p.step_id}`,
          type: "tool_output",
          hash: p.evidence_hash,
          data: p.output,
          timestamp: event.created_at,
        };
        this._state.evidence.push(evidenceItem);
        this._state.checkpoint.last_verified_step_id = p.step_id;
        break;
      }

      case "StepFailed": {
        const p = payload as unknown as StepFailedPayload;
        const step = this._state.steps.find((s) => s.step_id === p.step_id);
        if (step) {
          step.status = "FAILED";
          step.error = p.error;
          step.retry_count += 1;
        }
        break;
      }

      case "StepCompensating": {
        this._state.status = "COMPENSATING";
        const stepId = String(payload.step_id);
        const step = this._state.steps.find((s) => s.step_id === stepId);
        if (step) {
          step.status = "COMPENSATING";
        }
        break;
      }

      case "StepCompensated": {
        const stepId = String(payload.step_id);
        const step = this._state.steps.find((s) => s.step_id === stepId);
        if (step) {
          step.status = "COMPENSATED";
        }
        break;
      }

      case "ApprovalRequested": {
        this._state.status = "AWAITING_APPROVAL";
        break;
      }

      case "ApprovalResolved": {
        const p = payload as unknown as ApprovalResolvedPayload;
        if (p.decision === "APPROVED") {
          this._state.status = "RUNNING";
        } else {
          this._state.status = "CANCELLED";
        }
        break;
      }

      case "JobPaused": {
        this._state.status = "PAUSED";
        break;
      }

      case "JobResumed": {
        this._state.status = "RUNNING";
        break;
      }

      case "JobCancelled": {
        this._state.status = "CANCELLED";
        break;
      }

      case "JobSucceeded": {
        this._state.status = "SUCCEEDED";
        const p = payload as unknown as JobSucceededPayload;
        this._state.final_outcome = p.outcome;
        break;
      }

      case "JobFailed": {
        this._state.status = "FAILED";
        const p = payload as unknown as JobFailedPayload;
        this._state.final_outcome = {
          artifact_references: [],
          total_cost_usd: this._state.budget.current_cost_usd,
          termination_reason: p.reason,
          wall_time_ms: Date.now() - this._state.created_at,
        };
        break;
      }
    }

    this._state.checkpoint.sequence_num = event.sequence_num;
    this._state.checkpoint.current_fsm_state = this._state.status;
    this._state.updated_at = event.created_at;
  }

  /**
   * Commits all uncommitted events to the SQLite event store within a single transaction.
   * Enforces worker fencing token validation and takes periodic snapshots.
   */
  public commit(db: IRuntimeDb, expectedFenceToken?: number): void {
    if (this._uncommittedEvents.length === 0) {
      return;
    }

    db.transaction(() => {
      // 1. Worker Fencing Validation
      if (expectedFenceToken !== undefined) {
        const lease = db
          .prepare<{ fence_token: number; lease_expires_at: number }>(
            "SELECT fence_token, lease_expires_at FROM worker_leases WHERE job_id = ?"
          )
          .get(this._state.job_id);

        if (!lease) {
          throw new ConcurrencyException(
            `Cannot commit events: No active worker lease found for job ${this._state.job_id}.`
          );
        }

        if (lease.fence_token !== expectedFenceToken) {
          throw new ConcurrencyException(
            `Worker concurrency violation: Fencing token mismatch. Expected ${expectedFenceToken}, found ${lease.fence_token}. Stale write blocked.`
          );
        }

        if (lease.lease_expires_at < Date.now()) {
          throw new ConcurrencyException(
            `Worker lease expired for job ${this._state.job_id}. Stale write blocked.`
          );
        }
      }

      // 2. Append Events to Immutable Ledger
      const insertStmt = db.prepare(
        `INSERT INTO job_ledger (event_id, job_id, event_type, sequence_num, payload, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      for (const event of this._uncommittedEvents) {
        insertStmt.run(
          event.event_id,
          event.job_id,
          event.event_type,
          event.sequence_num,
          JSON.stringify(event.payload),
          JSON.stringify(event.metadata),
          event.created_at
        );
      }

      // 3. Check for Snapshot Materialization Threshold
      const currentSeq = this._state.checkpoint.sequence_num;
      const isTerminal =
        this._state.status === "SUCCEEDED" ||
        this._state.status === "FAILED" ||
        this._state.status === "CANCELLED";

      if (
        currentSeq >= this._lastSnapshotSequence + JobAggregate.SNAPSHOT_FREQUENCY ||
        isTerminal
      ) {
        this.saveSnapshot(db);
        this._lastSnapshotSequence = currentSeq;
      }

      this._uncommittedEvents.length = 0;
    });
  }

  /**
   * Persists a materialized snapshot projection with cryptographic SHA-256 checksum.
   */
  public saveSnapshot(db: IRuntimeDb): void {
    const stateBlob = JSON.stringify(this._state);
    const checksum = createHash("sha256").update(stateBlob).digest("hex");
    const snapshotId = `snp_${Date.now()}_${randomUUID().slice(0, 8)}`;

    db.prepare(
      `INSERT INTO job_snapshots (snapshot_id, job_id, last_sequence_num, state_blob, checksum, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      snapshotId,
      this._state.job_id,
      this._state.checkpoint.sequence_num,
      stateBlob,
      checksum,
      Date.now()
    );
  }
}
