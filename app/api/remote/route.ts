import {
  initiatePairing,
  consumePairingToken,
  revokeDevice,
  getPairedDevice,
} from "@/lib/security/pairing";
import {
  extractTokenFromRequest,
  verifySessionToken,
  validateRequestSecurity,
  buildSessionCookieHeaders,
  type Role,
  hasMinimumRole,
} from "@/lib/security/session";
import {
  createApprovalRequest,
  resolveApprovalRequest,
  listPendingApprovalRequests,
} from "@/lib/security/approval";
import { logAuditEvent } from "@/lib/security/panic";
import { computeSha256 } from "@/lib/security/crypto";

export const runtime = "nodejs";

/**
 * GET /api/remote
 * Returns pairing status, device telemetry, or active pending approvals based on authentication.
 */
export async function GET(request: Request) {
  try {
    const token = extractTokenFromRequest(request);
    const session = token ? verifySessionToken(token) : null;

    if (!session) {
      return Response.json({
        ok: true,
        authenticated: false,
        message: "Pairing challenge required to access remote control interface.",
        serverTime: new Date().toISOString(),
      });
    }

    const device = getPairedDevice(session.deviceId);
    const isLocal = session.isLocalLoopback || session.role === "admin";
    const pendingApprovals = isLocal ? listPendingApprovalRequests() : [];

    return Response.json({
      ok: true,
      authenticated: true,
      session: {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        role: session.role,
        isLocalLoopback: session.isLocalLoopback,
        expiresAt: new Date(session.expiresAt).toISOString(),
      },
      device: device || null,
      pendingApprovals,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Remote status error." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/remote
 * Handles cryptographic pairing lifecycle, action proposals, and HITL approval resolution.
 */
export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return Response.json({ ok: false, error: "Content-Type must be application/json." }, { status: 415 });
    }

    const raw = await request.text();
    if (raw.length > 16384) {
      return Response.json({ ok: false, error: "Request payload too large." }, { status: 413 });
    }

    const body = JSON.parse(raw) as Record<string, unknown>;
    const action = String(body.action || "").trim();

    // -------------------------------------------------------------------------
    // 1. ACTION: pair_init
    // Generates a 256-bit CSPRNG pairing token and QR code payload.
    // Must be initiated from a trusted local administrative context.
    // -------------------------------------------------------------------------
    if (action === "pair_init") {
      const auth = await validateRequestSecurity(request);
      if (!auth.authorized || !auth.session) {
        return Response.json({ ok: false, error: "Unauthorized: Only local admin can initiate pairing." }, { status: 401 });
      }

      if (!auth.session.isLocalLoopback && !hasMinimumRole(auth.session.role, "admin")) {
        return Response.json({ ok: false, error: "Forbidden: Insufficient privileges to initiate pairing." }, { status: 403 });
      }

      const requestedRole = (body.role as Role) || "routine-only";
      const pairing = await initiatePairing({
        role: requestedRole,
        requestedByDeviceId: auth.session.deviceId,
        serverHost: request.headers.get("host") || "127.0.0.1:3000",
      });

      await logAuditEvent({
        deviceId: auth.session.deviceId,
        actorRole: auth.session.role,
        targetCapability: requestedRole,
        parametersHash: computeSha256(pairing.pairingId),
        approvalStatus: "PAIRING_INITIATED",
        executionResult: `SUCCESS: Created challenge ${pairing.pairingId}`,
      });

      return Response.json({
        ok: true,
        pairingId: pairing.pairingId,
        rawToken: pairing.rawToken,
        pin: pairing.pin,
        qrPayload: pairing.qrPayload,
        expiresAt: pairing.expiresAt,
        ttlSeconds: 60,
      });
    }

    // -------------------------------------------------------------------------
    // 2. ACTION: pair_consume
    // Ephemeral pairing token exchange. Replay-immune, constant-time verified.
    // -------------------------------------------------------------------------
    if (action === "pair_consume") {
      const pairingId = String(body.pairingId || "").trim();
      const rawToken = String(body.rawToken || "").trim();
      const pin = body.pin ? String(body.pin).trim() : undefined;
      const deviceName = String(body.deviceName || "Remote Client").trim();

      if (!pairingId || !rawToken) {
        return Response.json(
          { ok: false, error: "Missing required pairing credentials (pairingId, rawToken)." },
          { status: 400 }
        );
      }

      try {
        const result = await consumePairingToken({
          pairingId,
          rawToken,
          pin,
          deviceName,
          userAgent: request.headers.get("user-agent") || undefined,
        });

        await logAuditEvent({
          deviceId: result.deviceId,
          actorRole: result.role,
          targetCapability: result.role,
          parametersHash: computeSha256(pairingId),
          approvalStatus: "DEVICE_PAIRED",
          executionResult: `SUCCESS: Device paired with role ${result.role}`,
        });

        const cookieHeaders = buildSessionCookieHeaders(result.sessionToken, result.csrfToken, {
          isSecure: request.url.startsWith("https://"),
        });

        const res = Response.json({
          ok: true,
          deviceId: result.deviceId,
          sessionToken: result.sessionToken,
          csrfToken: result.csrfToken,
          role: result.role,
        });

        cookieHeaders.forEach((val, key) => {
          res.headers.append(key, val);
        });

        return res;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Pairing token consumption failed.";
        return Response.json(
          { ok: false, error: message },
          { status: 400 }
        );
      }
    }

    // -------------------------------------------------------------------------
    // 3. ACTION: propose_action
    // Decouples intention from execution. Remote client proposes an action.
    // -------------------------------------------------------------------------
    if (action === "propose_action") {
      const auth = await validateRequestSecurity(request);
      if (!auth.authorized || !auth.session) {
        return Response.json({ ok: false, error: auth.error || "Unauthorized" }, { status: auth.status });
      }

      const actionType = String(body.actionType || "").trim();
      const targetCapability = (body.targetCapability as Role) || "computer-control";
      const parameters = (body.parameters as Record<string, unknown>) || {};
      const description = String(body.description || `Execution of ${actionType}`).trim();

      if (!actionType) {
        return Response.json({ ok: false, error: "actionType is required." }, { status: 400 });
      }

      const approvalReq = await createApprovalRequest({
        deviceId: auth.session.deviceId,
        targetCapability,
        actionType,
        parameters,
        description,
      });

      await logAuditEvent({
        deviceId: auth.session.deviceId,
        actorRole: auth.session.role,
        targetCapability,
        parametersHash: approvalReq.parametersHash,
        approvalStatus: "ACTION_PROPOSED",
        executionResult: `SUCCESS: Approval request ${approvalReq.requestId} created.`,
      });

      return Response.json({
        ok: true,
        requestId: approvalReq.requestId,
        status: approvalReq.status,
        parametersHash: approvalReq.parametersHash,
        expiresAt: approvalReq.expiresAt,
      });
    }

    // -------------------------------------------------------------------------
    // 4. ACTION: resolve_approval
    // Local admin or trusted operator resolves an ApprovalRequest out-of-band.
    // -------------------------------------------------------------------------
    if (action === "resolve_approval") {
      const auth = await validateRequestSecurity(request);
      if (!auth.authorized || !auth.session) {
        return Response.json({ ok: false, error: auth.error || "Unauthorized" }, { status: auth.status });
      }

      const requestId = String(body.requestId || "").trim();
      const decision = String(body.decision || "").toUpperCase() as "APPROVED" | "REJECTED";

      if (!requestId || !["APPROVED", "REJECTED"].includes(decision)) {
        return Response.json({ ok: false, error: "Invalid requestId or decision." }, { status: 400 });
      }

      try {
        const resolution = await resolveApprovalRequest({
          requestId,
          adminSession: auth.session,
          decision,
        });

        await logAuditEvent({
          deviceId: auth.session.deviceId,
          actorRole: auth.session.role,
          targetCapability: resolution.request.targetCapability,
          parametersHash: resolution.request.parametersHash,
          approvalStatus: `DECISION_${decision}`,
          executionResult: resolution.ticket ? `TICKET_ISSUED:${resolution.ticket.ticketId}` : "REJECTED",
        });

        return Response.json({
          ok: true,
          status: resolution.request.status,
          requestId: resolution.request.requestId,
          ticket: resolution.ticket,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Approval resolution failed.";
        return Response.json({ ok: false, error: message }, { status: 400 });
      }
    }

    // -------------------------------------------------------------------------
    // 5. ACTION: revoke_device
    // Revokes a device and atomically terminates all its sessions.
    // -------------------------------------------------------------------------
    if (action === "revoke_device") {
      const auth = await validateRequestSecurity(request);
      if (!auth.authorized || !auth.session) {
        return Response.json({ ok: false, error: auth.error || "Unauthorized" }, { status: auth.status });
      }

      if (!auth.session.isLocalLoopback && !hasMinimumRole(auth.session.role, "admin")) {
        return Response.json({ ok: false, error: "Forbidden: Admin capability required to revoke devices." }, { status: 403 });
      }

      const targetDeviceId = String(body.deviceId || "").trim();
      if (!targetDeviceId) {
        return Response.json({ ok: false, error: "deviceId is required." }, { status: 400 });
      }

      await revokeDevice(targetDeviceId);

      await logAuditEvent({
        deviceId: auth.session.deviceId,
        actorRole: auth.session.role,
        targetCapability: "admin",
        parametersHash: computeSha256(targetDeviceId),
        approvalStatus: "DEVICE_REVOKED",
        executionResult: `SUCCESS: Revoked device ${targetDeviceId}`,
      });

      return Response.json({ ok: true, revoked: true, deviceId: targetDeviceId });
    }

    return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Remote control error." },
      { status: 500 }
    );
  }
}
