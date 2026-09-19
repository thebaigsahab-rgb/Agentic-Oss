import {
  generateCsprngToken,
  computeHmac,
  verifyHmac,
  constantTimeCompare,
  computeSha256,
} from "./crypto";

export type Role = "read-only" | "routine-only" | "computer-control" | "admin";

export const ROLE_HIERARCHY: Record<Role, number> = {
  "read-only": 1,
  "routine-only": 2,
  "computer-control": 3,
  admin: 4,
};

export function hasMinimumRole(actualRole: Role, requiredRole: Role): boolean {
  return (ROLE_HIERARCHY[actualRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 99);
}

export interface Session {
  sessionId: string;
  deviceId: string;
  role: Role;
  createdAt: number;
  expiresAt: number;
  csrfToken: string;
  isLocalLoopback: boolean;
  metadata?: Record<string, unknown>;
}

export interface SessionTokenPayload {
  sid: string;
  did: string;
  rol: Role;
  iat: number;
  exp: number;
  csrf: string;
  loc: boolean;
}

export const SESSION_COOKIE_NAME = "agentic_session";
export const CSRF_COOKIE_NAME = "agentic_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const DEFAULT_SESSION_TTL_SECONDS = 3600; // 1 hour
export const LOCAL_ADMIN_SESSION_TTL_SECONDS = 86400; // 24 hours for local loopback

// Ephemeral server signing key with key rotation support
let currentSigningSecret: string =
  process.env.AGENTIC_SESSION_SECRET || generateCsprngToken(32);
const retiredSecrets: Set<string> = new Set();

export function rotateSessionSecret(newSecret?: string): string {
  retiredSecrets.add(currentSigningSecret);
  currentSigningSecret = newSecret || generateCsprngToken(32);
  return currentSigningSecret;
}

export function getActiveSigningSecret(): string {
  return currentSigningSecret;
}

// Server-side session store mapping sessionId -> Session
// Supports instant revocation, device-wide logout, and panic invalidation
const activeSessions = new Map<string, Session>();
// Reverse index: deviceId -> Set<sessionId>
const deviceSessions = new Map<string, Set<string>>();

/**
 * Creates and registers a new authenticated session.
 */
export async function createSession(params: {
  deviceId: string;
  role: Role;
  ttlSeconds?: number;
  isLocalLoopback?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<{ session: Session; token: string; csrfToken: string }> {
  const now = Date.now();
  const ttl = (params.ttlSeconds ?? (params.isLocalLoopback ? LOCAL_ADMIN_SESSION_TTL_SECONDS : DEFAULT_SESSION_TTL_SECONDS)) * 1000;
  const sessionId = generateCsprngToken(24);
  const csrfToken = generateCsprngToken(24);

  const session: Session = {
    sessionId,
    deviceId: params.deviceId,
    role: params.role,
    createdAt: now,
    expiresAt: now + ttl,
    csrfToken,
    isLocalLoopback: Boolean(params.isLocalLoopback),
    metadata: params.metadata,
  };

  // Persist session in active session directory
  activeSessions.set(sessionId, session);
  if (!deviceSessions.has(params.deviceId)) {
    deviceSessions.set(params.deviceId, new Set());
  }
  deviceSessions.get(params.deviceId)!.add(sessionId);

  // Mint signed cryptographic token
  const token = signSessionToken(session);

  return { session, token, csrfToken };
}

/**
 * Creates or retrieves a designated trusted local admin session for loopback operations.
 */
export async function createLocalAdminSession(): Promise<{
  session: Session;
  token: string;
  csrfToken: string;
}> {
  return createSession({
    deviceId: "local-host-control",
    role: "admin",
    isLocalLoopback: true,
    ttlSeconds: LOCAL_ADMIN_SESSION_TTL_SECONDS,
    metadata: { source: "loopback-dashboard" },
  });
}

/**
 * Signs a session object into a compact tamper-evident token: header.payload.signature
 */
export function signSessionToken(session: Session, secret: string = currentSigningSecret): string {
  const header = { alg: "HS256", typ: "AGENTIC-SESSION" };
  const payload: SessionTokenPayload = {
    sid: session.sessionId,
    did: session.deviceId,
    rol: session.role,
    iat: Math.floor(session.createdAt / 1000),
    exp: Math.floor(session.expiresAt / 1000),
    csrf: computeSha256(session.csrfToken).slice(0, 16),
    loc: session.isLocalLoopback,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${headerB64}.${payloadB64}`;
  const signature = computeHmac(secret, data);

  return `${data}.${signature}`;
}

/**
 * Verifies a token's cryptographic signature and server-side validity.
 */
export function verifySessionToken(token: string): Session | null {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  const data = `${headerB64}.${payloadB64}`;

  // Check current secret and retired secrets for key rotation
  let validSig = verifyHmac(currentSigningSecret, data, signature);
  if (!validSig) {
    for (const retired of retiredSecrets) {
      if (verifyHmac(retired, data, signature)) {
        validSig = true;
        break;
      }
    }
  }

  if (!validSig) {
    return null;
  }

  let payload: SessionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return null;
  }

  const now = Date.now();
  if (payload.exp * 1000 < now) {
    // Expired
    invalidateSession(payload.sid);
    return null;
  }

  // Check server-side revocation state
  const session = activeSessions.get(payload.sid);
  if (!session) {
    return null;
  }

  if (session.expiresAt < now) {
    invalidateSession(session.sessionId);
    return null;
  }

  return session;
}

/**
 * Revokes a session by session ID.
 */
export function invalidateSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    activeSessions.delete(sessionId);
    const set = deviceSessions.get(session.deviceId);
    if (set) {
      set.delete(sessionId);
      if (set.size === 0) deviceSessions.delete(session.deviceId);
    }
  }
}

/**
 * Revokes all sessions belonging to a specific device.
 */
export function invalidateDeviceSessions(deviceId: string): void {
  const set = deviceSessions.get(deviceId);
  if (set) {
    for (const sid of set) {
      activeSessions.delete(sid);
    }
    deviceSessions.delete(deviceId);
  }
}

/**
 * Revokes all active sessions globally (used during panic lockdown).
 */
export function invalidateAllSessions(): void {
  activeSessions.clear();
  deviceSessions.clear();
}

/**
 * Returns count of active sessions.
 */
export function getActiveSessionCount(): number {
  return activeSessions.size;
}

/**
 * Extracts session cookie or bearer token from standard Request or Headers.
 */
export function extractTokenFromRequest(request: Request): string | null {
  // 1. Check Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }

  // 2. Check Cookie header
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = parseCookieHeader(cookieHeader);
    if (cookies[SESSION_COOKIE_NAME]) {
      return cookies[SESSION_COOKIE_NAME];
    }
    // Also support __Host- prefix
    if (cookies[`__Host-${SESSION_COOKIE_NAME}`]) {
      return cookies[`__Host-${SESSION_COOKIE_NAME}`];
    }
  }

  return null;
}

/**
 * Helper to parse Cookie header into key-value map.
 */
export function parseCookieHeader(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [rawKey, ...valParts] = part.trim().split("=");
    if (rawKey) {
      result[rawKey.trim()] = decodeURIComponent(valParts.join("=").trim());
    }
  }
  return result;
}

/**
 * Builds standard Set-Cookie headers for secure session persistence.
 */
export function buildSessionCookieHeaders(
  token: string,
  csrfToken: string,
  options: { isSecure?: boolean; maxAgeSeconds?: number } = {}
): Headers {
  const headers = new Headers();
  const secureFlag = options.isSecure ? "; Secure" : "";
  const maxAge = options.maxAgeSeconds ?? DEFAULT_SESSION_TTL_SECONDS;

  // Session cookie: HttpOnly, SameSite=Strict, Path=/
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureFlag}`
  );

  // CSRF token cookie: readable by frontend to echo back in x-csrf-token header
  headers.append(
    "Set-Cookie",
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Strict; Max-Age=${maxAge}${secureFlag}`
  );

  return headers;
}

/**
 * Validates request authentication, session validity, and CSRF token for state-mutating methods.
 */
export async function validateRequestSecurity(
  request: Request,
  requiredRole?: Role
): Promise<{
  authorized: boolean;
  session?: Session;
  error?: string;
  status: number;
}> {
  const token = extractTokenFromRequest(request);
  if (!token) {
    return {
      authorized: false,
      error: "Authentication required. Missing session cookie or bearer token.",
      status: 401,
    };
  }

  const session = verifySessionToken(token);
  if (!session) {
    return {
      authorized: false,
      error: "Invalid or expired session.",
      status: 401,
    };
  }

  // Capability/Role check
  if (requiredRole && !hasMinimumRole(session.role, requiredRole)) {
    return {
      authorized: false,
      session,
      error: `Forbidden: role '${session.role}' lacks required capability '${requiredRole}'.`,
      status: 403,
    };
  }

  // State-mutating methods require CSRF validation
  const method = request.method.toUpperCase();
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    const clientCsrf =
      request.headers.get(CSRF_HEADER_NAME) ||
      request.headers.get("x-xsrf-token");

    if (!clientCsrf) {
      return {
        authorized: false,
        session,
        error: "CSRF protection failure: missing anti-CSRF token in headers.",
        status: 403,
      };
    }

    if (!constantTimeCompare(clientCsrf, session.csrfToken)) {
      return {
        authorized: false,
        session,
        error: "CSRF protection failure: anti-CSRF token mismatch.",
        status: 403,
      };
    }
  }

  return {
    authorized: true,
    session,
    status: 200,
  };
}
