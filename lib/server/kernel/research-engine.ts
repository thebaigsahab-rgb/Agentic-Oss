import "server-only";

import { randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/server/database";
import type { EvidenceClaim } from "./types";
import { emitKernelEvent } from "./kernel-store";

import type { DatabaseSync } from "node:sqlite";

/**
 * 15. Autonomous Research Engine & Evidence Graph
 */
export function recordEvidenceClaim(
  researchId: string,
  claim: string,
  sourceUrl: string,
  sourceTitle: string,
  excerpt: string,
  confidenceScore = 0.9,
  database?: DatabaseSync,
): EvidenceClaim {
  const db = database || getDatabase();
  const id = `clm_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date().toISOString();

  // Check for potential contradictions with existing claims on this research topic
  const existingClaims = listEvidenceClaims(researchId, db);
  const contradictedBy: string[] = [];

  const lowerClaim = claim.toLowerCase();
  for (const existing of existingClaims) {
    const lowerExisting = existing.claim.toLowerCase();
    if (
      (lowerClaim.includes("not") && !lowerExisting.includes("not")) ||
      (lowerExisting.includes("not") && !lowerClaim.includes("not"))
    ) {
      // Basic heuristic contradiction flag
      const overlapWords = lowerClaim.split(" ").filter((w) => w.length > 4 && lowerExisting.includes(w));
      if (overlapWords.length >= 2) {
        contradictedBy.push(existing.id);
      }
    }
  }

  db.prepare(`
    INSERT INTO kernel_evidence_graph (
      id, research_id, claim, source_url, source_title, excerpt, confidence_score, contradicted_by, verified, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id,
    researchId,
    claim,
    sourceUrl,
    sourceTitle,
    excerpt,
    confidenceScore,
    contradictedBy.length > 0 ? JSON.stringify(contradictedBy) : null,
    now,
  );

  emitKernelEvent(db, "research.evidence_added", "research_engine", { researchId, claimId: id });

  return {
    id,
    researchId,
    claim,
    sourceUrl,
    sourceTitle,
    excerpt,
    confidenceScore,
    contradictedBy: contradictedBy.length > 0 ? contradictedBy : undefined,
    verified: true,
    createdAt: now,
  };
}

export function listEvidenceClaims(researchId: string, database?: DatabaseSync): EvidenceClaim[] {
  const db = database || getDatabase();
  const rows = db.prepare(
    "SELECT * FROM kernel_evidence_graph WHERE research_id = ? ORDER BY created_at ASC",
  ).all(researchId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    researchId: String(r.research_id),
    claim: String(r.claim),
    sourceUrl: String(r.source_url),
    sourceTitle: String(r.source_title),
    excerpt: String(r.excerpt),
    confidenceScore: Number(r.confidence_score),
    contradictedBy: r.contradicted_by ? JSON.parse(String(r.contradicted_by)) : undefined,
    verified: Boolean(r.verified),
    createdAt: String(r.created_at),
  }));
}
