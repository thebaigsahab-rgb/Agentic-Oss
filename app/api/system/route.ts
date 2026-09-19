import os from "os";
import {
  getDeviceSnapshot,
  getVolumeStatus,
  setVolumeLevel,
  stepVolume,
  setMuted,
  sendMediaKey,
  openUrlInDefaultBrowser,
  openNewBrowserTab,
  launchApplication,
  focusWindow,
  listDesktopWindows,
  takeScreenScreenshot,
  savePageAsPdf,
  deleteArtifact,
  listArtifacts,
  getUserIdleSeconds,
  realMouseMove,
  realMouseMoveRelative,
  realMouseClick,
  realMouseScroll,
  realTypeText,
  realPressHotkey,
  respectHumanPace,
  SystemBridgeError,
} from "@/lib/server/system-bridge";
import { resolveYouTubeMedia } from "@/lib/server/jarvis-device-tools";
import type { AgentInputMode } from "@/lib/computer-use-types";
import {
  extractTokenFromRequest,
  verifySessionToken,
  createLocalAdminSession,
  validateRequestSecurity,
  hasMinimumRole,
  type Role,
  type Session,
} from "@/lib/security/session";
import { verifyAndConsumeTicket } from "@/lib/security/approval";
import { runCatalogJob, getCatalogRoutine } from "@/lib/security/catalog";
import { logAuditEvent, isSystemLockedDown } from "@/lib/security/panic";
import { computeSha256 } from "@/lib/security/crypto";

export const runtime = "nodejs";

function isLoopbackRequest(request: Request): boolean {
  try {
    const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip");
    if (forwarded) {
      const firstIp = forwarded.split(",")[0].trim().toLowerCase();
      if (firstIp !== "127.0.0.1" && firstIp !== "::1" && firstIp !== "localhost") {
        return false;
      }
    }
    const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function getLocalLanIp(): string {
  try {
    const nets = os.networkInterfaces();
    const candidates: { name: string; ip: string; priority: number }[] = [];
    for (const [name, list] of Object.entries(nets)) {
      if (!list) continue;
      for (const net of list) {
        if (net.family === "IPv4" && !net.internal) {
          let priority = 1;
          const lower = name.toLowerCase();
          if (lower.includes("wi-fi") || lower.includes("wlan") || lower.includes("wireless")) {
            priority = 10;
          } else if (lower.includes("ethernet") || lower.includes("eth") || lower.includes("lan")) {
            priority = 8;
          } else if (lower.includes("tailscale") || lower.includes("vpn") || lower.includes("vethernet")) {
            priority = 2;
          }
          candidates.push({ name, ip: net.address, priority });
        }
      }
    }
    candidates.sort((a, b) => b.priority - a.priority);
    return candidates[0]?.ip || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

function bridgeError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof SystemBridgeError) {
    return {
      status: err.code === "INPUT_BUSY" ? 409 : 400,
      body: { ok: false, error: { code: err.code, message: err.message, retryable: err.retryable } },
    };
  }
  return {
    status: 500,
    body: { ok: false, error: { code: "BRIDGE_FAILURE", message: err instanceof Error ? err.message : "Device bridge failure." } },
  };
}

async function resolveCallerSession(request: Request): Promise<{ session: Session | null; isLoopback: boolean }> {
  const isLoopback = isLoopbackRequest(request);
  const token = extractTokenFromRequest(request);
  let session = token ? verifySessionToken(token) : null;

  // Preserve local loopback dashboard functionality
  if (!session && isLoopback) {
    const local = await createLocalAdminSession();
    session = local.session;
  }

  return { session, isLoopback };
}

/**
 * GET /api/system
 * Returns device telemetry and snapshot. Requires minimum 'read-only' capability.
 */
export async function GET(request: Request) {
  try {
    if (isSystemLockedDown()) {
      return Response.json(
        { ok: false, error: "System is in emergency lockdown. Telemetry is unavailable." },
        { status: 503 }
      );
    }

    const { session, isLoopback } = await resolveCallerSession(request);
    if (!session) {
      return Response.json(
        { ok: false, error: "Unauthorized: Active session required to query system telemetry." },
        { status: 401 }
      );
    }

    // Role check: 'read-only' or higher
    if (!hasMinimumRole(session.role, "read-only")) {
      return Response.json(
        { ok: false, error: "Forbidden: Insufficient capabilities." },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const includeWindows = url.searchParams.get("windows") === "1";

    const snapshot = await getDeviceSnapshot();
    const artifacts = {
      screenshots: listArtifacts("screenshots", 40),
      pdf: listArtifacts("pdf", 40),
    };
    const volume = snapshot.hostReady ? { volume: snapshot.volume, muted: snapshot.muted } : await getVolumeStatus().catch(() => null);
    const idleSeconds = snapshot.idleSeconds ?? (snapshot.hostReady ? await getUserIdleSeconds().catch(() => null) : null);
    const windows = includeWindows && snapshot.hostReady ? await listDesktopWindows(25).catch(() => []) : undefined;

    return Response.json({
      ok: true,
      lanIp: isLoopback ? "127.0.0.1" : getLocalLanIp(),
      snapshot: { ...snapshot, idleSeconds },
      volume,
      artifacts,
      windows,
      caller: {
        role: session.role,
        isLoopback: session.isLocalLoopback,
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const { status, body } = bridgeError(error);
    return Response.json(body, { status });
  }
}

/**
 * POST /api/system
 * Zero-Trust System Controller with Granular CBAC and HITL Gating.
 */
export async function POST(request: Request) {
  try {
    if (isSystemLockedDown()) {
      return Response.json(
        { ok: false, error: "System is in emergency lockdown. State changes are prohibited." },
        { status: 503 }
      );
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return Response.json({ ok: false, error: "Content-Type must be application/json." }, { status: 415 });
    }

    const raw = await request.text();
    if (raw.length > 16384) {
      return Response.json({ ok: false, error: "Request payload too large." }, { status: 413 });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ ok: false, error: "Malformed JSON body." }, { status: 400 });
    }

    const action = String(body.action || "").trim();
    if (!action) {
      return Response.json({ ok: false, error: "Missing action in request." }, { status: 400 });
    }

    // 1. Resolve and Validate Caller Session
    const { session, isLoopback } = await resolveCallerSession(request);
    if (!session) {
      return Response.json(
        { ok: false, error: "Unauthorized: Valid session required." },
        { status: 401 }
      );
    }

    // 2. CSRF Enforcement on Remote State-Mutating Requests
    if (!isLoopback) {
      const csrfResult = await validateRequestSecurity(request);
      if (!csrfResult.authorized) {
        return Response.json(
          { ok: false, error: csrfResult.error || "CSRF verification failed." },
          { status: csrfResult.status }
        );
      }
    }

    // 3. INVARIANT: ZERO TRUST CLIENT INPUT
    // Never read user identity, role, approval state, or execution mode from request body!
    const effectiveRole: Role = session.role;

    // 4. Granular Capability-Based Access Control (CBAC) Matrix Enforcement
    // Rule: 'read-only' cannot trigger any actions
    if (effectiveRole === "read-only") {
      await logAuditEvent({
        deviceId: session.deviceId,
        actorRole: session.role,
        targetCapability: "routine-only",
        parametersHash: computeSha256(raw),
        approvalStatus: "DENIED",
        executionResult: "BLOCKED: read-only role attempted state-mutating action.",
      });
      return Response.json(
        { ok: false, error: `Forbidden: role 'read-only' cannot execute action '${action}'.` },
        { status: 403 }
      );
    }

    // Define Action Categories
    const ROUTINE_ACTIONS = new Set([
      "set_volume",
      "volume_step",
      "set_mute",
      "media_key",
      "open_url",
      "new_tab",
      "play_media",
      "list_windows",
      "screenshot",
      "save_pdf",
      "delete_artifact",
      "get_idle",
    ]);

    const TAKEOVER_INPUT_ACTIONS = new Set([
      "move_mouse",
      "click_mouse",
      "scroll",
      "type_text",
      "press_hotkey",
      "touchpad_move",
    ]);

    const OS_COMMAND_ACTIONS = new Set([
      "execute_command",
      "run_catalog_job",
      "launch_app",
      "focus_window",
    ]);

    // -------------------------------------------------------------------------
    // CATEGORY A: ROUTINE SCRIPTS
    // Allowed for: routine-only, computer-control, admin
    // -------------------------------------------------------------------------
    if (ROUTINE_ACTIONS.has(action)) {
      if (!hasMinimumRole(effectiveRole, "routine-only")) {
        return Response.json({ ok: false, error: "Forbidden: routine-only capability required." }, { status: 403 });
      }

      switch (action) {
        case "set_volume": {
          const result = await setVolumeLevel(Number(body.level));
          return Response.json({ ok: true, volume: result });
        }
        case "volume_step": {
          const result = await stepVolume(Number(body.delta) || 10);
          return Response.json({ ok: true, volume: result });
        }
        case "set_mute": {
          const result = await setMuted(Boolean(body.muted));
          return Response.json({ ok: true, volume: result });
        }
        case "media_key": {
          const media = (typeof body.media === "string" ? body.media : "toggle") as "play" | "pause" | "toggle" | "next" | "previous" | "stop";
          const result = await sendMediaKey(media);
          return Response.json({ ok: true, media: result });
        }
        case "open_url": {
          const result = await openUrlInDefaultBrowser(String(body.url || ""));
          return Response.json({ ok: true, opened: result });
        }
        case "new_tab": {
          const result = await openNewBrowserTab(typeof body.url === "string" ? body.url : undefined);
          return Response.json({ ok: true, tab: result });
        }
        case "play_media": {
          const media = await resolveYouTubeMedia(String(body.query || "").trim());
          return Response.json({ ok: true, media });
        }
        case "list_windows": {
          const windows = await listDesktopWindows(25);
          return Response.json({ ok: true, windows });
        }
        case "screenshot": {
          const shot = await takeScreenScreenshot(typeof body.label === "string" ? body.label : undefined);
          return Response.json({ ok: true, screenshot: shot });
        }
        case "save_pdf": {
          const pdf = await savePageAsPdf(String(body.url || ""), typeof body.name === "string" ? body.name : undefined);
          return Response.json({ ok: true, pdf });
        }
        case "delete_artifact": {
          const kind = body.kind === "pdf" ? "pdf" : "screenshots";
          const removed = deleteArtifact(kind, String(body.name || ""));
          return Response.json({ ok: true, removed });
        }
        case "get_idle": {
          const idleSeconds = await getUserIdleSeconds();
          return Response.json({ ok: true, idleSeconds });
        }
      }
    }

    // -------------------------------------------------------------------------
    // CATEGORY B: MOUSE & KEYBOARD TAKEOVER (HITL REQUIRED)
    // Role required: computer-control or admin
    // In addition, MUST possess a cryptographically signed, unconsumed ApprovalTicket!
    // -------------------------------------------------------------------------
    if (TAKEOVER_INPUT_ACTIONS.has(action)) {
      if (!hasMinimumRole(effectiveRole, "computer-control")) {
        return Response.json(
          { ok: false, error: `Forbidden: role '${effectiveRole}' lacks computer-control capability.` },
          { status: 403 }
        );
      }

      // Check if caller is local loopback admin performing direct local control
      const isDirectLocalControl = session.isLocalLoopback && session.role === "admin";

      // If remote or not local direct admin, require signed ApprovalTicket
      if (!isDirectLocalControl) {
        // Extract ticket and parameters
        const ticket = body.approvalTicket;
        const actionParams = { ...body };
        delete actionParams.approvalTicket;

        const ticketResult = verifyAndConsumeTicket(ticket, action, actionParams);
        if (!ticketResult.valid) {
          await logAuditEvent({
            deviceId: session.deviceId,
            actorRole: session.role,
            targetCapability: "computer-control",
            parametersHash: computeSha256(JSON.stringify(actionParams)),
            approvalStatus: "TICKET_REJECTED",
            executionResult: `BLOCKED: ${ticketResult.error}`,
          });

          return Response.json(
            {
              ok: false,
              error: `HITL Gating Failure: ${ticketResult.error}`,
              requiresApproval: true,
            },
            { status: 403 }
          );
        }
      }

      // Server-determined mode (never client body inputMode)
      const executionMode: AgentInputMode = "takeover";

      await respectHumanPace();

      switch (action) {
        case "touchpad_move": {
          const result = await realMouseMoveRelative(executionMode, Number(body.dx) || 0, Number(body.dy) || 0);
          return Response.json({ ok: true, move: result });
        }
        case "move_mouse": {
          const result = await realMouseMove(executionMode, Number(body.x), Number(body.y));
          return Response.json({ ok: true, input: result });
        }
        case "click_mouse": {
          const result = await realMouseClick(
            executionMode,
            body.x === undefined ? undefined : Number(body.x),
            body.y === undefined ? undefined : Number(body.y),
            body.button === "right" || body.button === "middle" ? body.button : "left"
          );
          return Response.json({ ok: true, input: result });
        }
        case "scroll": {
          const result = await realMouseScroll(executionMode, Number(body.dy) || 300);
          return Response.json({ ok: true, input: result });
        }
        case "type_text": {
          const result = await realTypeText(executionMode, String(body.text || ""));
          return Response.json({ ok: true, input: result });
        }
        case "press_hotkey": {
          const result = await realPressHotkey(executionMode, String(body.combo || ""));
          return Response.json({ ok: true, input: result });
        }
      }
    }

    // -------------------------------------------------------------------------
    // CATEGORY C: OS COMMANDS & SYSTEM CONFIG (HITL REQUIRED)
    // Deprecated arbitrary shell denylists; enforces allowlisted catalog or HITL
    // -------------------------------------------------------------------------
    if (OS_COMMAND_ACTIONS.has(action)) {
      if (!hasMinimumRole(effectiveRole, "admin")) {
        return Response.json(
          { ok: false, error: `Forbidden: role '${effectiveRole}' lacks admin capability.` },
          { status: 403 }
        );
      }

      if (action === "execute_command" || action === "run_catalog_job") {
        const commandId = String(body.commandId || body.command || "").trim();

        // Check if command is an allowlisted catalog routine
        const routine = getCatalogRoutine(commandId);
        if (!routine) {
          // Dynamic arbitrary commands with denylists are deprecated!
          return Response.json(
            {
              ok: false,
              error: `Execution Refused: Command '${commandId}' is not in the allowlisted catalog. Arbitrary shell interpolation is permanently deprecated.`,
            },
            { status: 403 }
          );
        }

        // If routine requires HITL, verify signed ApprovalTicket
        if (routine.requiresHitl && (!session.isLocalLoopback || session.role !== "admin")) {
          const actionParams = { ...body };
          delete actionParams.approvalTicket;
          const ticketResult = verifyAndConsumeTicket(body.approvalTicket, action, actionParams);
          if (!ticketResult.valid) {
            return Response.json(
              {
                ok: false,
                error: `HITL Gating Failure: ${ticketResult.error}`,
                requiresApproval: true,
              },
              { status: 403 }
            );
          }
        }

        const params = (body.params as Record<string, unknown>) || {};
        const jobResult = await runCatalogJob(commandId, params);

        await logAuditEvent({
          deviceId: session.deviceId,
          actorRole: session.role,
          targetCapability: "admin",
          parametersHash: computeSha256(JSON.stringify(params)),
          approvalStatus: routine.requiresHitl ? "HITL_APPROVED" : "ROUTINE_CATALOG",
          executionResult: jobResult.success ? "SUCCESS" : `FAILURE: ${jobResult.error || "Exit " + jobResult.exitCode}`,
        });

        return Response.json({
          ok: jobResult.success,
          result: jobResult,
        });
      }

      if (action === "launch_app") {
        const app = String(body.app || "");
        const result = await launchApplication(app);
        return Response.json({ ok: true, app: result });
      }

      if (action === "focus_window") {
        const result = await focusWindow(String(body.title || ""));
        return Response.json({ ok: true, focus: result });
      }
    }

    return Response.json(
      { ok: false, error: { code: "UNKNOWN_ACTION", message: `Unknown or disallowed action '${action}'.` } },
      { status: 400 }
    );
  } catch (error) {
    const { status, body } = bridgeError(error);
    return Response.json(body, { status });
  }
}
