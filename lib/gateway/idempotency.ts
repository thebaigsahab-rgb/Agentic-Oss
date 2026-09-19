import type { IdempotencyEntry } from "./types";

/**
 * 24-Hour Webhook Deduplication & Idempotency Store
 * Ensures exactly-once processing across network retries and duplicate webhooks.
 */
export class IdempotencyStore {
  private static instance: IdempotencyStore | null = null;
  private readonly entries = new Map<string, IdempotencyEntry>();
  private readonly ttlMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(ttlMs = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.scheduleCleanup();
  }

  public static getInstance(ttlMs?: number): IdempotencyStore {
    if (!IdempotencyStore.instance) {
      IdempotencyStore.instance = new IdempotencyStore(ttlMs);
    }
    return IdempotencyStore.instance;
  }

  /**
   * Atomically claims a deduplication key.
   * Returns 'ACQUIRED' if newly claimed, or 'DUPLICATE' if already seen within TTL window.
   */
  public claim(key: string, senderNumber: string): "ACQUIRED" | "DUPLICATE" {
    if (!key || typeof key !== "string") {
      return "ACQUIRED";
    }

    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing) {
      if (now - existing.firstSeenAt < this.ttlMs) {
        return "DUPLICATE";
      }
      // Expired entry, allow re-claim
    }

    this.entries.set(key, {
      key,
      firstSeenAt: now,
      senderNumber,
      status: "PROCESSING",
    });

    return "ACQUIRED";
  }

  /**
   * Marks a previously claimed key as completed.
   */
  public complete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.status = "PROCESSED";
    }
  }

  /**
   * Checks whether a key has already been seen and is still valid.
   */
  public isDuplicate(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    return Date.now() - entry.firstSeenAt < this.ttlMs;
  }

  /**
   * Clears all entries. Essential for isolated testing.
   */
  public clear(): void {
    this.entries.clear();
  }

  /**
   * Sweeps expired records past TTL.
   */
  public sweep(): number {
    const now = Date.now();
    let swept = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.firstSeenAt >= this.ttlMs) {
        this.entries.delete(key);
        swept++;
      }
    }
    return swept;
  }

  /**
   * Stops cleanup timer if active.
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private scheduleCleanup(): void {
    // Run cleanup every hour. Unref timer so Node process is never kept alive.
    this.cleanupTimer = setInterval(() => {
      this.sweep();
    }, 60 * 60 * 1000);

    if (this.cleanupTimer && typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
  }
}

export const globalIdempotencyStore = IdempotencyStore.getInstance();
