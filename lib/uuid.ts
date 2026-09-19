/**
 * Universal RFC 4122 v4 UUID generator.
 * Works seamlessly in:
 * - Secure Contexts (HTTPS, localhost) where native crypto.randomUUID is present
 * - Insecure Contexts (HTTP on LAN IP, e.g. http://192.168.0.36:3000) where window.crypto.randomUUID is undefined
 * - Node.js server environments
 */
export function safeRandomUUID(): string {
  // 1. Try native crypto.randomUUID if available
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through if it throws in restricted contexts
    }
  }

  // 2. Try Web Crypto getRandomValues if available
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    try {
      return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (
          Number(c) ^
          (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
        ).toString(16)
      );
    } catch {
      // Fall through to Math.random
    }
  }

  // 3. Robust RFC 4122 v4 compliant fallback using Math.random
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
