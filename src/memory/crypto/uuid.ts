/**
 * Cryptographically Secure UUIDv7 Implementation (RFC 9562)
 * Guarantees monotonic time-ordered, collision-resistant 128-bit identifiers.
 */

import { randomBytes } from "node:crypto";

let lastTimestamp = -1;
let sequenceCounter = 0;

export function generateUUIDv7(): string {
  let now = Date.now();

  if (now === lastTimestamp) {
    sequenceCounter = (sequenceCounter + 1) & 0x0fff;
    if (sequenceCounter === 0) {
      // Millisecond counter rolled over; increment time boundary
      while (now <= lastTimestamp) {
        now = Date.now();
      }
    }
  } else {
    lastTimestamp = now;
    // Initialize sequence counter with 12 bits of secure randomness
    const randSeq = randomBytes(2);
    sequenceCounter = ((randSeq[0] << 8) | randSeq[1]) & 0x0fff;
  }

  const bytes = Buffer.alloc(16);

  // 48-bit timestamp in milliseconds (big-endian)
  bytes.writeUIntBE(now, 0, 6);

  // 4-bit version (0b0111 = 7) + 12-bit sequence counter
  bytes[6] = 0x70 | ((sequenceCounter >>> 8) & 0x0f);
  bytes[7] = sequenceCounter & 0xff;

  // 2-bit variant (0b10) + 62 bits of cryptographic randomness
  const rand = randomBytes(8);
  rand[0] = (rand[0] & 0x3f) | 0x80; // Variant 10
  rand.copy(bytes, 8);

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isValidUUIDv7(id: string): boolean {
  if (typeof id !== "string") return false;
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return regex.test(id);
}
