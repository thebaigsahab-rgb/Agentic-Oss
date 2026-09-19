/**
 * Tamper-Evident Hash-Chained Audit Trail
 *
 * Appends cryptographic hash-chained audit records for every lifecycle event
 * (demonstrations, verification, dry-run simulations, live executions, approvals,
 * drift haltage, compensations, and revocation).
 */

import { createHash } from "node:crypto";
import type { AuditLogEntry } from "./types";

export const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

export class AuditLogger {
  private log: AuditLogEntry[] = [];

  constructor(initialEntries?: AuditLogEntry[]) {
    if (initialEntries && initialEntries.length > 0) {
      this.log = [...initialEntries];
      const validation = this.verifyChainIntegrity();
      if (!validation.valid) {
        throw new Error(`Cannot initialize AuditLogger with corrupted chain: ${validation.error}`);
      }
    }
  }

  /**
   * Appends a new audit record to the hash chain.
   */
  public append(params: {
    eventType: AuditLogEntry["eventType"];
    actor: string;
    payload: Record<string, unknown>;
    skillId?: string;
    stepId?: string;
    timestamp?: number;
  }): AuditLogEntry {
    const sequenceNum = this.log.length;
    const timestamp = params.timestamp ?? Date.now();
    const previousHash = sequenceNum === 0 ? GENESIS_HASH : this.log[sequenceNum - 1].entryHash;

    const payloadDigest = createHash("sha256")
      .update(JSON.stringify(params.payload, Object.keys(params.payload).sort()))
      .digest("hex");

    const entryHash = createHash("sha256")
      .update(
        `${previousHash}:${sequenceNum}:${timestamp}:${params.eventType}:${params.actor}:${payloadDigest}:${params.skillId || ""}:${params.stepId || ""}`
      )
      .digest("hex");

    const entry: AuditLogEntry = {
      sequenceNum,
      timestamp,
      eventType: params.eventType,
      actor: params.actor,
      payload: params.payload,
      skillId: params.skillId,
      stepId: params.stepId,
      previousHash,
      entryHash,
    };

    this.log.push(entry);
    return entry;
  }

  /**
   * Returns all audit entries.
   */
  public getEntries(): ReadonlyArray<AuditLogEntry> {
    return this.log;
  }

  /**
   * Returns audit entries filtered by skill ID.
   */
  public getEntriesBySkill(skillId: string): AuditLogEntry[] {
    return this.log.filter((entry) => entry.skillId === skillId);
  }

  /**
   * Verifies the cryptographic integrity of the entire audit chain.
   */
  public verifyChainIntegrity(): { valid: boolean; corruptedAtIndex?: number; error?: string } {
    for (let i = 0; i < this.log.length; i++) {
      const entry = this.log[i];
      const expectedPrevHash = i === 0 ? GENESIS_HASH : this.log[i - 1].entryHash;

      if (entry.previousHash !== expectedPrevHash) {
        return {
          valid: false,
          corruptedAtIndex: i,
          error: `Broken chain link at index ${i}: expected prevHash ${expectedPrevHash}, found ${entry.previousHash}`,
        };
      }

      const payloadDigest = createHash("sha256")
        .update(JSON.stringify(entry.payload, Object.keys(entry.payload).sort()))
        .digest("hex");

      const expectedEntryHash = createHash("sha256")
        .update(
          `${entry.previousHash}:${entry.sequenceNum}:${entry.timestamp}:${entry.eventType}:${entry.actor}:${payloadDigest}:${entry.skillId || ""}:${entry.stepId || ""}`
        )
        .digest("hex");

      if (entry.entryHash !== expectedEntryHash) {
        return {
          valid: false,
          corruptedAtIndex: i,
          error: `Tampered hash at index ${i}: stored ${entry.entryHash}, computed ${expectedEntryHash}`,
        };
      }
    }

    return { valid: true };
  }
}
