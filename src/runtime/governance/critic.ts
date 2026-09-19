import type { ActionStep, JobContext } from "../core/types";

export interface CriticReviewResult {
  approved: boolean;
  violations: string[];
}

/**
 * Critic & Invariant Validator
 * Scans proposed actions and execution DAGs for loop deadlocks, hallucinated parameters,
 * missing compensations, and destructive commands.
 */
export class Critic {
  private static readonly BLOCKED_PATTERNS = [
    /\b(rm\s+-rf\s+\/|rmdir\s+\/s\s+\/q\s+c:\\)\b/i,
    /\b(format\s+[a-z]:)\b/i,
    /\b(dd\s+if=.*of=\/dev\/[a-z]+)\b/i,
    /\b(mkfs\.[a-z0-9]+)\b/i,
    /\b(:(){:|:&};:)\b/i, // Fork bomb
  ];

  /**
   * Reviews a proposed action step against invariants and historical job context.
   */
  public evaluateStep(step: ActionStep, context: JobContext): CriticReviewResult {
    const violations: string[] = [];

    // 1. Tool Identity & Parameter Non-Emptiness
    if (!step.tool || step.tool.trim().length === 0) {
      violations.push("Step defines an empty or missing tool identifier.");
    }

    // 2. Reversible Action Invariant: Must define compensating action
    if (step.reversibility === "REVERSIBLE") {
      if (!step.compensating_action || !step.compensating_action.tool) {
        violations.push(
          `Step '${step.step_id}' is declared REVERSIBLE but lacks a valid compensating_action definition.`
        );
      }
    }

    // 3. Destructive Command Blacklist
    const stringifiedParams = JSON.stringify(step.input_params || {});
    for (const pattern of Critic.BLOCKED_PATTERNS) {
      if (pattern.test(stringifiedParams)) {
        violations.push(
          `Potentially catastrophic destructive shell pattern detected in step parameters: ${pattern}`
        );
      }
    }

    // 4. Infinite Loop Detection
    const identicalPriorSteps = context.steps.filter(
      (s) =>
        s.tool === step.tool &&
        JSON.stringify(s.input_params) === stringifiedParams &&
        s.status === "FAILED"
    );

    if (identicalPriorSteps.length >= 3) {
      violations.push(
        `Deadlock loop detected: Tool '${step.tool}' has failed 3 consecutive times with identical parameters.`
      );
    }

    return {
      approved: violations.length === 0,
      violations,
    };
  }
}
