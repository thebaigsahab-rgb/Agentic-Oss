import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { DatabaseSync } from "node:sqlite";

import {
  initializeSovereignMemorySystem,
  CryptographicVault,
  EmbeddingManager,
  HybridRetrievalEngine,
  CloudEgressBlockedError,
  KeyShreddedError,
} from "../src/memory";
import { DailyBriefingCompiler } from "../src/life_os/briefing/daily";
import { WeeklyReviewEngine } from "../src/life_os/review/weekly";
import {
  HITLApprovalGateway,
  SecurityGuardrailViolationError,
} from "../src/life_os/guardrails/approval";

// Helper: Setup in-memory sovereign system
function createTestSystem() {
  const db = new DatabaseSync(":memory:");
  return initializeSovereignMemorySystem({ db });
}

// -----------------------------------------------------------------------------
// TEST CASE 1: Cross-Category Privilege Isolation
// -----------------------------------------------------------------------------
test("1. Cross-Category Isolation: low-privilege queries strictly exclude health_notes, purchases, and subscriptions", async () => {
  const { engine } = createTestSystem();

  // Ingest restricted sensitive memories
  engine.insertMemory({
    category: "health_notes",
    content: "Patient takes Metformin 500mg daily with breakfast for glycemic control.",
    source: "doc:medical_chart_9921",
    confidence: 0.98,
    consent_scope: "local:private",
    retention_policy: "retain_indefinitely",
    is_encrypted: true,
  });

  engine.insertMemory({
    category: "purchases",
    content: "Purchased private cardiology prescription for $45.20 on Visa ending in 4112.",
    source: "receipt:rx_0182",
    confidence: 0.95,
    consent_scope: "local:private",
    retention_policy: "retain_indefinitely",
    is_encrypted: true,
  });

  engine.insertMemory({
    category: "subscriptions",
    content: "Private psychiatric tele-therapy subscription billed $120 monthly.",
    source: "billing:sub_health",
    confidence: 0.94,
    consent_scope: "local:private",
    retention_policy: "retain_indefinitely",
    is_encrypted: true,
  });

  // Ingest general low-privilege memories
  engine.insertMemory({
    category: "routines",
    content: "Morning commute routine via route 101 departure at 8:15 AM.",
    source: "user:direct_input",
    confidence: 0.95,
    consent_scope: "briefing:allowed",
    retention_policy: "retain_indefinitely",
    is_encrypted: false,
  });

  engine.insertMemory({
    category: "preferences",
    content: "Avoid toll highways during heavy morning commute congestion.",
    source: "user:direct_input",
    confidence: 0.90,
    consent_scope: "briefing:allowed",
    retention_policy: "retain_indefinitely",
    is_encrypted: false,
  });

  // Query under low-privilege context (e.g. Schedule commute)
  const commuteResult = engine.retrieve({
    query: "Schedule commute route and morning travel",
    privilege_context: "low_privilege",
  });

  assert.equal(commuteResult.refusal, false, "Retrieval should succeed for commute query");
  if (!commuteResult.refusal) {
    assert.ok(commuteResult.results.length > 0, "Should return commute routine and preferences");

    for (const res of commuteResult.results) {
      assert.notEqual(res.memory.category, "health_notes");
      assert.notEqual(res.memory.category, "purchases");
      assert.notEqual(res.memory.category, "subscriptions");

      // Verify no leakage of confidential content
      assert.ok(!res.memory.content.includes("Metformin"), "Health notes must not leak into context");
      assert.ok(!res.memory.content.includes("4112"), "Financial data must not leak into context");
      assert.ok(!res.memory.content.includes("psychiatric"), "Subscription data must not leak");
    }
  }

  // Adversarial query: Attempt to fish for medical terms under low privilege
  const adversarialResult = engine.retrieve({
    query: "Metformin prescription medical cardiology health notes",
    privilege_context: "low_privilege",
  });

  // Must either refuse due to lack of accessible matches or return only non-restricted memories
  if (!adversarialResult.refusal) {
    for (const res of adversarialResult.results) {
      assert.ok(!["health_notes", "purchases", "subscriptions"].includes(res.memory.category));
    }
  } else {
    assert.ok(adversarialResult.refusal, "Correctly refused access to restricted memories under low privilege");
  }

  // Authorized Query: High-privilege health context allows health_notes
  const healthAuthorized = engine.retrieve({
    query: "glycemic control medication Metformin",
    privilege_context: "health_wellness",
  });

  assert.equal(healthAuthorized.refusal, false);
  if (!healthAuthorized.refusal) {
    assert.ok(
      healthAuthorized.results.some((r) => r.memory.category === "health_notes" && r.memory.content.includes("Metformin")),
      "Authorized health_wellness context successfully retrieves decrypted health notes"
    );
  }
});

// -----------------------------------------------------------------------------
// TEST CASE 2: Cryptographic Hard Deletion & Key Shredding
// -----------------------------------------------------------------------------
test("2. Cryptographic Hard Deletion: hard delete purges SQL, FTS, vectors, and shreds DEK", async () => {
  const { db, vault, engine } = createTestSystem();

  // Ingest an encrypted restricted health memory
  const healthAtom = engine.insertMemory({
    category: "health_notes",
    content: "Confidential neurology scan results at Valley Hospital.",
    source: "doc:mri_report_771",
    confidence: 0.99,
    consent_scope: "local:private",
    retention_policy: "retain_indefinitely",
    is_encrypted: true,
  });

  // Ingest an unencrypted project memory
  const projectAtom = engine.insertMemory({
    category: "projects",
    content: "Project Titan confidential launch checklist alpha.",
    source: "user:direct_input",
    confidence: 0.95,
    consent_scope: "briefing:allowed",
    retention_policy: "retain_indefinitely",
    is_encrypted: false,
  });

  // Verify retrieval works prior to deletion
  const preCheck = engine.retrieve({
    query: "Valley Hospital neurology",
    privilege_context: "health_wellness",
  });
  assert.equal(preCheck.refusal, false);

  // Trigger hard deletion of both memories
  const delHealth = engine.hardDeleteMemory(healthAtom.memory_id);
  const delProject = engine.hardDeleteMemory(projectAtom.memory_id);
  assert.ok(delHealth);
  assert.ok(delProject);

  // 1. Assert relational records are purged
  const atomCount = db.prepare("SELECT count(*) as count FROM memory_atoms WHERE memory_id IN (?, ?)")
    .get(healthAtom.memory_id, projectAtom.memory_id) as { count: number };
  assert.equal(atomCount.count, 0, "Relational rows must be zero");

  // 2. Assert vector embeddings are purged
  const vecCount = db.prepare("SELECT count(*) as count FROM memory_vectors WHERE memory_id IN (?, ?)")
    .get(healthAtom.memory_id, projectAtom.memory_id) as { count: number };
  assert.equal(vecCount.count, 0, "Vector rows must be zero");

  // 3. Assert FTS5 entries are purged
  const ftsCount = db.prepare("SELECT count(*) as count FROM memory_fts WHERE memory_id IN (?, ?)")
    .get(healthAtom.memory_id, projectAtom.memory_id) as { count: number };
  assert.equal(ftsCount.count, 0, "FTS5 rows must be zero");

  // 4. Assert key shredding in database
  const shreddedKeyRow = db.prepare("SELECT * FROM memory_encryption_keys WHERE shredded_at IS NOT NULL").all();
  assert.ok(shreddedKeyRow.length > 0, "Encryption key must be marked shredded in key vault");

  // 5. Subsequent retrieval returns zero matches / epistemic refusal
  const postCheck = engine.retrieve({
    query: "Valley Hospital neurology",
    privilege_context: "health_wellness",
  });
  assert.ok(postCheck.refusal, "Subsequent queries must refuse with no matching records");
});

// -----------------------------------------------------------------------------
// TEST CASE 3: Stale Fact Invalidation & Preference Superseding
// -----------------------------------------------------------------------------
test("3. Stale Fact Invalidation & Override: superseding updates superseded_by and prioritizes new preference", async () => {
  const { db, engine } = createTestSystem();

  // 1. Insert initial preference
  const oldPreference = engine.insertMemory({
    category: "preferences",
    content: "User prefers Dark Roast Coffee in the morning with whole milk.",
    source: "user:direct_input",
    confidence: 0.90,
    consent_scope: "briefing:allowed",
    retention_policy: "retain_indefinitely",
    is_encrypted: false,
  });

  // Verify initial preference is retrieved
  const initialRetrieval = engine.retrieve({
    query: "morning drink preference coffee or tea",
    privilege_context: "daily_planning",
  });
  assert.equal(initialRetrieval.refusal, false);
  if (!initialRetrieval.refusal) {
    assert.ok(initialRetrieval.results[0].memory.content.includes("Dark Roast Coffee"));
  }

  // 2. Supersede old preference with direct override
  const { newMemory, supersededOldId } = engine.supersedeMemory(
    oldPreference.memory_id,
    "User prefers Earl Grey Tea in the morning with clover honey.",
    "preferences",
    "user:direct_input",
    0.98
  );

  assert.equal(supersededOldId, oldPreference.memory_id);
  assert.ok(newMemory.memory_id);

  // 3. Verify in database that old record has superseded_by pointer and is_deprecated = 1
  const staleRow = db.prepare("SELECT * FROM memory_atoms WHERE memory_id = ?").get(oldPreference.memory_id) as any;
  assert.equal(staleRow.superseded_by, newMemory.memory_id);
  assert.equal(staleRow.is_deprecated, 1);

  // 4. Verify retrieval now returns the new preference and filters out the superseded record
  const updatedRetrieval = engine.retrieve({
    query: "morning drink preference coffee or tea",
    privilege_context: "daily_planning",
  });

  assert.equal(updatedRetrieval.refusal, false);
  if (!updatedRetrieval.refusal) {
    assert.ok(
      updatedRetrieval.results[0].memory.content.includes("Earl Grey Tea"),
      "Active retrieval must return superseding preference"
    );
    assert.ok(
      !updatedRetrieval.results.some((r) => r.memory.memory_id === oldPreference.memory_id),
      "Superseded memory must not be returned in active results"
    );
  }
});

// -----------------------------------------------------------------------------
// TEST CASE 4: Citation Verification & Zero-Hallucination Grounding
// -----------------------------------------------------------------------------
test("4. Citation Verification: Daily Briefing compiler grounds 100% of factual assertions in valid citations", async () => {
  const { engine } = createTestSystem();

  // Ingest structured multi-category scenario
  const ev1 = engine.insertMemory({
    category: "routines",
    content: "Quarterly Strategy Review sync with Executive Team at 10:00 AM.",
    source: "calendar:event_901",
    confidence: 0.99,
    consent_scope: "briefing:allowed",
    retention_policy: "retain_indefinitely",
  });

  const task1 = engine.insertMemory({
    category: "commitments",
    content: "Submit final Q3 privacy audit report to Compliance Board.",
    source: "user:direct_input",
    confidence: 0.95,
    consent_scope: "briefing:allowed",
    retention_policy: "retain_indefinitely",
    metadata: {
      due_date: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), // Due in 6h
      energy_requirement: "HIGH_FOCUS",
      dependencies: [],
    },
  });

  const comm1 = engine.insertMemory({
    category: "commitments",
    content: "URGENT: Legal team requested revised data governance addendum.",
    source: "email:msg_9871",
    confidence: 0.92,
    consent_scope: "briefing:allowed",
    retention_policy: "retain_indefinitely",
    metadata: { sender: "counsel@company.com" },
  });

  const bill1 = engine.insertMemory({
    category: "subscriptions",
    content: "AWS Production Cloud Hosting recurring invoice due.",
    source: "billing:invoice_aws_9",
    confidence: 0.99,
    consent_scope: "briefing:allowed",
    retention_policy: "retain_indefinitely",
    metadata: {
      service: "AWS Hosting",
      amount: "$342.10",
      due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Due in 24h
    },
  });

  const weather1 = engine.insertMemory({
    category: "documents",
    content: "Heavy rain and thunderstorms expected this afternoon from 2:00 PM.",
    source: "weather:meteo_alert",
    confidence: 0.88,
    consent_scope: "briefing:allowed",
    retention_policy: "ttl_days",
  });

  const friction1 = engine.insertMemory({
    category: "recurring_problems",
    content: "Severe 35-minute bottleneck on downtown highway bridge due to construction.",
    source: "telemetry:commute_tracker",
    confidence: 0.85,
    consent_scope: "briefing:allowed",
    retention_policy: "rolling_compaction",
  });

  const allMemories = [ev1, task1, comm1, bill1, weather1, friction1];

  // Compile morning briefing
  const compiler = new DailyBriefingCompiler();
  const morningDate = new Date();
  morningDate.setHours(9, 0, 0, 0); // 9:00 AM morning cadence

  const { briefing, formattedMarkdown } = compiler.compileBriefing(allMemories, morningDate);

  // Check One Best Next Action constraint solver
  assert.ok(briefing.one_best_next_action);
  assert.ok(
    briefing.one_best_next_action.task_name.includes("privacy audit report"),
    "Constraint solver correctly chose privacy audit report based on high focus and imminent deadline"
  );
  assert.equal(briefing.one_best_next_action.energy_match, "HIGH_FOCUS");

  // Validate citations through the Zero-Hallucination Citation Validator
  const validation = DailyBriefingCompiler.validateBriefingCitations(
    formattedMarkdown,
    allMemories
  );

  assert.equal(validation.valid, true, "100% of factual assertions must have valid citations");
  assert.ok(validation.totalCitations >= 5, "Must cite all referenced records");
  assert.equal(validation.invalidCitations.length, 0);
  assert.equal(validation.ungroundedLines.length, 0);

  // Adversarial Check: Corrupt a citation and assert that the validator catches it
  const corruptedMarkdown = formattedMarkdown.replace(
    `[mem:commitments:${task1.memory_id}]`,
    `[mem:commitments:018f0000-0000-7000-8000-000000000000]`
  );
  const corruptValidation = DailyBriefingCompiler.validateBriefingCitations(
    corruptedMarkdown,
    allMemories
  );
  assert.equal(corruptValidation.valid, false, "Corrupted citation must be detected");
  assert.ok(corruptValidation.invalidCitations.length > 0);
});

// -----------------------------------------------------------------------------
// TEST CASE 5: Zero-Trust Human-In-The-Loop (HITL) Side-Effect Gating
// -----------------------------------------------------------------------------
test("5. Side-Effect Gating: unauthorized actuations halted; gated behind TTL tickets and explicit approvals", async () => {
  const gateway = new HITLApprovalGateway();
  let executedAction = false;

  const sampleTool = async () => {
    executedAction = true;
    return { status: "SENT" };
  };

  // 1. Create action proposal
  const { proposal, ticket } = gateway.createProposal({
    target_tool: "send_email",
    parameters: {
      recipient: "board@company.com",
      subject: "Q3 Governance Overview",
    },
    rationale: "Requested by executive leadership in strategy sync.",
    impact_level: "HIGH",
    reversible: false,
    cited_memories: ["[mem:commitments:018f912a-0000-7000-8000-000000000001]"],
  });

  assert.equal(ticket.status, "PENDING");

  // 2. Attempt direct execution without approval -> MUST FAIL
  await assert.rejects(
    async () => {
      await gateway.executeGatedActuation(ticket.ticket_id, sampleTool);
    },
    (err: Error) => {
      assert.ok(err instanceof SecurityGuardrailViolationError);
      assert.ok(err.message.includes("pending human approval"));
      return true;
    },
    "Execution must be strictly refused when ticket is PENDING"
  );
  assert.equal(executedAction, false, "External side effect must NEVER execute autonomously");

  // 3. Test TTL expiration auto-transition
  const expiredGateway = new HITLApprovalGateway();
  const { ticket: expiredTicket } = expiredGateway.createProposal({
    target_tool: "process_payment",
    parameters: { amount: 5000 },
    rationale: "Invoice payment",
    impact_level: "CRITICAL",
    reversible: false,
    cited_memories: [],
  });

  // Manually backdate expiration to simulate TTL lapse
  expiredTicket.expires_at = new Date(Date.now() - 1000).toISOString();

  // Attempting to approve expired ticket -> MUST FAIL and transition to REJECTED_EXPIRED
  assert.throws(
    () => {
      expiredGateway.approveTicket(expiredTicket.ticket_id);
    },
    (err: Error) => {
      assert.ok(err instanceof SecurityGuardrailViolationError);
      assert.ok(err.message.includes("expired"));
      return true;
    }
  );

  const checkedTicket = expiredGateway.getTicket(expiredTicket.ticket_id);
  assert.equal(checkedTicket?.status, "REJECTED_EXPIRED");

  // 4. Legitimate Out-Of-Band Approval Flow
  const approvedTicket = gateway.approveTicket(ticket.ticket_id, "user:kashif_cli");
  assert.equal(approvedTicket.status, "APPROVED");

  // Now execute actuation -> MUST SUCCEED
  const execResult = await gateway.executeGatedActuation(ticket.ticket_id, sampleTool);
  assert.deepEqual(execResult, { status: "SENT" });
  assert.equal(executedAction, true, "Tool executed upon legitimate cryptographic authorization");

  // 5. Replay Attack Prevention: Attempting to re-execute the same ticket must fail
  await assert.rejects(
    async () => {
      await gateway.executeGatedActuation(ticket.ticket_id, sampleTool);
    },
    (err: Error) => {
      assert.ok(err instanceof SecurityGuardrailViolationError);
      assert.ok(err.message.includes("already been executed"));
      return true;
    },
    "Replay execution with the same ticket ID must be rejected"
  );
});

// -----------------------------------------------------------------------------
// TEST CASE 6: Sovereign Cloud Egress Prevention & Zero Network Sockets
// -----------------------------------------------------------------------------
test("6. Cloud Egress Prevention: zero outbound sockets opened when cloud opt-in is false", async () => {
  let socketAttemptCount = 0;

  // Intercept net.connect to catch any raw TCP socket attempts
  const originalConnect = net.connect;
  const originalHttp = http.request;
  const originalHttps = https.request;

  net.connect = function (...args: any[]) {
    socketAttemptCount++;
    throw new Error("Network egress violation: raw TCP socket forbidden!");
  } as any;

  http.request = function (...args: any[]) {
    socketAttemptCount++;
    throw new Error("Network egress violation: HTTP request forbidden!");
  } as any;

  https.request = function (...args: any[]) {
    socketAttemptCount++;
    throw new Error("Network egress violation: HTTPS request forbidden!");
  } as any;

  try {
    const embeddings = new EmbeddingManager({ optIn: false });

    // Execute local embedding for several texts
    const res1 = await embeddings.generateEmbedding("Commute route planning via train", "routines");
    const res2 = await embeddings.generateEmbedding("Weekly grocery logistics budget", "preferences");

    assert.equal(res1.isLocal, true);
    assert.equal(res2.isLocal, true);
    assert.equal(res1.dimensions, 384);
    assert.equal(res2.dimensions, 384);

    // Compute cosine similarity locally
    const sim = embeddings.cosineSimilarity(res1.embedding, res2.embedding);
    assert.ok(typeof sim === "number" && sim >= 0.0 && sim <= 1.0);

    // Assert that zero network sockets were attempted
    assert.equal(socketAttemptCount, 0, "Zero outbound network sockets must be created during local inference");

    // Attempt to force cloud transmission with opt-in disabled -> MUST THROW CloudEgressBlockedError
    await assert.rejects(
      async () => {
        await embeddings.generateEmbedding("Confidential strategic goal", "projects", true);
      },
      (err: Error) => {
        assert.ok(err instanceof CloudEgressBlockedError);
        assert.ok(err.message.includes("disabled by default"));
        return true;
      }
    );

    // Enable cloud opt-in, but test restricted tier boundary: health_notes without secondary token
    embeddings.setCloudOptIn({ optIn: true });

    await assert.rejects(
      async () => {
        await embeddings.generateEmbedding("Restricted medical therapy note", "health_notes", true);
      },
      (err: Error) => {
        assert.ok(err instanceof CloudEgressBlockedError);
        assert.ok(err.message.includes("Restricted category 'health_notes' is prohibited"));
        return true;
      }
    );

    // Test PII scrubber
    const rawTextWithPii = "Contact patient Alice at alice@clinic.org or call 555-019-2834, SSN 123-45-6789, card 4111-2222-3333-4444.";
    const { scrubbedText, redactedCount, redactedTypes } = embeddings.scrubPii(rawTextWithPii);

    assert.ok(!scrubbedText.includes("alice@clinic.org"));
    assert.ok(!scrubbedText.includes("555-019-2834"));
    assert.ok(!scrubbedText.includes("123-45-6789"));
    assert.ok(!scrubbedText.includes("4111-2222-3333-4444"));

    assert.ok(scrubbedText.includes("[REDACTED_EMAIL]"));
    assert.ok(scrubbedText.includes("[REDACTED_PHONE]"));
    assert.ok(scrubbedText.includes("[REDACTED_SSN]"));
    assert.ok(scrubbedText.includes("[REDACTED_CARD]"));
    assert.equal(redactedCount, 4);
    assert.ok(redactedTypes.includes("email"));
  } finally {
    // Restore network stubs
    net.connect = originalConnect;
    http.request = originalHttp;
    https.request = originalHttps;
  }
});

// -----------------------------------------------------------------------------
// TEST CASE 7: Weekly Review & Friction Pattern Synthesis
// -----------------------------------------------------------------------------
test("7. Weekly Review Engine: synthesizes work completion, overdue milestones, and opt-in automation proposals", async () => {
  const { engine } = createTestSystem();

  const p1 = engine.insertMemory({
    category: "projects",
    content: "Ship Phase 1 telemetry ingestion daemon",
    source: "user:direct_input",
    confidence: 0.95,
    consent_scope: "briefing:allowed",
    retention_policy: "retain_indefinitely",
    metadata: { status: "completed" },
  });

  const p2 = engine.insertMemory({
    category: "projects",
    content: "Implement automated cloud migration pipeline",
    source: "user:direct_input",
    confidence: 0.90,
    consent_scope: "briefing:allowed",
    retention_policy: "retain_indefinitely",
    metadata: {
      status: "in_progress",
      due_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days overdue
    },
  });

  const sub1 = engine.insertMemory({
    category: "subscriptions",
    content: "Figma Organization seat renewal upcoming",
    source: "billing:figma",
    confidence: 0.95,
    consent_scope: "briefing:allowed",
    retention_policy: "retain_indefinitely",
  });

  // Log recurring friction point (occurred 3 times)
  const fric1 = engine.insertMemory({
    category: "recurring_problems",
    content: "Manual time-zone conversion friction scheduling external meetings",
    source: "user:direct_input",
    confidence: 0.95,
    consent_scope: "briefing:allowed",
    retention_policy: "rolling_compaction",
    metadata: {
      problem_pattern: "manual_timezone_coordination",
      occurrences: 3,
    },
  });

  const allMems = [p1, p2, sub1, fric1];
  const weeklyEngine = new WeeklyReviewEngine();
  const { review, formattedMarkdown } = weeklyEngine.compileWeeklyReview(allMems, new Date());

  assert.equal(review.work_completed_vs_planned.completed, 1);
  assert.equal(review.work_completed_vs_planned.planned, 2);

  assert.equal(review.overdue_milestones.length, 1);
  assert.ok(review.overdue_milestones[0].milestone.includes("migration pipeline"));
  assert.equal(review.overdue_milestones[0].days_overdue, 3);

  assert.equal(review.opt_in_automation_proposals.length, 1);
  assert.equal(review.opt_in_automation_proposals[0].problem_pattern, "manual_timezone_coordination");
  assert.equal(review.opt_in_automation_proposals[0].occurrence_count, 3);
  assert.ok(formattedMarkdown.includes("[mem:recurring_problems:"));
});
