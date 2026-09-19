import "server-only";

import { getDatabase } from "@/lib/server/database";
import type { MemoryItem, MemoryLayer } from "./types";
import { saveMemoryItem, searchKnowledgeMemory } from "./kernel-store";

/**
 * 13. Knowledge OS — 4 Memory Layers
 * Manages Episodic, Semantic, Procedural, and Preference memory with hybrid retrieval.
 */

import type { DatabaseSync } from "node:sqlite";

export function rememberFact(
  title: string,
  content: string,
  tags: string[] = [],
  layer: MemoryLayer = "semantic",
  importance = 0.7,
  sourceMissionId?: string,
  database?: DatabaseSync,
): MemoryItem {
  const db = database || getDatabase();
  return saveMemoryItem(db, {
    layer,
    title,
    content,
    tags,
    importance,
    confidence: 1.0,
    sourceMissionId,
  });
}

export function rememberPreference(
  preferenceKey: string,
  preferenceValue: string,
  category = "workflow",
  database?: DatabaseSync,
): MemoryItem {
  return rememberFact(
    `User Preference: ${preferenceKey}`,
    preferenceValue,
    ["preference", category, preferenceKey],
    "preference",
    0.9,
    undefined,
    database,
  );
}

export function rememberProcedure(
  procedureName: string,
  stepsDescription: string,
  domain = "automation",
  database?: DatabaseSync,
): MemoryItem {
  return rememberFact(
    `Procedure: ${procedureName}`,
    stepsDescription,
    ["procedural", domain, procedureName],
    "procedural",
    0.8,
    undefined,
    database,
  );
}

export function recallMemories(
  query: string,
  options: {
    layer?: MemoryLayer;
    limit?: number;
    minConfidence?: number;
    database?: DatabaseSync;
  } = {},
): MemoryItem[] {
  const db = options.database || getDatabase();
  const memories = searchKnowledgeMemory(db, query, options.layer, options.limit || 10);
  if (options.minConfidence !== undefined) {
    return memories.filter((m) => m.confidence >= (options.minConfidence || 0));
  }
  return memories;
}

/**
 * Consolidates related episodic experiences into semantic rules.
 */
export function consolidateEpisodicMemories(database?: DatabaseSync): { consolidatedCount: number } {
  const db = database || getDatabase();
  const episodic = searchKnowledgeMemory(db, "", "episodic", 50);

  // Group by mission or recurring task patterns
  const patterns = new Map<string, number>();
  for (const item of episodic) {
    for (const tag of item.tags) {
      patterns.set(tag, (patterns.get(tag) || 0) + 1);
    }
  }

  let consolidatedCount = 0;
  for (const [tag, count] of patterns.entries()) {
    if (count >= 3 && tag !== "task" && tag !== "mission") {
      rememberFact(
        `Learned Pattern: High activity in ${tag}`,
        `Observed ${count} autonomous tasks executing under topic '${tag}'. Automated monitoring recommended.`,
        ["consolidated", tag],
        "semantic",
        0.75,
      );
      consolidatedCount += 1;
    }
  }

  return { consolidatedCount };
}
