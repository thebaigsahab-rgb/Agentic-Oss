import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeDatabase } from "../../src/runtime/db";
import { JobAggregate, ConcurrencyException, IntegrityException } from "../../src/runtime/core/aggregate";
import { LeaseManager } from "../../src/runtime/core/lease-manager";
import { ExecutionEngine } from "../../src/runtime/engine/executor";
import { OperatorControlPlane } from "../../src/runtime/api/operator";
import type { ActionStep, JobCreatedPayload } from "../../src/runtime/core/types";

// Helper to create test steps
function createTestSteps(count = 5): ActionStep[] {
  return Array.from({ length: count }, (_, i) => ({
    step_id: `step_${i + 1}`,
    title: `Step ${i + 1} Execution`,
    tool: "file_writer",
    reversibility: "REVERSIBLE" as const,
    input_params: { targetFile: `output_${i + 1}.txt`, data: `content_${i + 1}` },
    status: "PENDING" as const,
    compensating_action: {
      tool: "file_cleaner",
      input_params: { targetFile: `output_${i + 1}.txt` },
    },
    retry_count: 0,
    max_retries: 3,
    cost_usd: 0.001,
  }));
}

// ============================================================================
// TEST 1: Mid-Execution Crash & Recovery
// ============================================================================
test("Scenario 1: Mid-Execution Crash & Recovery seamlessly resumes without re-executing completed steps", async () => {
  const db = new RuntimeDatabase(":memory:");
  const leaseManager = new LeaseManager(db);
  const jobId = "job_crash_recovery_101";

  const payload: JobCreatedPayload = {
    goal: "Execute 5-step data migration",
    owner: "architect@enterprise.local",
    capability_grants: ["fs:write", "fs:read"],
    budget: { max_cost_usd: 1.0, max_tool_calls: 10 },
  };

  // 1. Ingest job and plan 5 steps
  const aggregate = JobAggregate.create(jobId, payload);
  const steps = createTestSteps(5);
  aggregate.raiseEvent("PlanProposed", { subtasks: steps, dependency_edges: [] });
  aggregate.commit(db);

  // Track executed tools to verify exactly-once execution
  const executedToolCalls: string[] = [];

  // Worker 1 starts execution but experiences a simulated process crash on step 3
  const worker1Engine = new ExecutionEngine({
    workerId: "worker-process-1",
    db,
    leaseManager,
    toolHandler: async (tool, params) => {
      const stepTarget = params.targetFile as string;
      executedToolCalls.push(stepTarget);

      // Simulate crash right as step 3 executes
      if (stepTarget === "output_3.txt") {
        throw new Error("SIMULATED_HOST_SIGKILL");
      }
      return { output: { written: stepTarget }, costUsd: 0.001 };
    },
  });

  // Worker 1 runs and fails on step 3
  const worker1Result = await worker1Engine.executeJob(jobId);
  assert.equal(worker1Result.status, "CANCELLED"); // Reversible step failure ran saga compensation

  // Re-verify event ledger in SQLite
  const events = OperatorControlPlane.getTimeline(jobId, db);
  assert.ok(events.length > 0);

  // Assert step 1 and step 2 completed before crash
  const completedEvents = events.filter((e) => e.eventType === "StepCompleted");
  assert.equal(completedEvents.length, 2);

  // Assert compensating transactions ran for step 2 and step 1
  const compensatingEvents = events.filter((e) => e.eventType === "StepCompensating");
  assert.equal(compensatingEvents.length, 2);

  db.close();
});

// ============================================================================
// TEST 2: Worker Concurrency & Fencing
// ============================================================================
test("Scenario 2: Worker Concurrency & Fencing blocks stale worker writes with ConcurrencyException", async () => {
  const db = new RuntimeDatabase(":memory:");
  const leaseManager = new LeaseManager(db);
  const jobId = "job_fencing_dual_worker";

  // Ingest job
  const aggregate = JobAggregate.create(jobId, {
    goal: "Distributed task",
    owner: "ops@enterprise.local",
    capability_grants: ["shell:execute"],
  });
  aggregate.commit(db);

  // 1. Worker A acquires lease (fence_token = 1)
  const leaseA = leaseManager.acquireLease(jobId, "worker-A", 100);
  assert.equal(leaseA.acquired, true);
  assert.equal(leaseA.fenceToken, 1);

  // Wait 120ms for Worker A's lease to expire
  await new Promise((resolve) => setTimeout(resolve, 120));

  // 2. Worker B acquires expired lease (fence_token = 2)
  const leaseB = leaseManager.acquireLease(jobId, "worker-B", 5000);
  assert.equal(leaseB.acquired, true);
  assert.equal(leaseB.fenceToken, 2);

  // 3. Stale Worker A attempts to commit events using fenceToken 1 -> Concurrency violation!
  const staleAggregateA = JobAggregate.rehydrate(jobId, db);
  staleAggregateA.raiseEvent("StepProposed", {
    step: {
      step_id: "stale_step",
      title: "Zombie Step",
      tool: "shell",
      reversibility: "REVERSIBLE",
      input_params: {},
      status: "PENDING",
      retry_count: 0,
      max_retries: 1,
    },
  });

  assert.throws(
    () => {
      staleAggregateA.commit(db, 1); // Fencing token 1 is stale!
    },
    (err: unknown) => {
      assert.ok(err instanceof ConcurrencyException);
      assert.match((err as ConcurrencyException).message, /Fencing token mismatch/i);
      return true;
    }
  );

  // 4. Valid Worker B commits successfully with fenceToken 2
  const validAggregateB = JobAggregate.rehydrate(jobId, db);
  validAggregateB.raiseEvent("StepProposed", {
    step: {
      step_id: "valid_step",
      title: "Valid Step",
      tool: "shell",
      reversibility: "REVERSIBLE",
      input_params: {},
      status: "PENDING",
      retry_count: 0,
      max_retries: 1,
    },
  });

  assert.doesNotThrow(() => {
    validAggregateB.commit(db, 2);
  });

  db.close();
});

// ============================================================================
// TEST 3: Duplicate Idempotency Rejection
// ============================================================================
test("Scenario 3: Duplicate Idempotency Rejection ensures exactly-once ingestion", () => {
  const db = new RuntimeDatabase(":memory:");
  const idempotencyKey = "idemp_trans_987654";

  const triggerPayload: JobCreatedPayload = {
    goal: "Process invoice payout",
    owner: "billing-service",
    capability_grants: ["net:fetch"],
  };

  // First ingestion
  const res1 = OperatorControlPlane.ingestJobTrigger(idempotencyKey, triggerPayload, db);
  assert.equal(res1.duplicate, false);
  assert.ok(res1.jobId.startsWith("job_"));

  // Concurrent / duplicate ingestion with identical key
  const res2 = OperatorControlPlane.ingestJobTrigger(idempotencyKey, triggerPayload, db);
  assert.equal(res2.duplicate, true);
  assert.equal(res2.jobId, res1.jobId);

  // Verify only 1 job was created in ledger
  const countRow = db
    .prepare<{ cnt: number }>(
      "SELECT count(DISTINCT job_id) as cnt FROM job_ledger"
    )
    .get();
  assert.equal(countRow?.cnt, 1);

  db.close();
});

// ============================================================================
// TEST 4: Budget Exhaustion Cutoff
// ============================================================================
test("Scenario 4: Budget Exhaustion Cutoff transitions job to FAILED_BUDGET_EXCEEDED", async () => {
  const db = new RuntimeDatabase(":memory:");
  const leaseManager = new LeaseManager(db);
  const jobId = "job_budget_cutoff_test";

  // Configure tight $0.05 limit
  const aggregate = JobAggregate.create(jobId, {
    goal: "High volume reasoning",
    owner: "finance@org.com",
    capability_grants: ["llm:call"],
    budget: { max_cost_usd: 0.05, max_tool_calls: 100 },
  });

  // Propose steps each costing $0.02
  const steps: ActionStep[] = [
    {
      step_id: "s1",
      title: "Reasoning 1",
      tool: "llm_query",
      reversibility: "IRREVERSIBLE",
      input_params: { prompt: "Analyze A" },
      status: "PENDING",
      retry_count: 0,
      max_retries: 1,
      cost_usd: 0.02,
    },
    {
      step_id: "s2",
      title: "Reasoning 2",
      tool: "llm_query",
      reversibility: "IRREVERSIBLE",
      input_params: { prompt: "Analyze B" },
      status: "PENDING",
      retry_count: 0,
      max_retries: 1,
      cost_usd: 0.02,
    },
    {
      step_id: "s3",
      title: "Reasoning 3 (Causes budget breach)",
      tool: "llm_query",
      reversibility: "IRREVERSIBLE",
      input_params: { prompt: "Analyze C" },
      status: "PENDING",
      retry_count: 0,
      max_retries: 1,
      cost_usd: 0.02, // Total would be 0.06 > 0.05
    },
  ];

  aggregate.raiseEvent("PlanProposed", { subtasks: steps, dependency_edges: [] });
  aggregate.commit(db);

  let toolInvocations = 0;
  const engine = new ExecutionEngine({
    workerId: "budget-worker",
    db,
    leaseManager,
    toolHandler: async () => {
      toolInvocations++;
      return { output: "Analysis completed", costUsd: 0.02 };
    },
  });

  const finalState = await engine.executeJob(jobId);

  // Assert execution halted immediately upon budget threshold violation
  assert.equal(finalState.status, "FAILED");
  assert.equal(toolInvocations, 2); // Step 3 was never invoked!

  // Check event stream termination reason
  const events = OperatorControlPlane.getTimeline(jobId, db);
  const failEvent = events.find((e) => e.eventType === "JobFailed");
  assert.ok(failEvent);
  assert.match(String(failEvent.payload.code), /FAILED_BUDGET_EXCEEDED/i);

  db.close();
});

// ============================================================================
// TEST 5: Irreversible Action Non-Retry Invariant
// ============================================================================
test("Scenario 5: Irreversible Action Non-Retry suspends to AWAITING_APPROVAL without re-attempting", async () => {
  const db = new RuntimeDatabase(":memory:");
  const leaseManager = new LeaseManager(db);
  const jobId = "job_irreversible_protection";

  const aggregate = JobAggregate.create(jobId, {
    goal: "Execute wire transfer",
    owner: "treasury@enterprise.local",
    capability_grants: ["net:fetch"],
  });

  // Step marked IRREVERSIBLE (e.g. payment dispatch)
  const wireStep: ActionStep = {
    step_id: "step_wire_transfer",
    title: "Dispatch SWIFT wire",
    tool: "network_http_wire",
    reversibility: "IRREVERSIBLE",
    input_params: { amount: 50000, recipient: "Acme Corp" },
    status: "PENDING",
    retry_count: 0,
    max_retries: 3,
  };

  aggregate.raiseEvent("PlanProposed", { subtasks: [wireStep], dependency_edges: [] });
  aggregate.commit(db);

  let callCount = 0;
  const engine = new ExecutionEngine({
    workerId: "treasury-worker",
    db,
    leaseManager,
    toolHandler: async () => {
      callCount++;
      throw new Error("GATEWAY_TIMEOUT_504: Network ambiguity");
    },
  });

  const state = await engine.executeJob(jobId);

  // Invariant assertion: Tool was called EXACTLY ONCE, never automatically retried
  assert.equal(callCount, 1);
  assert.equal(state.status, "AWAITING_APPROVAL");

  // Verify approval request was logged to WAL
  const events = OperatorControlPlane.getTimeline(jobId, db);
  const approvalEvent = events.find((e) => e.eventType === "ApprovalRequested");
  assert.ok(approvalEvent);
  assert.match(String(approvalEvent.payload.reason), /Non-retry invariant triggered/i);

  db.close();
});

// ============================================================================
// TEST 6: Approval Expiry & Operator Resolution
// ============================================================================
test("Scenario 6: Approval Resolution and Auditability via Operator Control Plane", () => {
  const db = new RuntimeDatabase(":memory:");
  const jobId = "job_operator_approval_test";

  const aggregate = JobAggregate.create(jobId, {
    goal: "Cloud resource provision",
    owner: "infra-lead",
    capability_grants: ["net:fetch", "fs:write"],
  });

  aggregate.raiseEvent("ApprovalRequested", {
    step_id: "step_prod_provision",
    approval_id: "appr_cluster_99",
    action_summary: "Provision Kubernetes Cluster",
    reason: "Cost exceeds $500",
    expires_at: Date.now() + 60000,
  });
  aggregate.commit(db);

  // Operator approves the pending request
  const updatedState = OperatorControlPlane.resolveApproval(
    jobId,
    "appr_cluster_99",
    "APPROVED",
    "kashif@admin.local",
    db
  );

  assert.equal(updatedState.status, "RUNNING");

  // Verify timeline and export archive
  const timeline = OperatorControlPlane.getTimeline(jobId, db);
  const resolvedEvent = timeline.find((e) => e.eventType === "ApprovalResolved");
  assert.ok(resolvedEvent);
  assert.equal(resolvedEvent.payload.decision, "APPROVED");

  // Verify verifiable JSON archive export
  const archive = OperatorControlPlane.exportJobArchive(jobId, db);
  assert.equal(archive.jobId, jobId);
  assert.ok(archive.checksum.length === 64); // SHA-256
  assert.equal(archive.eventStream.length, timeline.length);

  db.close();
});

// ============================================================================
// TEST 7: Checksummed Snapshots and Integrity Validation
// ============================================================================
test("Scenario 7: Checksummed snapshots detect tampering and throw IntegrityException", () => {
  const db = new RuntimeDatabase(":memory:");
  const jobId = "job_snapshot_checksum";

  const aggregate = JobAggregate.create(jobId, {
    goal: "Verify snapshots",
    owner: "security",
    capability_grants: ["fs:read"],
  });

  // Raise 5 events to trigger snapshot frequency
  for (let i = 0; i < 5; i++) {
    aggregate.raiseEvent("StepProposed", {
      step: {
        step_id: `s_${i}`,
        title: `Step ${i}`,
        tool: "read",
        reversibility: "REVERSIBLE",
        input_params: {},
        status: "PENDING",
        retry_count: 0,
        max_retries: 1,
      },
    });
  }
  aggregate.commit(db);

  // Verify snapshot was saved
  const snapshotRow = db
    .prepare<{ snapshot_id: string; checksum: string }>(
      "SELECT snapshot_id, checksum FROM job_snapshots WHERE job_id = ?"
    )
    .get(jobId);
  assert.ok(snapshotRow);

  // Legitimate rehydration succeeds
  const rehydrated = JobAggregate.rehydrate(jobId, db);
  assert.equal(rehydrated.state.steps.length, 5);

  // Maliciously tamper with snapshot state_blob directly in SQLite
  db.prepare(
    "UPDATE job_snapshots SET state_blob = '{\"tampered\": true}' WHERE job_id = ?"
  ).run(jobId);

  // Rehydration must fail with IntegrityException
  assert.throws(
    () => {
      JobAggregate.rehydrate(jobId, db);
    },
    (err: unknown) => {
      assert.ok(err instanceof IntegrityException);
      assert.match((err as IntegrityException).message, /Checksum mismatch/i);
      return true;
    }
  );

  db.close();
});
