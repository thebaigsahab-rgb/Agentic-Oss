import {
  triggerGlobalLockdown,
  resetGlobalLockdown,
  isSystemLockedDown,
  getLockdownMetadata,
} from "@/lib/security/panic";
import {
  validateRequestSecurity,
  extractTokenFromRequest,
  verifySessionToken,
  hasMinimumRole,
} from "@/lib/security/session";

export const runtime = "nodejs";

/**
 * GET /api/system/lockdown
 * Returns the current panic circuit-breaker status.
 */
export async function GET() {
  return Response.json({
    ok: true,
    isLockedDown: isSystemLockedDown(),
    metadata: getLockdownMetadata(),
  });
}

/**
 * POST /api/system/lockdown
 * Hardware/Software Panic Circuit-Breaker:
 * - Instantly invalidates all active sessions
 * - Kills all running subprocesses
 * - Closes all reverse relay connections
 * - Locks down the server
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    let body: Record<string, unknown> = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {}
    }

    const action = String(body.action || "trigger").toLowerCase();

    if (action === "reset") {
      const auth = await validateRequestSecurity(request);
      if (!auth.authorized || !auth.session) {
        return Response.json({ ok: false, error: "Unauthorized: Admin session required to reset lockdown." }, { status: 401 });
      }

      if (!auth.session.isLocalLoopback && !hasMinimumRole(auth.session.role, "admin")) {
        return Response.json({ ok: false, error: "Forbidden: Only administrator may reset lockdown." }, { status: 403 });
      }

      await resetGlobalLockdown(auth.session.deviceId);
      return Response.json({ ok: true, message: "System lockdown successfully cleared." });
    }

    // Panic Trigger: Anyone authorized or emergency operator can trigger panic
    const token = extractTokenFromRequest(request);
    const session = token ? verifySessionToken(token) : null;
    const actor = session ? session.deviceId : "emergency_local_operator";
    const reason = String(body.reason || "Operator triggered emergency lockdown");

    const result = await triggerGlobalLockdown(reason, actor);

    return Response.json({
      ok: true,
      circuitBreaker: "TRIPPED",
      lockdown: result,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Panic lockdown failure." },
      { status: 500 }
    );
  }
}
