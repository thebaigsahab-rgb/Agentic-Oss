import {
  generateCsprngToken,
  computeHmac,
  verifyHmac,
  constantTimeCompare,
  computeSha256,
} from "./crypto";
import { type Role, type Session, hasMinimumRole } from "./session";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";

export interface ApprovalRequest {
  requestId: string;
  deviceId: string;
  targetCapability: Role;
  actionType: string;
  parameters: Record<string, unknown>;
  parametersHash: string;
  description: string;
  requestedAt: number;
  expiresAt: number;
  status: ApprovalStatus;
  decisionByDeviceId?: string;
  decisionAt?: number;
}

export interface SignedApprovalTicket {
  ticketId: string;
  requestId: string;
  actionType: string;
  parametersHash: string;
  targetCapability: Role;
  approvedBy: string;
  approvedAt: number;
  expiresAt: number;
  signature: string;
  consumed: boolean;
}

export const APPROVAL_REQUEST_TTL_MS = 5 * 60 * 1000; // 5 minutes to approve
export const APPROVAL_TICKET_TTL_MS = 2 * 60 * 1000;  // 2 minutes to execute once approved

// Cryptographic ticket signing secret
const ticketSigningSecret = generateCsprngToken(32);

// Server-side approval request and ticket stores
const approvalRequests = new Map<string, ApprovalRequest>();
const approvalTickets = new Map<string, SignedApprovalTicket>();

/**
 * Computes a deterministic canonical SHA-256 hash of action parameters.
 */
export function canonicalizeAndHashParams(params: Record<string, unknown>): string {
  const sortedKeys = Object.keys(params).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    sortedObj[k] = params[k];
  }
  return computeSha256(JSON.stringify(sortedObj));
}

/**
 * Proposes a privileged action by creating an immutable, serialized ApprovalRequest.
 * Decouples action proposal from execution.
 */
export async function createApprovalRequest(params: {
  deviceId: string;
  targetCapability: Role;
  actionType: string;
  parameters: Record<string, unknown>;
  description?: string;
}): Promise<ApprovalRequest> {
  const requestId = `req_${generateCsprngToken(16)}`;
  const now = Date.now();
  const expiresAt = now + APPROVAL_REQUEST_TTL_MS;
  const parametersHash = canonicalizeAndHashParams(params.parameters);

  const request: ApprovalRequest = {
    requestId,
    deviceId: params.deviceId,
    targetCapability: params.targetCapability,
    actionType: params.actionType,
    parameters: params.parameters,
    parametersHash,
    description: params.description || `Execution of ${params.actionType}`,
    requestedAt: now,
    expiresAt,
    status: "PENDING",
  };

  approvalRequests.set(requestId, request);

  // Auto-expire
  const expireTimer = setTimeout(() => {
    const existing = approvalRequests.get(requestId);
    if (existing && existing.status === "PENDING" && Date.now() > existing.expiresAt) {
      existing.status = "EXPIRED";
    }
  }, APPROVAL_REQUEST_TTL_MS + 1000);
  if (expireTimer && typeof expireTimer.unref === "function") {
    expireTimer.unref();
  }

  return request;
}

/**
 * Resolves an ApprovalRequest out-of-band by a trusted administrative session.
 * Rejects any untrusted client/browser booleans.
 */
export async function resolveApprovalRequest(params: {
  requestId: string;
  adminSession: Session;
  decision: "APPROVED" | "REJECTED";
}): Promise<{
  request: ApprovalRequest;
  ticket?: SignedApprovalTicket;
}> {
  const { requestId, adminSession, decision } = params;

  // Enforce administrative authorization
  if (!hasMinimumRole(adminSession.role, "admin") && !adminSession.isLocalLoopback) {
    throw new Error("Only trusted administrative or local loopback sessions may resolve approval requests.");
  }

  const req = approvalRequests.get(requestId);
  if (!req) {
    throw new Error("Approval request not found.");
  }

  if (req.status !== "PENDING") {
    throw new Error(`Cannot resolve request in '${req.status}' state.`);
  }

  const now = Date.now();
  if (now > req.expiresAt) {
    req.status = "EXPIRED";
    throw new Error("Approval request has expired.");
  }

  req.decisionAt = now;
  req.decisionByDeviceId = adminSession.deviceId;

  if (decision === "REJECTED") {
    req.status = "REJECTED";
    return { request: req };
  }

  req.status = "APPROVED";

  // Generate cryptographically signed ApprovalTicket
  const ticketId = `tkt_${generateCsprngToken(16)}`;
  const ticketExpiresAt = now + APPROVAL_TICKET_TTL_MS;

  const dataToSign = `${ticketId}:${req.requestId}:${req.actionType}:${req.parametersHash}:${req.targetCapability}:${adminSession.deviceId}:${now}:${ticketExpiresAt}`;
  const signature = computeHmac(ticketSigningSecret, dataToSign);

  const ticket: SignedApprovalTicket = {
    ticketId,
    requestId: req.requestId,
    actionType: req.actionType,
    parametersHash: req.parametersHash,
    targetCapability: req.targetCapability,
    approvedBy: adminSession.deviceId,
    approvedAt: now,
    expiresAt: ticketExpiresAt,
    signature,
    consumed: false,
  };

  approvalTickets.set(ticketId, ticket);

  return { request: req, ticket };
}

/**
 * Strict verification and consumption of an Approval Ticket.
 * - Rejects forged client booleans ({ approved: true })
 * - Verifies cryptographic HMAC signature
 * - Verifies parameter hash matching
 * - Enforces single-use replay immunity and TTL
 */
export function verifyAndConsumeTicket(
  ticketInput: unknown,
  expectedActionType: string,
  actualParams: Record<string, unknown>
): { valid: boolean; error?: string; ticket?: SignedApprovalTicket } {
  // Reject browser booleans or empty tickets
  if (!ticketInput || typeof ticketInput !== "object") {
    return {
      valid: false,
      error: "Privileged action requires a valid, cryptographically signed ApprovalTicket. Untrusted client flags are rejected.",
    };
  }

  const candidate = ticketInput as Partial<SignedApprovalTicket>;
  if (!candidate.ticketId || !candidate.signature) {
    return {
      valid: false,
      error: "Malformed approval ticket: missing ticketId or signature.",
    };
  }

  const storedTicket = approvalTickets.get(candidate.ticketId);
  if (!storedTicket) {
    return {
      valid: false,
      error: "Approval ticket not recognized or has been purged.",
    };
  }

  // Check replay immunity
  if (storedTicket.consumed) {
    return {
      valid: false,
      error: "Approval ticket has already been consumed (replay attack blocked).",
    };
  }

  // Check TTL
  const now = Date.now();
  if (now > storedTicket.expiresAt) {
    return {
      valid: false,
      error: "Approval ticket has expired.",
    };
  }

  // Verify signature
  const dataToVerify = `${storedTicket.ticketId}:${storedTicket.requestId}:${storedTicket.actionType}:${storedTicket.parametersHash}:${storedTicket.targetCapability}:${storedTicket.approvedBy}:${storedTicket.approvedAt}:${storedTicket.expiresAt}`;
  const signatureValid = verifyHmac(ticketSigningSecret, dataToVerify, candidate.signature);
  if (!signatureValid) {
    return {
      valid: false,
      error: "Cryptographic signature verification failed for approval ticket.",
    };
  }

  // Verify action type match
  if (storedTicket.actionType !== expectedActionType) {
    return {
      valid: false,
      error: `Ticket action mismatch: issued for '${storedTicket.actionType}', attempted '${expectedActionType}'.`,
    };
  }

  // Verify parameters hash match
  const actualHash = canonicalizeAndHashParams(actualParams);
  if (!constantTimeCompare(storedTicket.parametersHash, actualHash)) {
    return {
      valid: false,
      error: "Parameter integrity check failed: parameters do not match approved ticket hash.",
    };
  }

  // Atomically mark ticket consumed
  storedTicket.consumed = true;

  return {
    valid: true,
    ticket: storedTicket,
  };
}

export function getApprovalRequest(requestId: string): ApprovalRequest | null {
  return approvalRequests.get(requestId) || null;
}

export function listPendingApprovalRequests(): ApprovalRequest[] {
  const now = Date.now();
  return Array.from(approvalRequests.values()).filter(
    (r) => r.status === "PENDING" && r.expiresAt > now
  );
}

export function resetApprovalState(): void {
  approvalRequests.clear();
  approvalTickets.clear();
}
