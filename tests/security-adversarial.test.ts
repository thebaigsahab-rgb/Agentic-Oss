import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "data:text/javascript,export {};") return { format: "commonjs", source: "module.exports = {};", shortCircuit: true };
    return nextLoad(url, context);
  },
});

import {
  constantTimeCompare,
} from "../lib/security/crypto";
import {
  createSession,
  verifySessionToken,
  createLocalAdminSession,
  SESSION_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../lib/security/session";
import {
  initiatePairing,
  consumePairingToken,
  resetPairingState,
} from "../lib/security/pairing";
import {
  COMMAND_CATALOG,
  validateArgument,
  containsShellMetacharacters,
  runCatalogJob,
} from "../lib/security/catalog";
import {
  createApprovalRequest,
  resolveApprovalRequest,
  verifyAndConsumeTicket,
  resetApprovalState,
} from "../lib/security/approval";
import {
  triggerGlobalLockdown,
  resetGlobalLockdown,
  isSystemLockedDown,
  logAuditEvent,
  verifyAuditLogIntegrity,
  resetAuditLog,
  getRecentAuditLogs,
} from "../lib/security/panic";

let systemPost: (request: Request) => Promise<Response>;
let systemGet: (request: Request) => Promise<Response>;
let remotePost: (request: Request) => Promise<Response>;

test.before(async () => {
  const sys = await import("../app/api/system/route");
  systemPost = sys.POST;
  systemGet = sys.GET;
  const rem = await import("../app/api/remote/route");
  remotePost = rem.POST;
});

// =============================================================================
// ADVERSARIAL ATTACK TEST 1: Direct Takeover Exploit
// Attacker sends { inputMode: "takeover" } on /api/system without valid auth.
// Expects: 401 Unauthorized or 403 Forbidden.
// =============================================================================

test("Attack Vector 1: Direct Takeover Exploit is rejected without authentication", async () => {
  // Remote untrusted attacker sends inputMode: 'takeover' to /api/system
  const req = new Request("http://192.168.1.100:3000/api/system", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "192.168.1.100:3000",
    },
    body: JSON.stringify({
      inputMode: "takeover",
      action: "move_mouse",
      x: 500,
      y: 500,
    }),
  });

  const res = await systemPost(req);
  assert.equal(res.status, 401, "Unauthenticated remote takeover must return 401 Unauthorized");
  const data = await res.json();
  assert.equal(data.ok, false);
});

test("Attack Vector 1b: Takeover attempt by authenticated remote client without HITL approval ticket is rejected", async () => {
  // Remote client has valid session, but only 'routine-only' role
  const { token, csrfToken } = await createSession({
    deviceId: "remote-attacker-phone",
    role: "routine-only",
    isLocalLoopback: false,
  });

  const req = new Request("http://192.168.1.100:3000/api/system", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "192.168.1.100:3000",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: csrfToken,
    },
    body: JSON.stringify({
      inputMode: "takeover", // Attacker claims takeover
      action: "move_mouse",
      x: 300,
      y: 400,
    }),
  });

  const res = await systemPost(req);
  assert.equal(res.status, 403, "Routine-only client cannot hijack GUI; must return 403 Forbidden");
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /lacks computer-control capability/i);
});

// =============================================================================
// ADVERSARIAL ATTACK TEST 2: Token Replay Attack
// Re-submitting a consumed or expired pairing QR token.
// Expects: 400 Bad Request or 401 Unauthorized.
// =============================================================================

test("Attack Vector 2: Re-submitting a consumed pairing token (replay attack) is rejected", async () => {
  resetPairingState();

  const pairing = await initiatePairing({ role: "routine-only" });

  // 1. First legitimate consumption
  const firstConsume = await consumePairingToken({
    pairingId: pairing.pairingId,
    rawToken: pairing.rawToken,
    pin: pairing.pin,
    deviceName: "Legitimate Smartphone",
  });
  assert.ok(firstConsume.sessionToken, "First consumption must succeed");

  // 2. Attacker replays identical credentials
  await assert.rejects(
    async () => {
      await consumePairingToken({
        pairingId: pairing.pairingId,
        rawToken: pairing.rawToken,
        pin: pairing.pin,
        deviceName: "Impersonator Smartphone",
      });
    },
    /already been consumed \(replay attack detected\)/i,
    "Replay attack with consumed pairing token must be rejected"
  );
});

test("Attack Vector 2b: Expired pairing token is rejected at API endpoint", async () => {
  resetPairingState();

  const pairing = await initiatePairing({ role: "routine-only" });

  // Simulate request to POST /api/remote with expired token
  const req = new Request("http://192.168.1.100:3000/api/remote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "pair_consume",
      pairingId: pairing.pairingId,
      rawToken: "wrong_or_expired_token",
      deviceName: "Attacker Phone",
    }),
  });

  const res = await remotePost(req);
  assert.equal(res.status, 400, "Invalid or expired pairing token must return 400");
  const data = await res.json();
  assert.equal(data.ok, false);
});

// =============================================================================
// ADVERSARIAL ATTACK TEST 3: Privilege Escalation
// A client authenticated under 'read-only' issues a POST to trigger desktop routines.
// Expects: 403 Forbidden.
// =============================================================================

test("Attack Vector 3: Client authenticated as 'read-only' is blocked from state mutations", async () => {
  const { token, csrfToken } = await createSession({
    deviceId: "monitor-screen",
    role: "read-only",
    isLocalLoopback: false,
  });

  const req = new Request("http://192.168.1.100:3000/api/system", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "192.168.1.100:3000",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: csrfToken,
    },
    body: JSON.stringify({
      action: "set_volume",
      level: 75,
    }),
  });

  const res = await systemPost(req);
  assert.equal(res.status, 403, "read-only role cannot mutate system state; must return 403");
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /role 'read-only' cannot execute action/i);
});

test("Attack Vector 3b: Client authenticated as 'read-only' CAN query telemetry GET", async () => {
  const { token } = await createSession({
    deviceId: "telemetry-dashboard",
    role: "read-only",
    isLocalLoopback: false,
  });

  const req = new Request("http://192.168.1.100:3000/api/system", {
    method: "GET",
    headers: {
      host: "192.168.1.100:3000",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
  });

  const res = await systemGet(req);
  assert.equal(res.status, 200, "read-only role is permitted to read telemetry");
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.caller.role, "read-only");
});

// =============================================================================
// ADVERSARIAL ATTACK TEST 4: Shell Command Injection
// Passing malicious subshells inside parameters.
// Expects: Schema validation failure before process instantiation.
// =============================================================================

test("Attack Vector 4: Shell command injection payloads fail schema validation", async () => {
  const attackPayloads = [
    "127.0.0.1; rm -rf /",
    "127.0.0.1 && calc.exe",
    "127.0.0.1 | whoami",
    "$(whoami)",
    "`calc.exe`",
    "127.0.0.1 > C:\\pwned.txt",
    "127.0.0.1 < input.txt",
    "127.0.0.1\ncalc.exe",
    "127.0.0.1\r\nrmdir /s /q C:\\",
  ];

  for (const payload of attackPayloads) {
    // 1. Direct metacharacter check
    assert.equal(
      containsShellMetacharacters(payload),
      true,
      `Payload '${payload}' must be recognized as containing shell metacharacters`
    );

    // 2. Catalog schema validation
    const pingDef = COMMAND_CATALOG.system_ping.argsSchema.target;
    const valResult = validateArgument("target", payload, pingDef);
    assert.equal(
      valResult.valid,
      false,
      `Argument validator must reject malicious payload: ${payload}`
    );

    // 3. Isolated Job Runner instantiation attempt
    await assert.rejects(
      async () => {
        await runCatalogJob("system_ping", { target: payload });
      },
      /Catalog argument validation error|contains forbidden shell metacharacters/i,
      `Job runner must abort before spawning for payload: ${payload}`
    );
  }
});

test("Attack Vector 4b: Arbitrary shell execution without allowlisted catalog command is rejected", async () => {
  const { token, csrfToken } = await createSession({
    deviceId: "admin-actor",
    role: "admin",
    isLocalLoopback: false,
  });

  const req = new Request("http://192.168.1.100:3000/api/system", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "192.168.1.100:3000",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: csrfToken,
    },
    body: JSON.stringify({
      action: "execute_command",
      command: "powershell.exe -enc VwByAGkAdABlAC0ASABvAHMAdAAgACIAcAB3AG4AZQBkACIA",
    }),
  });

  const res = await systemPost(req);
  assert.equal(res.status, 403, "Unallowlisted shell commands must be refused with 403");
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /Arbitrary shell interpolation is permanently deprecated/i);
});

// =============================================================================
// ADVERSARIAL ATTACK TEST 5: Forged Approval Ticket
// Injecting pre-approved payload state directly to the job runner.
// Expects: Validation refusal without signed, server-side approval ticket.
// =============================================================================

test("Attack Vector 5: Untrusted browser-supplied boolean approval is rejected", async () => {
  resetApprovalState();

  const { token, csrfToken } = await createSession({
    deviceId: "remote-client-1",
    role: "computer-control",
    isLocalLoopback: false,
  });

  // Attacker sends { approved: true, isApproved: true } in the request body
  const req = new Request("http://192.168.1.100:3000/api/system", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "192.168.1.100:3000",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: csrfToken,
    },
    body: JSON.stringify({
      action: "type_text",
      text: "malicious typed command",
      approved: true, // Untrusted client boolean
      isApproved: true,
      approvalStatus: "APPROVED",
    }),
  });

  const res = await systemPost(req);
  assert.equal(res.status, 403, "Browser-supplied approval booleans must be rejected");
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /HITL Gating Failure/i);
});

test("Attack Vector 5b: Forged cryptographic signature on ApprovalTicket is rejected", () => {
  resetApprovalState();

  const forgedTicket = {
    ticketId: "tkt_forged1234567890",
    requestId: "req_fake",
    actionType: "type_text",
    parametersHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    targetCapability: "computer-control",
    approvedBy: "attacker",
    approvedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    signature: "invalidsignature_base64url_string",
    consumed: false,
  };

  const verifyResult = verifyAndConsumeTicket(forgedTicket, "type_text", { text: "hello" });
  assert.equal(verifyResult.valid, false, "Forged ticket signature must fail verification");
});

test("Attack Vector 5c: Legitimate HITL Approval lifecycle succeeds and blocks replay", async () => {
  resetApprovalState();

  const { session: adminSession } = await createLocalAdminSession();

  // 1. Propose privileged action
  const actionParams = { dx: 10, dy: 20 };
  const approvalReq = await createApprovalRequest({
    deviceId: "remote-device-x",
    targetCapability: "computer-control",
    actionType: "touchpad_move",
    parameters: actionParams,
    description: "Move trackpad cursor",
  });
  assert.equal(approvalReq.status, "PENDING");

  // 2. Admin out-of-band resolution
  const { ticket } = await resolveApprovalRequest({
    requestId: approvalReq.requestId,
    adminSession,
    decision: "APPROVED",
  });
  assert.ok(ticket, "Signed approval ticket must be generated");
  assert.ok(ticket.signature, "Ticket must be signed");

  // 3. First execution consumes ticket successfully
  const consumeResult = verifyAndConsumeTicket(ticket, "touchpad_move", actionParams);
  assert.equal(consumeResult.valid, true, "Valid signed ticket must be accepted");

  // 4. Replay attempt with same ticket is blocked
  const replayResult = verifyAndConsumeTicket(ticket, "touchpad_move", actionParams);
  assert.equal(replayResult.valid, false, "Replayed ticket must be rejected");
  assert.match(replayResult.error || "", /already been consumed/i);
});

// =============================================================================
// ADVERSARIAL ATTACK TEST 6: CSRF & Timing Attacks
// Constant-time hash comparison and CSRF token mismatch rejection.
// =============================================================================

test("Attack Vector 6: Constant-time comparison resists length attacks and verifies matching values", () => {
  const secretA = "super_secret_value_1234567890abcdef";
  const secretB = "super_secret_value_1234567890abcdef";
  const secretWrong = "super_secret_value_1234567890abcdeg";
  const secretShorter = "super_secret_value";

  assert.equal(constantTimeCompare(secretA, secretB), true);
  assert.equal(constantTimeCompare(secretA, secretWrong), false);
  assert.equal(constantTimeCompare(secretA, secretShorter), false);
  assert.equal(constantTimeCompare(secretA, null), false);
  assert.equal(constantTimeCompare(undefined, secretB), false);
});

test("Attack Vector 6b: State-mutating POST with mismatched CSRF token is rejected with 403", async () => {
  const { token, csrfToken } = await createSession({
    deviceId: "browser-client",
    role: "routine-only",
    isLocalLoopback: false,
  });

  // 1. Missing CSRF header
  const reqNoCsrf = new Request("http://192.168.1.100:3000/api/system", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "192.168.1.100:3000",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify({ action: "set_mute", muted: true }),
  });
  const resNoCsrf = await systemPost(reqNoCsrf);
  assert.equal(resNoCsrf.status, 403, "Missing CSRF token must return 403");

  // 2. Forged CSRF header
  const reqForgedCsrf = new Request("http://192.168.1.100:3000/api/system", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "192.168.1.100:3000",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: "forged_anti_csrf_token_value",
    },
    body: JSON.stringify({ action: "set_mute", muted: true }),
  });
  const resForgedCsrf = await systemPost(reqForgedCsrf);
  assert.equal(resForgedCsrf.status, 403, "Mismatched CSRF token must return 403");

  // 3. Valid CSRF header matches session
  const reqValidCsrf = new Request("http://192.168.1.100:3000/api/system", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "192.168.1.100:3000",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: csrfToken,
    },
    body: JSON.stringify({ action: "set_mute", muted: true }),
  });
  const resValidCsrf = await systemPost(reqValidCsrf);
  assert.equal(resValidCsrf.status, 200, "Valid CSRF token must be accepted");
});

// =============================================================================
// ADVERSARIAL ATTACK TEST 7: Tamper-Evident Audit Log Integrity
// Chained hash verification detects retroactive modification of logs.
// =============================================================================

test("Attack Vector 7: Tamper-evident audit log chain detects unauthorized edits", async () => {
  resetAuditLog();

  // Log 3 events
  await logAuditEvent({
    deviceId: "dev_1",
    actorRole: "routine-only",
    targetCapability: "set_volume",
    parametersHash: "hash1",
    approvalStatus: "ROUTINE",
    executionResult: "SUCCESS",
  });

  await logAuditEvent({
    deviceId: "dev_2",
    actorRole: "admin",
    targetCapability: "catalog_routine",
    parametersHash: "hash2",
    approvalStatus: "APPROVED",
    executionResult: "SUCCESS",
  });

  await logAuditEvent({
    deviceId: "dev_3",
    actorRole: "admin",
    targetCapability: "system_ping",
    parametersHash: "hash3",
    approvalStatus: "ROUTINE",
    executionResult: "SUCCESS",
  });

  // Verify untampered chain
  const cleanCheck = verifyAuditLogIntegrity();
  assert.equal(cleanCheck.valid, true, "Clean audit chain must pass integrity check");
  assert.equal(cleanCheck.totalEntries, 3);

  // Attacker covertly modifies entry #1
  const logs = getRecentAuditLogs(10);
  logs[1].executionResult = "TAMPERED_COVERUP";

  // Verify detection
  const tamperedCheck = verifyAuditLogIntegrity();
  assert.equal(tamperedCheck.valid, false, "Tampered audit chain must be detected");
  assert.equal(tamperedCheck.tamperedAt, 1, "Must pinpoint the tampered record index");
});

// =============================================================================
// ADVERSARIAL ATTACK TEST 8: Panic Circuit-Breaker Lockdown
// Emergency switch invalidates sessions and shuts down interfaces.
// =============================================================================

test("Attack Vector 8: Panic circuit-breaker invalidates sessions and rejects API calls", async () => {
  const { token } = await createSession({
    deviceId: "active-user-session",
    role: "admin",
    isLocalLoopback: false,
  });

  // Session is initially valid
  assert.ok(verifySessionToken(token), "Session must be valid prior to lockdown");

  // Trigger emergency panic lockdown
  const lockdownResult = await triggerGlobalLockdown(
    "Intrusion detected: panic test trigger",
    "security-test-harness"
  );
  assert.equal(lockdownResult.lockedDown, true);
  assert.equal(isSystemLockedDown(), true);

  // 1. Session token is immediately invalidated
  assert.equal(verifySessionToken(token), null, "Lockdown must invalidate active sessions");

  // 2. Subsequent requests to /api/system return 503 Locked Down
  const req = new Request("http://127.0.0.1:3000/api/system", { method: "GET" });
  const res = await systemGet(req);
  assert.equal(res.status, 503, "Locked down system must return 503 Service Unavailable");

  // 3. Admin reset restores normal operations
  await resetGlobalLockdown("admin-console");
  assert.equal(isSystemLockedDown(), false);
});
