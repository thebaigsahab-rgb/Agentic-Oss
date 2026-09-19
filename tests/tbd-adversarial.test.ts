import assert from "node:assert/strict";
import test from "node:test";
import {
  DemonstrationRecorder,
  HitlCompiler,
  DriftDetector,
  AuditLogger,
  SkillExecutor,
  SkillRegistry,
  SkillOptimizer,
  SecurityViolationError,
  SkillRevokedError,
  computePerceptualHash,
  type TargetEnvironmentAdapter,
  type TargetGroundingCandidate,
  type CompiledSkill,
  type SkillDraft,
} from "../src/runtime/tbd";

// Deterministic Test Adapter implementing TargetEnvironmentAdapter
class MockUiAdapter implements TargetEnvironmentAdapter {
  public currentUrl: string = "https://example.com/app";
  public elements: TargetGroundingCandidate[] = [];
  public visibleText: string = "Welcome to Enterprise App";
  public clicksRecorded: string[] = [];
  public textEntriesRecorded: Array<{ elementId: string; text: string; masked?: boolean }> = [];
  public navigationsRecorded: string[] = [];
  public fileSystem: Map<string, string> = new Map();

  getCurrentUrl(): string {
    return this.currentUrl;
  }

  getCurrentElements(): TargetGroundingCandidate[] {
    return this.elements;
  }

  checkElementExists(selector: string): boolean {
    if (selector === "body" || selector === "html") return true;
    return this.elements.some((e) => e.domSelector === selector || e.xpath === selector);
  }

  checkFileExists(path: string): boolean {
    return this.fileSystem.has(path);
  }

  getVisibleText(): string {
    return this.visibleText;
  }

  async navigate(url: string): Promise<void> {
    this.currentUrl = url;
    this.navigationsRecorded.push(url);
  }

  async click(element: TargetGroundingCandidate): Promise<void> {
    this.clicksRecorded.push(element.elementId);
  }

  async type(element: TargetGroundingCandidate, text: string, masked?: boolean): Promise<void> {
    this.textEntriesRecorded.push({ elementId: element.elementId, text, masked });
    element.visibleText = text;
    this.visibleText += " " + text;
  }

  async select(element: TargetGroundingCandidate, value: string): Promise<void> {
    this.textEntriesRecorded.push({ elementId: element.elementId, text: value });
  }

  async waitForCondition(_condition: string, _timeoutMs: number): Promise<boolean> {
    return true;
  }

  captureState(): { url: string; domHtml: string } {
    return {
      url: this.currentUrl,
      domHtml: `<div>${this.visibleText}</div>`,
    };
  }
}

const HMAC_TEST_KEY = "test_super_secret_audit_key_32bytes_long!";

// Helper to create a verified compiled test skill
function createTestSkill(overrides?: Partial<CompiledSkill>): CompiledSkill {
  const recorder = new DemonstrationRecorder("Test Skill Session");
  recorder.start();
  recorder.recordNavigation("https://example.com/dashboard");
  recorder.recordTextInput({
    text: "alice@example.com",
    domTarget: {
      tagName: "input",
      cssSelector: "input#recipientEmail",
      xpath: "//input[@id='recipientEmail']",
      ariaRole: "textbox",
      ariaName: "Recipient Email",
      boundingBox: { x: 100, y: 100, width: 250, height: 40 },
    },
  });
  recorder.recordMouseClick({
    x: 100,
    y: 180,
    domTarget: {
      tagName: "button",
      cssSelector: "button#submitForm",
      xpath: "//button[@id='submitForm']",
      ariaRole: "button",
      ariaName: "Submit Form",
      boundingBox: { x: 100, y: 180, width: 120, height: 40 },
    },
    visualSnippet: "<button id='submitForm'>Submit Form</button>",
  });
  const session = recorder.stop();

  const draft = HitlCompiler.compileDemonstrationToDraft(session, {
    skillName: "Send Notification Routine",
  });

  const verifiedSkill = HitlCompiler.verifyAndSignSkillDraft(
    draft,
    {
      operatorId: "senior_eng_kashif",
      decision: "APPROVE",
      reviewNotes: "Verified parameters and risk tiers.",
      confirmedParameters: draft.parameters,
    },
    HMAC_TEST_KEY
  );

  return { ...verifiedSkill, ...overrides };
}

// ============================================================================
// Adversarial & Verification Matrix
// ============================================================================

test("1. UI Drift Enforcement: Halts immediately with UI_DRIFT_DETECTED and zero clicks executed", async () => {
  const auditLogger = new AuditLogger();
  const adapter = new MockUiAdapter();
  const skill = createTestSkill();

  const emailNode = skill.ast.find((n) => n.actionType === "TYPE")!;
  const emailHash = emailNode.targets.visualAnchor.perceptualHash;
  const clickNode = skill.ast.find((n) => n.actionType === "CLICK")!;
  clickNode.governance.requiresExplicitApproval = false;

  // Simulate an interface redesign:
  // The original target was button#submitForm, but after redesign it's completely missing
  // or has drastically altered structure and orthogonal visual hash
  adapter.elements = [
    {
      elementId: "elem_email_input",
      domSelector: "input#recipientEmail",
      xpath: "//input[@id='recipientEmail']",
      ariaRole: "textbox",
      ariaName: "Recipient Email",
      perceptualHash: emailHash,
      boundingBox: { x: 100, y: 100, width: 250, height: 40 },
      visibleText: "",
    },
    {
      elementId: "elem_nav_home",
      domSelector: "a.nav-home",
      xpath: "//a[contains(@class,'nav-home')]",
      ariaRole: "link",
      ariaName: "Home Page",
      perceptualHash: "ffffffffffffffff", // completely orthogonal hash
      boundingBox: { x: 10, y: 10, width: 80, height: 30 },
      visibleText: "Home",
    },
    {
      elementId: "elem_random_card",
      domSelector: "div.card",
      xpath: "//div[@class='card']",
      ariaRole: "region",
      ariaName: "News Feed",
      perceptualHash: "aaaaaaaaaaaaaaaa",
      boundingBox: { x: 400, y: 200, width: 300, height: 200 },
      visibleText: "Breaking News",
    },
  ];

  const executor = new SkillExecutor({ skill, adapter, auditLogger });
  const result = await executor.executeLive({ email_recipient_1: "test@domain.com" });

  assert.equal(result.success, false);
  assert.equal(result.state, "ABORTED_DRIFT");
  // INVARIANT: Zero clicks performed on the drifted interface!
  assert.equal(adapter.clicksRecorded.length, 0);

  // Assert UI_DRIFT_DETECTED event was appended to audit trail
  const driftAudit = auditLogger.getEntries().find((e) => e.eventType === "UI_DRIFT_DETECTED");
  assert.ok(driftAudit, "UI_DRIFT_DETECTED must be written to audit trail");
  assert.equal(driftAudit.payload.code, "UI_DRIFT_DETECTED");
});

test("2. Anti-Guessing Ambiguity Test: Halts when two elements have overlapping confidence (Δ < 0.10)", async () => {
  const auditLogger = new AuditLogger();
  const adapter = new MockUiAdapter();
  const skill = createTestSkill();

  const emailNode = skill.ast.find((n) => n.actionType === "TYPE")!;
  const emailHash = emailNode.targets.visualAnchor.perceptualHash;

  // Identify the target button node in the skill
  const clickNode = skill.ast.find((n) => n.actionType === "CLICK")!;
  clickNode.governance.requiresExplicitApproval = false;
  const targetHash = clickNode.targets.visualAnchor.perceptualHash;

  // Inject email field plus two near-identical competing buttons with matching text and visual hashes
  adapter.elements = [
    {
      elementId: "elem_email_input",
      domSelector: "input#recipientEmail",
      xpath: "//input[@id='recipientEmail']",
      ariaRole: "textbox",
      ariaName: "Recipient Email",
      perceptualHash: emailHash,
      boundingBox: { x: 100, y: 100, width: 250, height: 40 },
      visibleText: "",
    },
    {
      elementId: "btn_competing_primary",
      domSelector: "button#submitFormPrimary",
      xpath: "//button[@id='submitFormPrimary']",
      ariaRole: "button",
      ariaName: "Submit Form",
      perceptualHash: targetHash,
      boundingBox: { x: 100, y: 180, width: 120, height: 40 },
      visibleText: "Submit Form",
    },
    {
      elementId: "btn_competing_secondary",
      domSelector: "button#submitFormSecondary",
      xpath: "//button[@id='submitFormSecondary']",
      ariaRole: "button",
      ariaName: "Submit Form",
      perceptualHash: targetHash,
      boundingBox: { x: 250, y: 180, width: 120, height: 40 },
      visibleText: "Submit Form",
    },
  ];

  const executor = new SkillExecutor({ skill, adapter, auditLogger });
  const result = await executor.executeLive({ email_recipient_1: "test@domain.com" });

  assert.equal(result.success, false);
  assert.equal(result.state, "ABORTED_DRIFT");
  // Anti-guessing rule: never guess between ambiguous candidates
  assert.equal(adapter.clicksRecorded.length, 0);

  const driftAudit = auditLogger.getEntries().find((e) => e.eventType === "UI_DRIFT_DETECTED");
  assert.ok(driftAudit);
  assert.equal(driftAudit.payload.code, "AMBIGUOUS_TARGET_DETECTED");
});

test("3. Parameter Injection Defense: Malicious payloads are strictly treated as literal strings", async () => {
  const auditLogger = new AuditLogger();
  const adapter = new MockUiAdapter();
  const skill = createTestSkill();

  // Setup matching elements for normal execution
  const emailNode = skill.ast.find((n) => n.actionType === "TYPE")!;
  const emailHash = emailNode.targets.visualAnchor.perceptualHash;
  const clickNode = skill.ast.find((n) => n.actionType === "CLICK")!;
  const clickHash = clickNode.targets.visualAnchor.perceptualHash;

  adapter.elements = [
    {
      elementId: "elem_email_input",
      domSelector: "input#recipientEmail",
      xpath: "//input[@id='recipientEmail']",
      ariaRole: "textbox",
      ariaName: "Recipient Email",
      perceptualHash: emailHash,
      boundingBox: { x: 100, y: 100, width: 250, height: 40 },
      visibleText: "",
    },
    {
      elementId: "elem_submit_btn",
      domSelector: "button#submitForm",
      xpath: "//button[@id='submitForm']",
      ariaRole: "button",
      ariaName: "Submit Form",
      perceptualHash: clickHash,
      boundingBox: { x: 100, y: 180, width: 120, height: 40 },
      visibleText: "Submit Form",
    },
  ];

  // Malicious prompt-injection & SQL & shell injection payload
  const injectionPayload = "'; DROP TABLE users; -- <script>alert('xss')</script> $(rm -rf /) `whoami`";

  clickNode.governance.requiresExplicitApproval = false;
  const executor = new SkillExecutor({ skill, adapter, auditLogger });
  const result = await executor.executeLive({
    email_recipient_1: injectionPayload,
  });

  assert.equal(result.success, true);
  assert.equal(result.state, "COMPLETED");

  // Verify that the payload was passed strictly as a literal text string to the UI adapter
  const typedEntry = adapter.textEntriesRecorded.find((t) => t.elementId === "elem_email_input");
  assert.ok(typedEntry);
  assert.equal(typedEntry.text, injectionPayload);
  // Zero shell execution, zero code evaluation
});

test("4. Rollback Activation on Postcondition Failure: Transitions to FAILED_COMPENSATED and fires rollbackAction", async () => {
  const auditLogger = new AuditLogger();
  const adapter = new MockUiAdapter();
  const skill = createTestSkill();

  // Configure target elements
  const emailNode = skill.ast.find((n) => n.actionType === "TYPE")!;
  const clickNode = skill.ast.find((n) => n.actionType === "CLICK")!;
  clickNode.governance.requiresExplicitApproval = false;

  adapter.elements = [
    {
      elementId: "elem_email_input",
      domSelector: "input#recipientEmail",
      xpath: "//input[@id='recipientEmail']",
      ariaRole: "textbox",
      ariaName: "Recipient Email",
      perceptualHash: emailNode.targets.visualAnchor.perceptualHash,
      boundingBox: { x: 100, y: 100, width: 250, height: 40 },
      visibleText: "",
    },
    {
      elementId: "elem_submit_btn",
      domSelector: "button#submitForm",
      xpath: "//button[@id='submitForm']",
      ariaRole: "button",
      ariaName: "Submit Form",
      perceptualHash: clickNode.targets.visualAnchor.perceptualHash,
      boundingBox: { x: 100, y: 180, width: 120, height: 40 },
      visibleText: "Submit Form",
    },
  ];

  // Add an unsatisfied postcondition to the click node (e.g. expected modal to show confirmation message)
  clickNode.guards.postconditions = [
    { type: "VISIBLE_TEXT", expected: "SUCCESS_NOTIFICATION_MODAL_SHOWN" },
  ];

  const executor = new SkillExecutor({ skill, adapter, auditLogger });
  const result = await executor.executeLive({ email_recipient_1: "user@example.com" });

  // Execution must fail and activate rollback compensation
  assert.equal(result.success, false);
  assert.equal(result.state, "FAILED_COMPENSATED");

  // The email typing node had a rollback action configured (to clear the field with "")
  const rollbackEntries = adapter.textEntriesRecorded.filter((t) => t.elementId === "elem_email_input");
  assert.ok(rollbackEntries.length >= 2, "Expected initial type followed by rollback type");
  assert.equal(rollbackEntries[rollbackEntries.length - 1].text, ""); // Cleared on rollback

  // Rollback event recorded in audit log
  const rollbackAudit = auditLogger.getEntries().find((e) => e.eventType === "ROLLBACK_TRIGGERED");
  assert.ok(rollbackAudit, "ROLLBACK_TRIGGERED event must be recorded");
});

test("5. Unauthorized Self-Modification Rejection: Direct modification throws SecurityViolationError and logs audit alert", async () => {
  const auditLogger = new AuditLogger();
  const optimizer = new SkillOptimizer(auditLogger);
  const skill = createTestSkill();

  // Attempt internal method to directly update skill definition from trace
  assert.throws(
    () => {
      optimizer.attemptAutonomousSkillMutation(skill, {
        actionType: "CLICK",
        governance: { riskLevel: "LOW", requiresExplicitApproval: false },
      });
    },
    (err: unknown) => {
      return (
        err instanceof SecurityViolationError &&
        err.code === "SECURITY_VIOLATION_AUTONOMOUS_MUTATION_BLOCKED" &&
        err.message.includes("Agent self-modification is strictly forbidden")
      );
    }
  );

  // Security alert emitted in audit trail
  const alertAudit = auditLogger.getEntries().find((e) => e.eventType === "UNAUTHORIZED_MODIFICATION_BLOCKED");
  assert.ok(alertAudit, "Audit trail must capture UNAUTHORIZED_MODIFICATION_BLOCKED event");
  assert.equal(alertAudit.actor, "system:autonomous-optimizer");
});

test("6. Dry-Run Non-Invasiveness: Destructive action in dry-run leaves DOM & state untouched while generating manifest", async () => {
  const auditLogger = new AuditLogger();
  const adapter = new MockUiAdapter();
  adapter.fileSystem.set("C:/critical/database.sqlite", "ACTIVE_DATA");

  // Create a destructive skill definition (File deletion / Drop action)
  const destructiveSkill: CompiledSkill = {
    skillId: "skill_destructive_cleanup",
    name: "Purge Database Cache",
    version: "1.0.0",
    contentHash: "abcdef1234567890",
    ast: [
      {
        stepId: "step_purge_1",
        actionType: "CLICK",
        targets: {
          cssSelector: "button#purgeDatabase",
          visualAnchor: {
            perceptualHash: "1111222233334444",
            boundingBox: { x: 50, y: 50, width: 100, height: 30 },
            referenceScreenshotPath: "",
          },
        },
        guards: {
          preconditions: [{ type: "FILE_EXISTS", expression: "C:/critical/database.sqlite" }],
          postconditions: [],
          timeoutMs: 5000,
        },
        governance: {
          riskLevel: "CRITICAL",
          requiresExplicitApproval: true,
        },
      },
    ],
    parameters: {
      title: "PurgeParams",
      type: "object",
      properties: {},
      required: [],
    },
    verification: {
      verifiedBy: "lead_architect",
      verifiedAt: Date.now(),
      hmacSignature: "valid_signature",
      reviewNotes: "Approved with approval gate.",
    },
    status: "ACTIVE",
    testFixture: { domFixtures: {}, baselineVisuals: {}, mockEnvironment: {}, testPayloads: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const executor = new SkillExecutor({ skill: destructiveSkill, adapter, auditLogger });
  const manifest = await executor.simulateDryRun();

  // Manifest assertions
  assert.equal(manifest.dryRun, true);
  assert.equal(manifest.projectedSteps.length, 1);
  assert.equal(manifest.projectedSteps[0].riskLevel, "CRITICAL");
  assert.equal(manifest.requiredApprovalGates.includes("step_purge_1"), true);
  assert.equal(manifest.preconditionChecks[0].satisfied, true);

  // INVARIANT: State and filesystem remain untouched
  assert.equal(adapter.clicksRecorded.length, 0);
  assert.equal(adapter.fileSystem.get("C:/critical/database.sqlite"), "ACTIVE_DATA");
});

test("7. Ingestion Sanitization: Redacts credentials, tokens, and credit cards from raw demonstration stream", () => {
  const recorder = new DemonstrationRecorder("Secure Ingestion Session");
  recorder.start();

  // 1. Password input
  const pwEvent = recorder.recordTextInput({
    text: "MySecretPassword123!",
    isPassword: true,
  });
  assert.equal(pwEvent.keyboard?.value, "[REDACTED_SECRET]");
  assert.equal(pwEvent.keyboard?.isPassword, true);

  // 2. Bearer token input
  const tokenEvent = recorder.recordTextInput({
    text: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMC6Y5",
  });
  assert.equal(tokenEvent.keyboard?.value, "[REDACTED_AUTH_TOKEN]");

  // 3. Credit card input
  const ccEvent = recorder.recordTextInput({
    text: "4532 0150 1234 5678",
  });
  assert.equal(ccEvent.keyboard?.value, "[REDACTED_PAYMENT_CARD]");

  const session = recorder.stop();
  assert.equal(session.events.length, 3);
  for (const ev of session.events) {
    assert.equal(ev.sanitized, true);
  }
});

test("8. HITL Gating: Rejects unreviewed draft compilation; HMAC verification validates signed skill", () => {
  const recorder = new DemonstrationRecorder("Unreviewed Session");
  recorder.start();
  recorder.recordNavigation("https://example.com");
  const session = recorder.stop();

  const draft = HitlCompiler.compileDemonstrationToDraft(session);
  assert.equal(draft.status, "PENDING_REVIEW");

  // Attempting to compile with rejection decision throws
  assert.throws(() => {
    HitlCompiler.verifyAndSignSkillDraft(
      draft,
      {
        operatorId: "operator_1",
        decision: "REJECT",
        reviewNotes: "Brittle selectors identified.",
        confirmedParameters: draft.parameters,
      },
      HMAC_TEST_KEY
    );
  }, /Cannot compile skill draft/);

  // Approved decision succeeds and creates HMAC signature
  const verified = HitlCompiler.verifyAndSignSkillDraft(
    draft,
    {
      operatorId: "senior_eng_kashif",
      decision: "APPROVE",
      reviewNotes: "All gates verified.",
      confirmedParameters: draft.parameters,
    },
    HMAC_TEST_KEY
  );

  assert.equal(verified.status, "ACTIVE");
  assert.ok(verified.verification.hmacSignature);
  assert.equal(HitlCompiler.verifyCompiledSkillSignature(verified, HMAC_TEST_KEY), true);
  assert.equal(HitlCompiler.verifyCompiledSkillSignature(verified, "wrong_secret_key"), false);
});

test("9. Tamper-Evident Audit Trail: Detects broken chain link or modified entry", () => {
  const auditLogger = new AuditLogger();

  auditLogger.append({
    eventType: "DEMONSTRATION_RECORDED",
    actor: "user",
    payload: { action: "start" },
  });
  auditLogger.append({
    eventType: "SKILL_DRAFT_CREATED",
    actor: "compiler",
    payload: { draftId: "draft_123" },
  });
  auditLogger.append({
    eventType: "SKILL_VERIFIED",
    actor: "senior_eng",
    payload: { approved: true },
  });

  // Verify untampered integrity
  let check = auditLogger.verifyChainIntegrity();
  assert.equal(check.valid, true);

  // Simulate adversary tampering with a record payload in the audit log
  const rawEntries = (auditLogger as unknown as { log: Array<{ payload: Record<string, unknown> }> }).log;
  rawEntries[1].payload = { draftId: "MALICIOUS_SUBSTITUTED_DRAFT" };

  // Re-verify: must catch tampering
  check = auditLogger.verifyChainIntegrity();
  assert.equal(check.valid, false);
  assert.equal(check.corruptedAtIndex, 1);
  assert.ok(check.error?.includes("Tampered hash at index 1"));
});

test("10. Skill Registry SemVer & Revocation: Rejects illegal version bumps and blocks execution of TOMBSTONED skills", async () => {
  const auditLogger = new AuditLogger();
  const registry = new SkillRegistry(auditLogger);
  const skill = createTestSkill({ version: "1.0.0" });

  registry.registerSkill(skill);
  assert.equal(registry.getSkill(skill.skillId).version, "1.0.0");

  // Attempting to register an update with changed required parameters under a PATCH version throws SemVer error
  const invalidPatchSkill: CompiledSkill = {
    ...skill,
    version: "1.0.1",
    parameters: {
      ...skill.parameters,
      properties: {
        ...skill.parameters.properties,
        new_critical_param: {
          name: "new_critical_param",
          type: "string",
          description: "Required param",
          required: true,
        },
      },
      required: [...skill.parameters.required, "new_critical_param"],
    },
  };

  assert.throws(() => {
    registry.registerSkill(invalidPatchSkill);
  }, /SemVer violation: Changes in parameters, preconditions, or approvals require a MAJOR version bump/);

  // Revocation: Tombstones skill
  registry.revokeSkill(skill.skillId, "security_team", "Potential vulnerability discovered");

  assert.throws(() => {
    registry.getSkill(skill.skillId);
  }, (err: unknown) => err instanceof SkillRevokedError);

  // Executor blocks execution of tombstoned skill
  const adapter = new MockUiAdapter();
  const executor = new SkillExecutor({ skill, adapter, auditLogger });
  executor.revoke();

  await assert.rejects(async () => {
    await executor.executeLive();
  }, /is TOMBSTONED and cannot be executed/);
});

test("11. Interactive Control Plane: APPROVE unblocks approval gates; PAUSE and CANCEL lifecycle controls", async () => {
  const auditLogger = new AuditLogger();
  const adapter = new MockUiAdapter();
  const skill = createTestSkill();

  // Set explicit approval requirement on click step
  const clickNode = skill.ast.find((n) => n.actionType === "CLICK")!;
  clickNode.governance.requiresExplicitApproval = true;

  // Set up elements
  const emailNode = skill.ast.find((n) => n.actionType === "TYPE")!;
  adapter.elements = [
    {
      elementId: "elem_email_input",
      domSelector: "input#recipientEmail",
      xpath: "//input[@id='recipientEmail']",
      ariaRole: "textbox",
      ariaName: "Recipient Email",
      perceptualHash: emailNode.targets.visualAnchor.perceptualHash,
      boundingBox: { x: 100, y: 100, width: 250, height: 40 },
      visibleText: "",
    },
    {
      elementId: "elem_submit_btn",
      domSelector: "button#submitForm",
      xpath: "//button[@id='submitForm']",
      ariaRole: "button",
      ariaName: "Submit Form",
      perceptualHash: clickNode.targets.visualAnchor.perceptualHash,
      boundingBox: { x: 100, y: 180, width: 120, height: 40 },
      visibleText: "Submit Form",
    },
  ];

  const executor = new SkillExecutor({ skill, adapter, auditLogger });

  // First run: should pause at PENDING_APPROVAL
  const firstRun = await executor.executeLive({ email_recipient_1: "approved@example.com" });
  assert.equal(firstRun.success, false);
  assert.equal(firstRun.state, "PENDING_APPROVAL");
  assert.equal(adapter.clicksRecorded.length, 0); // Click not executed yet

  // Operator approves the step via control plane
  executor.approve(clickNode.stepId, "operator_kashif");

  // Second run: resumes and completes
  const secondRun = await executor.executeLive({ email_recipient_1: "approved@example.com" });
  assert.equal(secondRun.success, true);
  assert.equal(secondRun.state, "COMPLETED");
  assert.equal(adapter.clicksRecorded.length, 1);
});
