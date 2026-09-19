import {
  createHmac,
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

/**
 * Enterprise Cryptographic & Validation Utilities for WhatsApp Gateway
 */

// Characters excluding ambiguous 0, O, I, 1
export const APPROVAL_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * Generates an unambiguous cryptographically secure 6-character approval code.
 */
export function generateApprovalCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    const idx = randomInt(0, APPROVAL_CHARSET.length);
    code += APPROVAL_CHARSET[idx];
  }
  return code;
}

/**
 * Constant-time string and buffer comparison resisting timing side-channel attacks.
 */
export function timingSafeStringCompare(
  a: string | Buffer | null | undefined,
  b: string | Buffer | null | undefined
): boolean {
  if (a == null || b == null) return false;

  const bufA = typeof a === "string" ? Buffer.from(a, "utf-8") : a;
  const bufB = typeof b === "string" ? Buffer.from(b, "utf-8") : b;

  const hashA = createHash("sha256").update(bufA).digest();
  const hashB = createHash("sha256").update(bufB).digest();

  const hashesMatch = timingSafeEqual(hashA, hashB);
  const lengthsMatch = bufA.length === bufB.length;

  return hashesMatch && lengthsMatch;
}

/**
 * Computes an HMAC-SHA256 signature in hex.
 */
export function computeHmacSha256Hex(key: string, data: string | Buffer): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

/**
 * Computes an HMAC-SHA1 signature in base64 (used by Twilio).
 */
export function computeHmacSha1Base64(key: string, data: string | Buffer): string {
  return createHmac("sha1", key).update(data).digest("base64");
}

/**
 * Computes salted SHA-256 for storing approval tokens securely.
 */
export function hashApprovalCode(
  code: string,
  saltHex?: string
): { hash: string; salt: string } {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
  const normalizedCode = code.trim().toUpperCase();
  const hash = createHash("sha256")
    .update(salt)
    .update(Buffer.from(normalizedCode, "utf-8"))
    .digest("hex");

  return { hash, salt: salt.toString("hex") };
}

/**
 * Verifies an entered approval code against salted hash in constant time.
 */
export function verifyApprovalCode(
  candidateCode: string,
  expectedHash: string,
  saltHex: string
): boolean {
  try {
    const { hash } = hashApprovalCode(candidateCode, saltHex);
    return timingSafeStringCompare(hash, expectedHash);
  } catch {
    return false;
  }
}

/**
 * Strict E.164 phone number regular expression:
 * Must start with '+', followed by country code (1-9), and 7 to 14 digits (total 8-15 digits).
 */
export const E164_REGEX = /^\+[1-9]\d{7,14}$/;

/**
 * Normalizes phone numbers to standard E.164 format and validates rigorously.
 * Rejects any non-numeric noise or invalid formats.
 */
export function normalizeE164(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;

  let cleaned = raw.trim();
  // Strip 'whatsapp:' prefix if present (Twilio format)
  if (cleaned.toLowerCase().startsWith("whatsapp:")) {
    cleaned = cleaned.slice(9).trim();
  }

  // If starts with 00, replace with +
  if (cleaned.startsWith("00")) {
    cleaned = "+" + cleaned.slice(2);
  }

  // Remove spaces, hyphens, parentheses
  cleaned = cleaned.replace(/[\s\-()]/g, "");

  // If local Pakistani 03XX number provided, prepend +92
  if (/^03\d{9}$/.test(cleaned)) {
    cleaned = "+92" + cleaned.slice(1);
  }

  // Ensure starts with +
  if (!cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  }

  if (!E164_REGEX.test(cleaned)) {
    return null;
  }

  return cleaned;
}

/**
 * Validates whether a normalized phone number exists in the configured allowlist.
 */
export function isNumberAllowlisted(
  number: string,
  allowlistEnv: string = process.env.WHATSAPP_ALLOWED_NUMBERS || ""
): boolean {
  const normalized = normalizeE164(number);
  if (!normalized) return false;

  const allowedList = allowlistEnv
    .split(",")
    .map((item) => normalizeE164(item))
    .filter((n): n is string => Boolean(n));

  return allowedList.includes(normalized);
}
