import { NextResponse } from "next/server";
import { timingSafeStringCompare } from "@/lib/gateway/crypto";
import { globalJobQueue } from "@/lib/gateway/queue";
import { getWhatsAppAdapter } from "@/lib/gateway/adapters";

export const dynamic = "force-dynamic";

function authenticateRelayRequest(req: Request): boolean {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return false;
  }
  const token = authHeader.slice(7).trim();
  const expectedSecret = process.env.RELAY_AUTH_TOKEN;

  if (!expectedSecret || !token) {
    return false;
  }

  return timingSafeStringCompare(expectedSecret, token);
}

/**
 * GET: Polled by local home agent relay client to lease next executable job.
 * Zero inbound ports needed on home machine.
 */
export async function GET(req: Request) {
  if (!authenticateRelayRequest(req)) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing relay bearer token" },
      { status: 401 }
    );
  }

  const job = globalJobQueue.leaseNextJob();
  return NextResponse.json({ job });
}

/**
 * POST: Invoked by local home agent relay client to return execution results.
 * Automatically notifies user on WhatsApp with result or failure.
 */
export async function POST(req: Request) {
  if (!authenticateRelayRequest(req)) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing relay bearer token" },
      { status: 401 }
    );
  }

  let body: {
    jobId?: string;
    status?: "succeeded" | "failed";
    result?: string;
    error?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Bad Request: Malformed JSON" },
      { status: 400 }
    );
  }

  const { jobId, status, result, error } = body;
  if (!jobId || !status || (status !== "succeeded" && status !== "failed")) {
    return NextResponse.json(
      { error: "Missing or invalid required fields: jobId, status" },
      { status: 400 }
    );
  }

  const updatedJob = globalJobQueue.completeJob(jobId, { status, result, error });
  if (!updatedJob) {
    return NextResponse.json(
      { error: "Job not found or already terminated" },
      { status: 404 }
    );
  }

  // Notify verified sender on WhatsApp
  const adapter = getWhatsAppAdapter(updatedJob.provider);
  const actionLabel = (updatedJob.parameters?.commandPayload as string) || updatedJob.rawText;

  let outboundNotification = "";
  if (status === "succeeded") {
    outboundNotification =
      `🎉 *Task Completed Successfully*\n\n` +
      `Action: "${actionLabel}"\n` +
      `Result:\n${result || "Execution completed with code 0."}`;
  } else {
    outboundNotification =
      `⚠️ *Task Execution Failed*\n\n` +
      `Action: "${actionLabel}"\n` +
      `Error:\n${error || "Execution terminated with non-zero status."}`;
  }

  // Asynchronously dispatch WhatsApp outbound notification
  await adapter.sendMessage({
    to: updatedJob.senderNumber,
    text: outboundNotification,
  }).catch(() => {
    // Suppress dispatch failures from breaking completion API
  });

  return NextResponse.json({ success: true, job: updatedJob });
}
