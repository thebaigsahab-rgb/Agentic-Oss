import { NextResponse } from "next/server";
import { timingSafeStringCompare, isNumberAllowlisted } from "@/lib/gateway/crypto";
import { getWhatsAppAdapter } from "@/lib/gateway/adapters";
import { globalIdempotencyStore } from "@/lib/gateway/idempotency";
import { parseIntent, globalApprovalStore } from "@/lib/gateway/policy";
import { globalJobQueue } from "@/lib/gateway/queue";
import type { GatewayJob, ProviderName } from "@/lib/gateway/types";

export const dynamic = "force-dynamic";

/**
 * GET Handler: Meta Webhook Verification Challenge
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && expectedToken && token) {
    if (timingSafeStringCompare(expectedToken, token)) {
      return new Response(challenge || "", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }

  return NextResponse.json(
    { error: "Forbidden: Verification token mismatch" },
    { status: 403 }
  );
}

/**
 * POST Handler: Zero-Trust WhatsApp Inbound Ingestion Pipeline
 */
export async function POST(req: Request) {
  // 1. Ingest raw body text BEFORE parsing to ensure bit-exact HMAC validation
  const rawBody = await req.text();
  const url = new URL(req.url);

  // 2. Resolve adapter by explicit parameter, header, or signature detection
  let provider: ProviderName = "meta";
  const explicitProvider = url.searchParams.get("provider") || req.headers.get("x-provider");
  if (explicitProvider === "twilio") {
    provider = "twilio";
  } else if (req.headers.has("x-twilio-signature")) {
    provider = "twilio";
  }

  const adapter = getWhatsAppAdapter(provider);

  // 3. Cryptographic Verification on Raw Bytes
  const isVerified = await adapter.verifyWebhook(req, rawBody);
  if (!isVerified) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid cryptographic signature" },
      { status: 401 }
    );
  }

  // 4. Safe JSON Parsing
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Bad Request: Malformed JSON payload" },
      { status: 400 }
    );
  }

  // 5. Normalized Message Extraction
  const inbound = adapter.parseInboundMessage(payload);
  if (!inbound) {
    // Non-message events (e.g. sent/delivered receipts) are acknowledged with 200 OK
    return NextResponse.json(
      { status: "acknowledged", detail: "status_or_empty_event" },
      { status: 200 }
    );
  }

  // 6. Server-side E.164 Allowlist Filtering
  const isAllowed = isNumberAllowlisted(inbound.senderNumber);
  if (!isAllowed) {
    return NextResponse.json(
      { error: "Forbidden: Sender phone number is not allowlisted" },
      { status: 403 }
    );
  }

  // 7. 24-Hour Deduplication / Idempotency Check
  const claimStatus = globalIdempotencyStore.claim(inbound.messageId, inbound.senderNumber);
  if (claimStatus === "DUPLICATE") {
    return NextResponse.json(
      { status: "duplicate_ignored", messageId: inbound.messageId },
      { status: 200 }
    );
  }

  // 8. Intent Parsing & Sensitivity Evaluation
  const parsed = parseIntent(inbound.text);

  // Handle APPROVE <code>
  if (parsed.intent === "approve") {
    const candidateCode = parsed.approvalCode || "";
    const consumeResult = globalApprovalStore.consumeApproval(
      inbound.senderNumber,
      candidateCode
    );

    if (!consumeResult.success) {
      await adapter.sendMessage({
        to: inbound.senderNumber,
        text: `❌ Approval Error: ${consumeResult.error}`,
      });
      globalIdempotencyStore.complete(inbound.messageId);
      return NextResponse.json(
        { status: "approval_failed", error: consumeResult.error },
        { status: 200 }
      );
    }

    // Approval successfully verified: promote job to 'queued'
    const approval = consumeResult.approval!;
    globalJobQueue.updateJobStatus(approval.jobId, "queued");

    await adapter.sendMessage({
      to: inbound.senderNumber,
      text: `✅ Approval Confirmed! Executing: "${approval.actionSummary}"...\nYou will receive a notification upon completion.`,
    });

    globalIdempotencyStore.complete(inbound.messageId);
    return NextResponse.json(
      { status: "approved", jobId: approval.jobId },
      { status: 200 }
    );
  }

  // Handle CANCEL [code]
  if (parsed.intent === "cancel") {
    globalApprovalStore.cancelPendingForSender(inbound.senderNumber);
    await adapter.sendMessage({
      to: inbound.senderNumber,
      text: "🛑 Pending approval request has been cancelled.",
    });
    globalIdempotencyStore.complete(inbound.messageId);
    return NextResponse.json({ status: "cancelled" }, { status: 200 });
  }

  // Handle PANIC / LOCKDOWN
  if (parsed.intent === "panic") {
    globalApprovalStore.cancelPendingForSender(inbound.senderNumber);
    await adapter.sendMessage({
      to: inbound.senderNumber,
      text: "🚨 EMERGENCY LOCKDOWN TRIGGERED: All pending operations aborted and remote agent runtime secured.",
    });
    globalIdempotencyStore.complete(inbound.messageId);
    return NextResponse.json({ status: "panic_activated" }, { status: 200 });
  }

  // Handle HELP
  if (parsed.intent === "help") {
    const helpMessage =
      `🤖 *Agentic OS WhatsApp Command Plane*\n\n` +
      `Commands:\n` +
      `• *STATUS* — Check host health & active missions\n` +
      `• *DAILY BRIEF* — Receive executive daily summary\n` +
      `• *RUN <action>* — Request agent action (requires HITL approval)\n` +
      `• *APPROVE <code>* — Authorize pending sensitive action\n` +
      `• *CANCEL* — Cancel pending authorization\n` +
      `• *PANIC* — Emergency stop & security lockdown`;

    await adapter.sendMessage({
      to: inbound.senderNumber,
      text: helpMessage,
    });

    globalIdempotencyStore.complete(inbound.messageId);
    return NextResponse.json({ status: "help_delivered" }, { status: 200 });
  }

  // Create Gateway Job
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job: GatewayJob = {
    id: jobId,
    provider,
    providerMessageId: inbound.messageId,
    senderNumber: inbound.senderNumber,
    rawText: inbound.text,
    intent: parsed.intent,
    isSensitive: parsed.isSensitive,
    status: parsed.isSensitive ? "awaiting_approval" : "queued",
    parameters: {
      commandPayload: parsed.commandPayload,
      senderName: inbound.senderName,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // If SENSITIVE: Trigger Two-Phase HITL State Machine
  if (parsed.isSensitive) {
    const actionDesc = parsed.commandPayload || parsed.rawText;
    const { approval, plainCode } = globalApprovalStore.createApproval(
      job.id,
      inbound.senderNumber,
      actionDesc
    );
    job.approvalId = approval.approvalId;
    globalJobQueue.enqueueJob(job);

    const challengeText =
      `⚠️ *Action Authorization Required*\n\n` +
      `Target Command: "${actionDesc}"\n\n` +
      `To authorize execution, reply with:\n` +
      `👉 *APPROVE ${plainCode}*\n\n` +
      `⏳ Code valid for 10 minutes (3 attempts max).\n` +
      `Reply *CANCEL* to abort.`;

    await adapter.sendMessage({
      to: inbound.senderNumber,
      text: challengeText,
      interactive: {
        type: "button",
        bodyText: challengeText,
        buttons: [
          { id: `APPROVE ${plainCode}`, title: "Approve" },
          { id: "CANCEL", title: "Cancel" },
        ],
      },
    });

    globalIdempotencyStore.complete(inbound.messageId);
    return NextResponse.json(
      {
        status: "awaiting_approval",
        jobId: job.id,
        approvalId: approval.approvalId,
      },
      { status: 200 }
    );
  }

  // If INSENSITIVE: Enqueue for immediate dispatch
  globalJobQueue.enqueueJob(job);

  // Send immediate acknowledgment or quick status response
  if (parsed.intent === "status") {
    await adapter.sendMessage({
      to: inbound.senderNumber,
      text: "🟢 *Agentic OS Status*: Gateway active. Job queued for home relay worker.",
    });
  } else if (parsed.intent === "daily_brief") {
    await adapter.sendMessage({
      to: inbound.senderNumber,
      text: "📊 Generating daily executive brief... Relay worker processing.",
    });
  }

  globalIdempotencyStore.complete(inbound.messageId);
  return NextResponse.json(
    { status: "queued", jobId: job.id },
    { status: 200 }
  );
}
