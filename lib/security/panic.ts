import { computeSha256, generateCsprngToken } from "./crypto";
import { invalidateAllSessions, type Role } from "./session";
import { terminateAllSubprocesses } from "./catalog";

export interface AuditEvent {
  id: string;
  timestamp: number;
  deviceId: string;
  actorRole: Role | "system";
  targetCapability: string;
  parametersHash: string;
  approvalStatus: string;
  executionResult: string;
  prevHash: string;
  signatureHash: string;
}

export interface LockdownResult {
  lockedDown: boolean;
  timestamp: number;
  terminatedProcesses: number;
  invalidatedSessions: boolean;
  reason: string;
  initiatedBy: string;
}

// System-wide lockdown state
let isLockedDown = false;
let lockdownMetadata: LockdownResult | null = null;

// Reverse relay socket registry
const relayConnections = new Set<{ close: () => void; id?: string }>();

export function registerRelayConnection(conn: { close: () => void; id?: string }): void {
  relayConnections.add(conn);
}

export function unregisterRelayConnection(conn: { close: () => void; id?: string }): void {
  relayConnections.delete(conn);
}

export function isSystemLockedDown(): boolean {
  return isLockedDown;
}

export function getLockdownMetadata(): LockdownResult | null {
  return lockdownMetadata;
}

/**
 * Executes a panic circuit breaker lockdown.
 * Atomically invalidates sessions, terminates child processes, and closes reverse relays.
 */
export async function triggerGlobalLockdown(
  reason: string,
  initiatedBy: string = "system"
): Promise<LockdownResult> {
  isLockedDown = true;
  const now = Date.now();

  // 1. Invalidate all sessions globally
  invalidateAllSessions();

  // 2. Kill all active child processes
  const terminated = terminateAllSubprocesses();

  // 3. Terminate all active relay connections
  for (const conn of relayConnections) {
    try {
      conn.close();
    } catch {}
  }
  relayConnections.clear();

  lockdownMetadata = {
    lockedDown: true,
    timestamp: now,
    terminatedProcesses: terminated,
    invalidatedSessions: true,
    reason,
    initiatedBy,
  };

  // 4. Record tamper-evident emergency audit event
  await logAuditEvent({
    deviceId: initiatedBy,
    actorRole: "system",
    targetCapability: "admin",
    parametersHash: computeSha256(reason),
    approvalStatus: "EMERGENCY_LOCKDOWN",
    executionResult: `SUCCESS: Terminated ${terminated} processes.`,
  });

  return lockdownMetadata;
}

/**
 * Resets the panic lockdown following administrative authorization.
 */
export async function resetGlobalLockdown(authorizedActor: string): Promise<boolean> {
  isLockedDown = false;
  lockdownMetadata = null;

  await logAuditEvent({
    deviceId: authorizedActor,
    actorRole: "admin",
    targetCapability: "admin",
    parametersHash: computeSha256("RESET_LOCKDOWN"),
    approvalStatus: "ADMIN_RESET",
    executionResult: "SUCCESS: System lockdown cleared.",
  });

  return true;
}

// ---------------------------------------------------------------------------
// Append-Only Tamper-Evident Hash-Chained Audit Logger
// ---------------------------------------------------------------------------

const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
const auditLogChain: AuditEvent[] = [];

/**
 * Records an immutable audit log entry chained cryptographically to the previous entry.
 */
export async function logAuditEvent(params: {
  deviceId: string;
  actorRole: Role | "system";
  targetCapability: string;
  parametersHash: string;
  approvalStatus: string;
  executionResult: string;
}): Promise<AuditEvent> {
  const prevEntry = auditLogChain[auditLogChain.length - 1];
  const prevHash = prevEntry ? prevEntry.signatureHash : GENESIS_HASH;
  const id = `aud_${generateCsprngToken(12)}`;
  const timestamp = Date.now();

  const dataToHash = `${id}|${timestamp}|${params.deviceId}|${params.actorRole}|${params.targetCapability}|${params.parametersHash}|${params.approvalStatus}|${params.executionResult}|${prevHash}`;
  const signatureHash = computeSha256(dataToHash);

  const entry: AuditEvent = {
    id,
    timestamp,
    deviceId: params.deviceId,
    actorRole: params.actorRole,
    targetCapability: params.targetCapability,
    parametersHash: params.parametersHash,
    approvalStatus: params.approvalStatus,
    executionResult: params.executionResult,
    prevHash,
    signatureHash,
  };

  auditLogChain.push(entry);
  return entry;
}

/**
 * Cryptographically verifies the integrity of the entire audit log chain.
 * Detects any tampering, alteration, or insertion in past records.
 */
export function verifyAuditLogIntegrity(): {
  valid: boolean;
  totalEntries: number;
  tamperedAt?: number;
} {
  let prevExpectedHash = GENESIS_HASH;

  for (let i = 0; i < auditLogChain.length; i++) {
    const entry = auditLogChain[i];

    // Verify linkage to previous entry
    if (entry.prevHash !== prevExpectedHash) {
      return { valid: false, totalEntries: auditLogChain.length, tamperedAt: i };
    }

    // Recompute current entry hash
    const dataToHash = `${entry.id}|${entry.timestamp}|${entry.deviceId}|${entry.actorRole}|${entry.targetCapability}|${entry.parametersHash}|${entry.approvalStatus}|${entry.executionResult}|${entry.prevHash}`;
    const recomputedHash = computeSha256(dataToHash);

    if (recomputedHash !== entry.signatureHash) {
      return { valid: false, totalEntries: auditLogChain.length, tamperedAt: i };
    }

    prevExpectedHash = entry.signatureHash;
  }

  return { valid: true, totalEntries: auditLogChain.length };
}

/**
 * Returns read-only slice of recent audit logs.
 */
export function getRecentAuditLogs(limit = 50): AuditEvent[] {
  return auditLogChain.slice(-limit);
}

/**
 * Resets audit log chain (used for test isolation).
 */
export function resetAuditLog(): void {
  auditLogChain.length = 0;
}
