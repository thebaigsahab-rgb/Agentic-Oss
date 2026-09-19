/**
 * Multi-Anchor Drift Detection & Grounding Protocol
 *
 * Implements weighted scoring across ARIA, DOM, and Visual Anchors.
 * Strictly enforces anti-guessing halting when confidence falls below 0.82
 * or when competing elements exhibit ambiguous score deltas (Δ < 0.10).
 */

import { computeVisualSimilarity } from "./perceptual-hash";
import type {
  ActionTargets,
  AnchorWeights,
  TargetGroundingCandidate,
  ElementMatchScore,
  DriftEvaluationResult,
} from "./types";

export const DEFAULT_ANCHOR_WEIGHTS: AnchorWeights = {
  wAria: 0.40,
  wDom: 0.35,
  wVisual: 0.25,
};

export const DEFAULT_DRIFT_THRESHOLD = 0.82;
export const MIN_AMBIGUITY_DELTA = 0.10;

export class UiDriftError extends Error {
  public readonly code = "UI_DRIFT_DETECTED";
  public readonly evaluation: DriftEvaluationResult;

  constructor(message: string, evaluation: DriftEvaluationResult) {
    super(`[UI_DRIFT_HALT] ${message}`);
    this.name = "UiDriftError";
    this.evaluation = evaluation;
  }
}

export class AmbiguousTargetError extends Error {
  public readonly code = "AMBIGUOUS_TARGET_DETECTED";
  public readonly evaluation: DriftEvaluationResult;

  constructor(message: string, evaluation: DriftEvaluationResult) {
    super(`[ANTI_GUESSING_HALT] ${message}`);
    this.name = "AmbiguousTargetError";
    this.evaluation = evaluation;
  }
}

export class DriftDetector {
  private weights: AnchorWeights;
  private threshold: number;

  constructor(weights: AnchorWeights = DEFAULT_ANCHOR_WEIGHTS, threshold: number = DEFAULT_DRIFT_THRESHOLD) {
    // Ensure weights sum to 1.0
    const sum = weights.wAria + weights.wDom + weights.wVisual;
    this.weights = {
      wAria: weights.wAria / sum,
      wDom: weights.wDom / sum,
      wVisual: weights.wVisual / sum,
    };
    this.threshold = threshold;
  }

  /**
   * Evaluates target anchors against active page/screen candidates.
   * Returns a strict DriftEvaluationResult.
   */
  public evaluateTarget(
    target: ActionTargets,
    candidates: TargetGroundingCandidate[]
  ): DriftEvaluationResult {
    if (!candidates || candidates.length === 0) {
      return {
        matched: false,
        topScore: 0,
        competingScoreDelta: 0,
        ambiguous: false,
        driftDetected: true,
        details: "Zero candidate elements found on the active screen.",
        candidatesScored: [],
      };
    }

    const scored: ElementMatchScore[] = candidates.map((candidate) => {
      const ariaScore = this.computeAriaScore(target, candidate);
      const domScore = this.computeDomScore(target, candidate);
      const visualScore = computeVisualSimilarity(
        target.visualAnchor?.perceptualHash || "",
        candidate.perceptualHash || ""
      );

      const totalScore = Number(
        (
          this.weights.wAria * ariaScore +
          this.weights.wDom * domScore +
          this.weights.wVisual * visualScore
        ).toFixed(4)
      );

      return {
        candidate,
        totalScore,
        ariaScore,
        domScore,
        visualScore,
      };
    });

    // Sort descending by score
    scored.sort((a, b) => b.totalScore - a.totalScore);

    const best = scored[0];
    const secondBest = scored[1];
    const topScore = best.totalScore;
    const delta = secondBest ? Number((best.totalScore - secondBest.totalScore).toFixed(4)) : 1.0;

    // 1. Threshold Invariant Check
    if (topScore < this.threshold) {
      return {
        matched: false,
        bestCandidate: best.candidate,
        topScore,
        competingScoreDelta: delta,
        ambiguous: false,
        driftDetected: true,
        details: `Top element match score (${topScore}) is below safety threshold (${this.threshold}).`,
        candidatesScored: scored,
      };
    }

    // 2. Anti-Guessing Ambiguity Check
    // If second candidate is also viable (> 0.60) and delta is less than 0.10, reject
    if (secondBest && secondBest.totalScore >= 0.60 && delta < MIN_AMBIGUITY_DELTA) {
      return {
        matched: false,
        bestCandidate: best.candidate,
        topScore,
        competingScoreDelta: delta,
        ambiguous: true,
        driftDetected: true,
        details: `Multiple elements share ambiguous match confidence (Top: ${topScore}, Second: ${secondBest.totalScore}, Δ: ${delta} < ${MIN_AMBIGUITY_DELTA}).`,
        candidatesScored: scored,
      };
    }

    return {
      matched: true,
      bestCandidate: best.candidate,
      topScore,
      competingScoreDelta: delta,
      ambiguous: false,
      driftDetected: false,
      details: `Target grounded deterministically with score ${topScore}.`,
      candidatesScored: scored,
    };
  }

  /**
   * Resolves target element or throws a strict Fail-Safe Halt Error.
   * INVARIANT: NEVER GUESSES.
   */
  public resolveOrHalt(
    target: ActionTargets,
    candidates: TargetGroundingCandidate[],
    stepId: string
  ): TargetGroundingCandidate {
    const evalResult = this.evaluateTarget(target, candidates);

    if (evalResult.ambiguous) {
      throw new AmbiguousTargetError(
        `Step [${stepId}]: Ambiguous element targets detected. Halting immediately without guessing.`,
        evalResult
      );
    }

    if (!evalResult.matched || evalResult.driftDetected) {
      throw new UiDriftError(
        `Step [${stepId}]: UI drift detected (${evalResult.details}). Halting immediately without guessing.`,
        evalResult
      );
    }

    return evalResult.bestCandidate!;
  }

  // --------------------------------------------------------------------------
  // Internal Scoring Models
  // --------------------------------------------------------------------------

  private computeAriaScore(target: ActionTargets, candidate: TargetGroundingCandidate): number {
    if (!target.ariaSelector && !target.textFallback) {
      return 1.0; // Neutral full weight when ARIA anchor is not specified for this target
    }

    let score = 0;
    if (target.ariaSelector) {
      // Check role/name match in selector string
      if (candidate.ariaRole && target.ariaSelector.includes(`role="${candidate.ariaRole}"`)) {
        score += 0.5;
      }
      if (candidate.ariaName && target.ariaSelector.toLowerCase().includes(candidate.ariaName.toLowerCase())) {
        score += 0.5;
      }
      if (score > 0) return score;
    }

    if (target.textFallback && candidate.ariaName) {
      if (candidate.ariaName.trim().toLowerCase() === target.textFallback.trim().toLowerCase()) {
        return 0.9;
      }
      if (candidate.ariaName.toLowerCase().includes(target.textFallback.toLowerCase())) {
        return 0.6;
      }
    }

    return 0.0;
  }

  private computeDomScore(target: ActionTargets, candidate: TargetGroundingCandidate): number {
    // Exact CSS selector match
    if (target.cssSelector && candidate.domSelector) {
      if (target.cssSelector === candidate.domSelector) return 1.0;
      // Partial class/tag match
      const targetTag = target.cssSelector.split(/[#.[\s]/)[0];
      const candTag = candidate.domSelector.split(/[#.[\s]/)[0];
      if (targetTag && candTag && targetTag === candTag) return 0.5;
    }

    // XPath match
    if (target.xpath && candidate.xpath && target.xpath === candidate.xpath) {
      return 0.9;
    }

    // Text fallback match
    if (target.textFallback && candidate.visibleText) {
      if (candidate.visibleText.trim().toLowerCase() === target.textFallback.trim().toLowerCase()) {
        return 0.7;
      }
      if (candidate.visibleText.toLowerCase().includes(target.textFallback.toLowerCase())) {
        return 0.4;
      }
    }

    return 0.0;
  }
}
