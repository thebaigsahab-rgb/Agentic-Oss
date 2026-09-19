import {
  generateCsprngToken,
  generateCsprngPin,
  hashWithSalt,
  verifyHashWithSalt,
} from "./crypto";
import {
  createSession,
  invalidateDeviceSessions,
  type Role,
} from "./session";

export type PairingStatus = "PENDING" | "CONSUMED" | "EXPIRED" | "REVOKED";

export interface PairingRecord {
  pairingId: string;
  tokenHash: string;
  tokenSalt: string;
  pinHash: string;
  pinSalt: string;
  role: Role;
  createdAt: number;
  expiresAt: number;
  status: PairingStatus;
  requestedByDeviceId?: string;
}

export interface PairedDevice {
  deviceId: string;
  deviceName: string;
  role: Role;
  pairedAt: number;
  lastActiveAt: number;
  status: "ACTIVE" | "REVOKED";
  userAgent?: string;
}

export const PAIRING_TTL_MS = 60 * 1000; // Strict 60-second TTL

// In-memory pairing records & device registry with atomic state transitions
const pairingRecords = new Map<string, PairingRecord>();
const pairedDevices = new Map<string, PairedDevice>();

/**
 * Initiates a cryptographic pairing challenge.
 * Generates high-entropy token and dynamic QR payload with a strict 60-second TTL.
 */
export async function initiatePairing(params: {
  role?: Role;
  requestedByDeviceId?: string;
  serverHost?: string;
} = {}): Promise<{
  pairingId: string;
  rawToken: string;
  pin: string;
  qrPayload: string;
  expiresAt: number;
}> {
  const pairingId = generateCsprngToken(16);
  const rawToken = generateCsprngToken(32); // 256 bits entropy
  const pin = generateCsprngPin(6);
  const now = Date.now();
  const expiresAt = now + PAIRING_TTL_MS;
  const role = params.role || "routine-only";

  // Hash pairing secrets with salted SHA-256 before persisting
  const { hash: tokenHash, salt: tokenSalt } = hashWithSalt(rawToken);
  const { hash: pinHash, salt: pinSalt } = hashWithSalt(pin);

  const record: PairingRecord = {
    pairingId,
    tokenHash,
    tokenSalt,
    pinHash,
    pinSalt,
    role,
    createdAt: now,
    expiresAt,
    status: "PENDING",
    requestedByDeviceId: params.requestedByDeviceId,
  };

  pairingRecords.set(pairingId, record);

  // Clean up after expiry
  const expiryTimer = setTimeout(() => {
    const existing = pairingRecords.get(pairingId);
    if (existing && existing.status === "PENDING" && Date.now() > existing.expiresAt) {
      existing.status = "EXPIRED";
    }
  }, PAIRING_TTL_MS + 2000);
  if (expiryTimer && typeof expiryTimer.unref === "function") {
    expiryTimer.unref();
  }

  // QR Code structured payload
  const qrPayload = JSON.stringify({
    v: 1,
    pid: pairingId,
    tok: rawToken,
    srv: params.serverHost || "127.0.0.1:3000",
    exp: expiresAt,
  });

  return {
    pairingId,
    rawToken,
    pin,
    qrPayload,
    expiresAt,
  };
}

/**
 * Consumes an ephemeral pairing token, enforcing one-time usability (replay immunity),
 * strict 60-second TTL, constant-time verification, and session minting.
 */
export async function consumePairingToken(params: {
  pairingId: string;
  rawToken: string;
  pin?: string;
  deviceName: string;
  userAgent?: string;
}): Promise<{
  deviceId: string;
  sessionToken: string;
  csrfToken: string;
  role: Role;
}> {
  const { pairingId, rawToken, pin, deviceName, userAgent } = params;

  const record = pairingRecords.get(pairingId);
  if (!record) {
    throw new Error("Invalid or non-existent pairing challenge.");
  }

  // Enforce Replay Immunity
  if (record.status === "CONSUMED") {
    throw new Error("Pairing token has already been consumed (replay attack detected).");
  }

  if (record.status === "REVOKED") {
    throw new Error("Pairing challenge has been revoked.");
  }

  // Enforce Strict TTL (60 seconds)
  const now = Date.now();
  if (now > record.expiresAt || record.status === "EXPIRED") {
    record.status = "EXPIRED";
    throw new Error("Pairing token has expired.");
  }

  // Constant-time token verification
  const isTokenValid = verifyHashWithSalt(rawToken, record.tokenHash, record.tokenSalt);
  if (!isTokenValid) {
    throw new Error("Cryptographic pairing token verification failed.");
  }

  // Optional PIN verification if PIN was provided
  if (pin) {
    const isPinValid = verifyHashWithSalt(pin, record.pinHash, record.pinSalt);
    if (!isPinValid) {
      throw new Error("Pairing PIN verification failed.");
    }
  }

  // Atomic state transition: Mark CONSUMED immediately to prevent replay
  record.status = "CONSUMED";

  // Register device
  const deviceId = `dev_${generateCsprngToken(12)}`;
  const device: PairedDevice = {
    deviceId,
    deviceName: deviceName.trim().slice(0, 50) || "Remote Controller",
    role: record.role,
    pairedAt: now,
    lastActiveAt: now,
    status: "ACTIVE",
    userAgent,
  };
  pairedDevices.set(deviceId, device);

  // Mint authenticated session
  const { token: sessionToken, csrfToken } = await createSession({
    deviceId,
    role: record.role,
    metadata: { deviceName: device.deviceName, userAgent },
  });

  return {
    deviceId,
    sessionToken,
    csrfToken,
    role: record.role,
  };
}

/**
 * Revokes a device and atomically terminates all active sessions.
 */
export async function revokeDevice(deviceId: string): Promise<boolean> {
  const device = pairedDevices.get(deviceId);
  if (device) {
    device.status = "REVOKED";
  }

  // Invalidate all pairing records for this device
  for (const record of pairingRecords.values()) {
    if (record.requestedByDeviceId === deviceId) {
      record.status = "REVOKED";
    }
  }

  // Invalidate all active sessions for this device
  invalidateDeviceSessions(deviceId);

  return true;
}

/**
 * Returns a paired device by ID.
 */
export function getPairedDevice(deviceId: string): PairedDevice | null {
  return pairedDevices.get(deviceId) || null;
}

/**
 * Lists all paired devices.
 */
export function listPairedDevices(): PairedDevice[] {
  return Array.from(pairedDevices.values());
}

/**
 * Helper to reset pairing registry state (used for testing).
 */
export function resetPairingState(): void {
  pairingRecords.clear();
  pairedDevices.clear();
}
