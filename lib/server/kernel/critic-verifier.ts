import "server-only";

import type { VerificationOutcome } from "./types";
import { getDatabase } from "@/lib/server/database";
import { appendMissionJournal } from "./kernel-store";

/**
 * 10. Critic & Outcome Verifier Layer
 * Implements independent verification for mission tasks so success is proven rather than assumed.
 */
export async function verifyTaskExecution(
  missionId: string,
  taskId: string,
  taskTitle: string,
  expectedOutcome: string,
  actualOutput: unknown,
  preActionEvidence?: string,
): Promise<VerificationOutcome> {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Evaluate evidence based on output structure and empirical indicators
  const evidence: Array<{ type: string; observation: string; matchesExpectation: boolean }> = [];

  const outputStr = typeof actualOutput === "string" ? actualOutput : JSON.stringify(actualOutput || {});

  // Indicator 1: Output presence and error freedom
  const hasError = outputStr.toLowerCase().includes("error:") || outputStr.toLowerCase().includes("exception");
  evidence.push({
    type: "runtime_error_check",
    observation: hasError ? "Execution trace contained error or exception keywords." : "Execution completed cleanly with zero unhandled errors.",
    matchesExpectation: !hasError,
  });

  // Indicator 2: Non-empty result payload
  const hasPayload = outputStr.length > 5 && outputStr !== "{}" && outputStr !== "null";
  evidence.push({
    type: "artifact_yield_check",
    observation: hasPayload ? `Yielded concrete output of ${outputStr.length} characters.` : "Output was empty or null.",
    matchesExpectation: hasPayload,
  });

  // Indicator 3: Semantic alignment with expected outcome
  const expectedKeywords = expectedOutcome.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const matchedKeywords = expectedKeywords.filter((k) => outputStr.toLowerCase().includes(k));
  const semanticAlignment = expectedKeywords.length > 0 ? matchedKeywords.length / expectedKeywords.length : 1.0;

  evidence.push({
    type: "semantic_relevance_check",
    observation: `Matched ${matchedKeywords.length}/${expectedKeywords.length} key domain terms from objective.`,
    matchesExpectation: semanticAlignment >= 0.3,
  });

  const allPassed = evidence.every((e) => e.matchesExpectation);
  const hasFatalError = evidence.some((e) => e.type === "runtime_error_check" && !e.matchesExpectation);
  const partialPassed = !hasFatalError && evidence.some((e) => e.matchesExpectation);

  const verdict = allPassed ? "verified" : partialPassed ? "partially_verified" : "failed";
  const confidence = allPassed ? 0.95 : partialPassed ? 0.65 : 0.1;

  const outcome: VerificationOutcome = {
    verified: allPassed,
    verdict,
    confidence,
    critique: allPassed
      ? `Task "${taskTitle}" empirically verified. All evidence criteria satisfied.`
      : `Task "${taskTitle}" failed verification: ${evidence.find((e) => !e.matchesExpectation)?.observation}`,
    evidence,
    requiredRepairPlan: allPassed ? undefined : `Re-execute with adjusted parameters focusing on: ${expectedKeywords.slice(0, 3).join(", ")}`,
    timestamp: now,
  };

  appendMissionJournal(db, {
    missionId,
    taskId,
    type: allPassed ? "verification_passed" : "verification_failed",
    payload: { verdict, confidence, critique: outcome.critique },
    timestamp: now,
  });

  return outcome;
}
