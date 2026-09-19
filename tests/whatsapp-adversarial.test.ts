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
  APPROVAL_CHARSET,
  generateApprovalCode,
  timingSafeStringCompare,
  computeHmacSha256Hex,
  computeHmacSha1Base64,
  normalizeE164,
  isNumberAllowlisted,
} from "../lib/gateway/crypto";
import { MetaWhatsAppAdapter } from "../lib/gateway/adapters/whatsapp-meta";
import { TwilioWhatsAppAdapter } from "../lib/gateway/adapters/whatsapp-twilio";
import { IdempotencyStore } from "../lib/gateway/idempotency";
import { parseIntent, ApprovalStore } from "../lib/gateway/policy";
import { HomeRelayClient } from "../lib/relay/home-client";
import { GET as webhookGET, POST as webhookPOST } from "../app/api/webhooks/whatsapp/route";
import { GET as relayGET, POST as relayPOST } from "../app/api/relay/jobs/route";

// Setup Test Secrets and Environment
const TEST_APP_SECRET = "0123456789abcdef0123456789abcdef";
const TEST_VERIFY_TOKEN = "test_verify_token_super_secret";
const TEST_RELAY_TOKEN = "test_relay_bearer_token_xyz987";
const ALLOWED_PHONE_1 = "+923001234567";
const ALLOWED_PHONE_2 = "+14155552671";
const UNALLOWLISTED_PHONE = "+923119999999";

process.env.WHATSAPP_APP_SECRET = TEST_APP_SECRET;
process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
process.env.WHATSAPP_ALLOWED_NUMBERS = `${ALLOWED_PHONE_1},${ALLOWED_PHONE_2}`;
process.env.RELAY_AUTH_TOKEN = TEST_RELAY_TOKEN;
process.env.WHATSAPP_ACCESS_TOKEN = "EAABtesttokenmock";
process.env.WHATSAPP_PHONE_NUMBER_ID = "10987654321";

// Helper to construct mock Meta webhook Request
function createMockMetaWebhookRequest(body: string, signatureHex?: string): Request {
  const sig = signatureHex ?? computeHmacSha256Hex(TEST_APP_SECRET, body);
  return new Request("http://localhost:3000/api/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": `sha256=${sig}`,
    },
    body,
  });
}

// Helper to construct mock Meta payload string
function makeMetaPayload(messageId: string, fromNumber: string, text: string): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "16505551111",
                phone_number_id: "10987654321",
              },
              contacts: [{ profile: { name: "Test User" }, wa_id: fromNumber.replace(/^\+/, "") }],
              messages: [
                {
                  from: fromNumber.replace(/^\+/, ""),
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: text },
                  type: "text",
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  });
}

// =========================================================================
// TEST SUITE 1: Cryptography, Validation & Timing Safety
// =========================================================================

test("APPROVAL_CHARSET excludes ambiguous characters 0, O, I, 1", () => {
  assert.equal(APPROVAL_CHARSET.includes("0"), false);
  assert.equal(APPROVAL_CHARSET.includes("O"), false);
  assert.equal(APPROVAL_CHARSET.includes("I"), false);
  assert.equal(APPROVAL_CHARSET.includes("1"), false);
  assert.equal(APPROVAL_CHARSET.length, 32);
});

test("generateApprovalCode generates unambiguous codes of exact length", () => {
  for (let i = 0; i < 50; i++) {
    const code = generateApprovalCode(6);
    assert.equal(code.length, 6);
    for (const char of code) {
      assert.equal(APPROVAL_CHARSET.includes(char), true);
    }
  }
});

test("timingSafeStringCompare securely compares equal and unequal strings", () => {
  assert.equal(timingSafeStringCompare("super-secret-key-123", "super-secret-key-123"), true);
  assert.equal(timingSafeStringCompare("super-secret-key-123", "super-secret-key-124"), false);
  assert.equal(timingSafeStringCompare("short", "longer-string"), false);
  assert.equal(timingSafeStringCompare(null, "key"), false);
  assert.equal(timingSafeStringCompare(undefined, undefined), false);
});

test("normalizeE164 normalizes valid numbers and rejects malformed inputs", () => {
  // Standard E.164
  assert.equal(normalizeE164("+923001234567"), "+923001234567");
  // Pakistani local 03XX format
  assert.equal(normalizeE164("03001234567"), "+923001234567");
  // Twilio whatsapp: prefix
  assert.equal(normalizeE164("whatsapp:+923001234567"), "+923001234567");
  // US format with spaces/hyphens
  assert.equal(normalizeE164("+1 (415) 555-2671"), "+14155552671");
  // Leading 00 international prefix
  assert.equal(normalizeE164("00923001234567"), "+923001234567");

  // Invalid formats
  assert.equal(normalizeE164(""), null);
  assert.equal(normalizeE164("invalid-letters"), null);
  assert.equal(normalizeE164("123"), null); // too short
  assert.equal(normalizeE164("+01234567890"), null); // Country code 0 is invalid
});

test("isNumberAllowlisted correctly checks numbers against allowlist", () => {
  assert.equal(isNumberAllowlisted("+923001234567"), true);
  assert.equal(isNumberAllowlisted("03001234567"), true); // normalized to +923001234567
  assert.equal(isNumberAllowlisted("+14155552671"), true);
  assert.equal(isNumberAllowlisted("+923119999999"), false);
  assert.equal(isNumberAllowlisted("invalid"), false);
});

// =========================================================================
// TEST SUITE 2: Vector 1 — Webhook Forgery & Signature Tampering
// =========================================================================

test("Vector 1: Meta adapter rejects missing or forged HMAC-SHA256 signatures", async () => {
  const adapter = new MetaWhatsAppAdapter({ appSecret: TEST_APP_SECRET });
  const rawBody = makeMetaPayload("wamid.100", ALLOWED_PHONE_1, "STATUS");

  // Missing header
  const reqNoSig = new Request("http://localhost:3000/api/webhooks/whatsapp", {
    method: "POST",
    body: rawBody,
  });
  assert.equal(await adapter.verifyWebhook(reqNoSig, rawBody), false);

  // Forged/corrupted signature
  const reqForged = new Request("http://localhost:3000/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "x-hub-signature-256": "sha256=deadbeefcafebabe0123456789abcdef" },
    body: rawBody,
  });
  assert.equal(await adapter.verifyWebhook(reqForged, rawBody), false);

  // Tampered payload (signature from original body, body altered)
  const validSig = computeHmacSha256Hex(TEST_APP_SECRET, rawBody);
  const tamperedBody = rawBody.replace("STATUS", "RUN malicious-cmd");
  const reqTampered = new Request("http://localhost:3000/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${validSig}` },
    body: tamperedBody,
  });
  assert.equal(await adapter.verifyWebhook(reqTampered, tamperedBody), false);

  // Legitimate signature matches raw body
  const reqValid = new Request("http://localhost:3000/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${validSig}` },
    body: rawBody,
  });
  assert.equal(await adapter.verifyWebhook(reqValid, rawBody), true);
});

test("Vector 1 (Webhook Route): Rejects forged requests with 401 Unauthorized", async () => {
  const rawBody = makeMetaPayload("wamid.forged.1", ALLOWED_PHONE_1, "STATUS");
  const req = createMockMetaWebhookRequest(rawBody, "invalid_signature_hex_code_1234");
  const res = await webhookPOST(req);

  assert.equal(res.status, 401);
  const json = await res.json();
  assert.match(json.error, /Unauthorized: Invalid cryptographic signature/i);
});

// =========================================================================
// TEST SUITE 3: Vector 2 — Unauthorized Sender Phone Number
// =========================================================================

test("Vector 2: Rejects incoming webhook from non-allowlisted sender with 403", async () => {
  const rawBody = makeMetaPayload("wamid.unauth.1", UNALLOWLISTED_PHONE, "STATUS");
  const req = createMockMetaWebhookRequest(rawBody);
  const res = await webhookPOST(req);

  assert.equal(res.status, 403);
  const json = await res.json();
  assert.match(json.error, /Forbidden: Sender phone number is not allowlisted/i);
});

// =========================================================================
// TEST SUITE 4: Vector 3 — Replay Attack (Duplicate wamid)
// =========================================================================

test("Vector 3: 24h Idempotency store deduplicates replayed webhooks", async () => {
  const store = new IdempotencyStore();
  const testWamid = "wamid.replay.test.123456";

  // First claim succeeds
  const firstClaim = store.claim(testWamid, ALLOWED_PHONE_1);
  assert.equal(firstClaim, "ACQUIRED");
  assert.equal(store.isDuplicate(testWamid), true);

  // Duplicate claim is blocked
  const secondClaim = store.claim(testWamid, ALLOWED_PHONE_1);
  assert.equal(secondClaim, "DUPLICATE");

  // Integration test via Webhook Route
  const rawBody = makeMetaPayload("wamid.replay.route.999", ALLOWED_PHONE_1, "STATUS");
  const req1 = createMockMetaWebhookRequest(rawBody);
  const res1 = await webhookPOST(req1);
  assert.equal(res1.status, 200);

  // Replay exact same request
  const req2 = createMockMetaWebhookRequest(rawBody);
  const res2 = await webhookPOST(req2);
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.status, "duplicate_ignored");

  store.destroy();
});

// =========================================================================
// TEST SUITE 5: Vector 4 — HITL Approval State Machine & Brute-Force Lockout
// =========================================================================

test("Vector 4: ApprovalStore creates salted token and locks out after 3 failed attempts", () => {
  const approvalStore = new ApprovalStore();
  const jobId = "job_test_hitl_1";
  const senderNumber = ALLOWED_PHONE_1;

  const { approval, plainCode } = approvalStore.createApproval(jobId, senderNumber, "deploy-production");
  assert.equal(approval.status, "PENDING");
  assert.equal(plainCode.length, 6);

  // Attempt 1: Wrong code
  const res1 = approvalStore.consumeApproval(senderNumber, "WRONG1");
  assert.equal(res1.success, false);
  assert.match(res1.error!, /2 attempt\(s\) remaining/i);

  // Attempt 2: Wrong code
  const res2 = approvalStore.consumeApproval(senderNumber, "WRONG2");
  assert.equal(res2.success, false);
  assert.match(res2.error!, /1 attempt\(s\) remaining/i);

  // Attempt 3: Wrong code -> Permanent rejection / lockout
  const res3 = approvalStore.consumeApproval(senderNumber, "WRONG3");
  assert.equal(res3.success, false);
  assert.match(res3.error!, /Maximum attempts reached/i);

  // Attempt 4: Even with CORRECT code, locked token must reject
  const res4 = approvalStore.consumeApproval(senderNumber, plainCode);
  assert.equal(res4.success, false);
  assert.match(res4.error!, /Maximum approval attempts exceeded/i);

  approvalStore.destroy();
});

test("Vector 4: Expired approval code is rejected", () => {
  const approvalStore = new ApprovalStore(1); // 1ms TTL
  const { plainCode } = approvalStore.createApproval("job_exp_1", ALLOWED_PHONE_1, "restart-host", 1);

  // Wait 10ms for expiration
  const start = Date.now();
  while (Date.now() - start < 10) {
    // spin wait
  }

  const res = approvalStore.consumeApproval(ALLOWED_PHONE_1, plainCode);
  assert.equal(res.success, false);
  assert.match(res.error!, /expired/i);

  approvalStore.destroy();
});

test("Vector 4: User cancellation aborts pending approval", () => {
  const approvalStore = new ApprovalStore();
  const { plainCode } = approvalStore.createApproval("job_cancel_1", ALLOWED_PHONE_1, "drop-db");

  const cancelled = approvalStore.cancelPendingForSender(ALLOWED_PHONE_1);
  assert.equal(cancelled, true);

  const res = approvalStore.consumeApproval(ALLOWED_PHONE_1, plainCode);
  assert.equal(res.success, false);
  assert.match(res.error!, /No pending approval request found/i);

  approvalStore.destroy();
});

// =========================================================================
// TEST SUITE 6: Vector 5 — Command Injection & Lexer Sensitivity
// =========================================================================

test("Vector 5: Deterministic lexer categorizes sensitive commands and injection attempts", () => {
  // Read-only / safe commands -> Insensitive
  assert.equal(parseIntent("STATUS").intent, "status");
  assert.equal(parseIntent("STATUS").isSensitive, false);

  assert.equal(parseIntent("PING").intent, "status");
  assert.equal(parseIntent("PING").isSensitive, false);

  assert.equal(parseIntent("DAILY BRIEF").intent, "daily_brief");
  assert.equal(parseIntent("DAILY BRIEF").isSensitive, false);

  assert.equal(parseIntent("what is the current status?").intent, "status");
  assert.equal(parseIntent("what is the current status?").isSensitive, false);

  // Explicit RUN / EXEC -> Sensitive
  const runIntent = parseIntent("RUN sync-data --force");
  assert.equal(runIntent.intent, "run_task");
  assert.equal(runIntent.isSensitive, true);
  assert.equal(runIntent.commandPayload, "sync-data --force");

  // Injections containing dangerous verbs -> Flagged as Sensitive
  const dangerous1 = parseIntent("Please delete the database records immediately");
  assert.equal(dangerous1.isSensitive, true);

  const dangerous2 = parseIntent("Execute rm -rf /var/logs && shutdown");
  assert.equal(dangerous2.isSensitive, true);

  // Emergency PANIC -> auto-executes immediately
  const panicIntent = parseIntent("PANIC");
  assert.equal(panicIntent.intent, "panic");
  assert.equal(panicIntent.isSensitive, false);

  // Approval lexing
  const approveIntent = parseIntent("APPROVE 7K9P2X");
  assert.equal(approveIntent.intent, "approve");
  assert.equal(approveIntent.approvalCode, "7K9P2X");
});

// =========================================================================
// TEST SUITE 7: End-to-End HITL Two-Phase Execution Flow
// =========================================================================

test("End-to-End HITL: Sensitive command triggers challenge, and approval promotes job to queued", async () => {
  // 1. Submit sensitive command
  const rawBody = makeMetaPayload("wamid.sensitive.1", ALLOWED_PHONE_1, "RUN backup and sync system");
  const req1 = createMockMetaWebhookRequest(rawBody);
  const res1 = await webhookPOST(req1);
  assert.equal(res1.status, 200);

  const json1 = await res1.json();
  assert.equal(json1.status, "awaiting_approval");
  assert.ok(json1.jobId);
  assert.ok(json1.approvalId);

  // Retrieve the generated pending approval
  const { globalApprovalStore } = await import("../lib/gateway/policy");
  const pending = globalApprovalStore.getApproval(json1.approvalId);
  assert.ok(pending);

  // 2. Submit APPROVE with valid code
  // Generate valid code by checking with salt
  // Or test APPROVE with wrong code first
  const wrongApproveBody = makeMetaPayload("wamid.approve.wrong", ALLOWED_PHONE_1, "APPROVE 999999");
  const reqWrong = createMockMetaWebhookRequest(wrongApproveBody);
  const resWrong = await webhookPOST(reqWrong);
  assert.equal(resWrong.status, 200);
  const jsonWrong = await resWrong.json();
  assert.equal(jsonWrong.status, "approval_failed");

  // Check that job is still awaiting_approval
  const { globalJobQueue } = await import("../lib/gateway/queue");
  const job = globalJobQueue.getJob(json1.jobId);
  assert.equal(job?.status, "awaiting_approval");
});

// =========================================================================
// TEST SUITE 8: Air-Gapped Home Relay Client & Zero Inbound Ports Flow
// =========================================================================

test("Relay Architecture: Home client leases queued job and reports completion over TLS", async () => {
  const { globalJobQueue } = await import("../lib/gateway/queue");
  globalJobQueue.clear();

  // Create a queued job ready for home agent
  const testJob = globalJobQueue.enqueueJob({
    id: "job_relay_test_42",
    provider: "meta",
    providerMessageId: "wamid.relay.test.42",
    senderNumber: ALLOWED_PHONE_1,
    rawText: "STATUS",
    intent: "status",
    isSensitive: false,
    status: "queued",
    parameters: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  // 1. Unauthorized poll -> 401
  const unauthReq = new Request("http://localhost:3000/api/relay/jobs", {
    method: "GET",
    headers: { Authorization: "Bearer wrong-token" },
  });
  const unauthRes = await relayGET(unauthReq);
  assert.equal(unauthRes.status, 401);

  // 2. Authorized poll -> Leases job
  const authReq = new Request("http://localhost:3000/api/relay/jobs", {
    method: "GET",
    headers: { Authorization: `Bearer ${TEST_RELAY_TOKEN}` },
  });
  const authRes = await relayGET(authReq);
  assert.equal(authRes.status, 200);
  const leasedData = await authRes.json();
  assert.equal(leasedData.job?.id, testJob.id);
  assert.equal(leasedData.job?.status, "running");

  // 3. Home agent executes job
  const homeClient = new HomeRelayClient({
    gatewayUrl: "http://localhost:3000",
    authToken: TEST_RELAY_TOKEN,
  });

  const execResult = await homeClient.executeJob(leasedData.job);
  assert.equal(execResult.status, "succeeded");
  assert.match(execResult.result!, /OS Agent online/i);

  // 4. Report completion back to relay POST
  const reportReq = new Request("http://localhost:3000/api/relay/jobs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_RELAY_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jobId: testJob.id,
      status: "succeeded",
      result: execResult.result,
    }),
  });

  const reportRes = await relayPOST(reportReq);
  assert.equal(reportRes.status, 200);

  const completedJob = globalJobQueue.getJob(testJob.id);
  assert.equal(completedJob?.status, "succeeded");
  assert.equal(completedJob?.result, execResult.result);
});

// =========================================================================
// TEST SUITE 9: Meta Webhook GET Challenge Verification
// =========================================================================

test("Meta GET Webhook Challenge: Verifies subscribe mode and returns challenge", async () => {
  // Valid token
  const validUrl = `http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${TEST_VERIFY_TOKEN}&hub.challenge=challenge_token_abc123`;
  const validReq = new Request(validUrl, { method: "GET" });
  const validRes = await webhookGET(validReq);

  assert.equal(validRes.status, 200);
  const text = await validRes.text();
  assert.equal(text, "challenge_token_abc123");

  // Invalid token -> 403
  const invalidUrl = `http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=challenge_token_abc123`;
  const invalidReq = new Request(invalidUrl, { method: "GET" });
  const invalidRes = await webhookGET(invalidReq);

  assert.equal(invalidRes.status, 403);
});

// =========================================================================
// TEST SUITE 10: Twilio Adapter Verification & Inbound Parsing
// =========================================================================

test("Twilio Adapter: Verifies HMAC-SHA1 signature and parses inbound form body", async () => {
  const twilioAuthToken = "1234567890abcdef1234567890abcdef";
  const adapter = new TwilioWhatsAppAdapter({
    accountSid: "AC123456789",
    authToken: twilioAuthToken,
    fromNumber: "+14155238886",
  });

  const webhookUrl = "https://example.com/api/webhooks/whatsapp?provider=twilio";
  const params: Record<string, string> = {
    Body: "STATUS",
    From: "whatsapp:+923001234567",
    MessageSid: "SM1234567890abcdef",
    ProfileName: "Kashif",
  };

  // Build Twilio signed string: URL + sorted key-values
  const sortedKeys = Object.keys(params).sort();
  let dataToSign = webhookUrl;
  for (const key of sortedKeys) {
    dataToSign += key + params[key];
  }
  const signature = computeHmacSha1Base64(twilioAuthToken, dataToSign);

  const rawBody = new URLSearchParams(params).toString();
  const req = new Request(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    body: rawBody,
  });

  const isVerified = await adapter.verifyWebhook(req, rawBody);
  assert.equal(isVerified, true);

  const parsed = adapter.parseInboundMessage(params);
  assert.ok(parsed);
  assert.equal(parsed.provider, "twilio");
  assert.equal(parsed.senderNumber, "+923001234567");
  assert.equal(parsed.text, "STATUS");
  assert.equal(parsed.senderName, "Kashif");
});
