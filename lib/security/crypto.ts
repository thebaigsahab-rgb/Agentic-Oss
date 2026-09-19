import {
  randomBytes,
  randomInt,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";

/**
 * Enterprise Cryptographic Primitives for Zero-Trust Agentic OS
 * 
 * Implements CSPRNG token generation, constant-time comparisons,
 * salted SHA-256 hash generation, and HMAC-SHA256 signatures.
 */

export const MIN_TOKEN_ENTROPY_BYTES = 32; // 256 bits of entropy

/**
 * Generates cryptographically secure pseudo-random bytes.
 */
export function generateCsprngBytes(length: number = MIN_TOKEN_ENTROPY_BYTES): Buffer {
  if (length < 8) {
    throw new Error("CSPRNG buffer length must be at least 8 bytes.");
  }
  return randomBytes(length);
}

/**
 * Generates a URL-safe base64 encoded CSPRNG token with at least 256-bit entropy.
 */
export function generateCsprngToken(bytes: number = MIN_TOKEN_ENTROPY_BYTES): string {
  return generateCsprngBytes(bytes).toString("base64url");
}

/**
 * Generates a cryptographically secure numeric pairing PIN.
 */
export function generateCsprngPin(digits: number = 6): string {
  if (digits < 6) {
    throw new Error("Pairing PIN must be at least 6 digits.");
  }
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits);
  return String(randomInt(min, max));
}

/**
 * Constant-time equality comparison that resists timing attacks.
 * Uses SHA-256 hashing of both operands to normalize lengths to fixed 32-byte buffers
 * before invoking crypto.timingSafeEqual, preventing length-dependent timing leakage.
 */
export function constantTimeCompare(
  a: string | Buffer | null | undefined,
  b: string | Buffer | null | undefined
): boolean {
  if (a == null || b == null) {
    return false;
  }

  const bufA = typeof a === "string" ? Buffer.from(a, "utf-8") : a;
  const bufB = typeof b === "string" ? Buffer.from(b, "utf-8") : b;

  // Direct length check can be a micro-timing vector; hash both buffers first
  // to ensure constant-length inputs (32 bytes) to timingSafeEqual.
  const hashA = createHash("sha256").update(bufA).digest();
  const hashB = createHash("sha256").update(bufB).digest();

  const hashesMatch = timingSafeEqual(hashA, hashB);
  const lengthsMatch = bufA.length === bufB.length;

  return hashesMatch && lengthsMatch;
}

/**
 * Salted SHA-256 hash generator using CSPRNG 256-bit salt.
 */
export function hashWithSalt(
  data: string | Buffer,
  providedSalt?: Buffer | string
): { hash: string; salt: string } {
  const saltBuf = providedSalt
    ? typeof providedSalt === "string"
      ? Buffer.from(providedSalt, "hex")
      : providedSalt
    : generateCsprngBytes(32);

  const dataBuf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;

  const hash = createHash("sha256")
    .update(saltBuf)
    .update(dataBuf)
    .digest("hex");

  return {
    hash,
    salt: saltBuf.toString("hex"),
  };
}

/**
 * Verifies data against a stored salted SHA-256 hash using constant-time comparison.
 */
export function verifyHashWithSalt(
  data: string | Buffer,
  expectedHash: string,
  saltHex: string
): boolean {
  try {
    const saltBuf = Buffer.from(saltHex, "hex");
    const { hash: computedHash } = hashWithSalt(data, saltBuf);
    return constantTimeCompare(computedHash, expectedHash);
  } catch {
    return false;
  }
}

/**
 * Computes an HMAC-SHA256 signature for data with a secret key.
 */
export function computeHmac(
  key: string | Buffer,
  data: string | Buffer
): string {
  const keyBuf = typeof key === "string" ? Buffer.from(key, "utf-8") : key;
  const dataBuf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return createHmac("sha256", keyBuf).update(dataBuf).digest("base64url");
}

/**
 * Verifies an HMAC-SHA256 signature using constant-time comparison.
 */
export function verifyHmac(
  key: string | Buffer,
  data: string | Buffer,
  signature: string
): boolean {
  try {
    const expected = computeHmac(key, data);
    return constantTimeCompare(expected, signature);
  } catch {
    return false;
  }
}

/**
 * Computes SHA-256 digest of arbitrary data.
 */
export function computeSha256(data: string | Buffer): string {
  const dataBuf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return createHash("sha256").update(dataBuf).digest("hex");
}
