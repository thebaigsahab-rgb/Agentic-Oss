import type { BudgetEnvelope } from "../core/types";

export type ModelTier = "FAST_LITE" | "BALANCED" | "DEEP_REASONING";

export interface ModelRoutingDecision {
  allowed: boolean;
  tier: ModelTier;
  modelId: string;
  estimatedCostUsd: number;
  reason?: string;
}

export class BudgetExceededException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededException";
  }
}

/**
 * Model Router & Cost Ledger
 * Enforces strict financial limits (OWASP LLM10: Unbounded Consumption) and routes
 * queries across cost-tiered models according to task complexity.
 */
export class ModelRouter {
  public static readonly MODEL_COST_RATES: Record<ModelTier, { costPerCall: number; modelId: string }> = {
    FAST_LITE: { costPerCall: 0.0001, modelId: "gemini-2.5-flash-lite" },
    BALANCED: { costPerCall: 0.001, modelId: "gemini-2.5-flash" },
    DEEP_REASONING: { costPerCall: 0.01, modelId: "gemini-2.5-pro" },
  };

  /**
   * Evaluates task complexity and budget headroom to choose the appropriate model tier.
   */
  public routeCall(
    complexity: "low" | "medium" | "high",
    budget: BudgetEnvelope
  ): ModelRoutingDecision {
    let selectedTier: ModelTier = "BALANCED";

    if (complexity === "low") {
      selectedTier = "FAST_LITE";
    } else if (complexity === "high") {
      selectedTier = "DEEP_REASONING";
    }

    // Downgrade if nearing budget ceiling (>80% consumed)
    const costRatio = budget.current_cost_usd / (budget.max_cost_usd || 1.0);
    if (costRatio > 0.8 && selectedTier === "DEEP_REASONING") {
      selectedTier = "BALANCED";
    }
    if (costRatio > 0.95 && selectedTier === "BALANCED") {
      selectedTier = "FAST_LITE";
    }

    const { costPerCall, modelId } = ModelRouter.MODEL_COST_RATES[selectedTier];
    const projectedCost = budget.current_cost_usd + costPerCall;

    // Hard ceiling check
    if (projectedCost > budget.max_cost_usd) {
      return {
        allowed: false,
        tier: selectedTier,
        modelId,
        estimatedCostUsd: costPerCall,
        reason: `Financial budget ceiling reached. Limit: $${budget.max_cost_usd.toFixed(4)}, Current: $${budget.current_cost_usd.toFixed(4)}, Projected: $${projectedCost.toFixed(4)}.`,
      };
    }

    return {
      allowed: true,
      tier: selectedTier,
      modelId,
      estimatedCostUsd: costPerCall,
    };
  }

  /**
   * Asserts budget availability or throws BudgetExceededException.
   */
  public assertBudget(costToAdd: number, budget: BudgetEnvelope): void {
    const projected = budget.current_cost_usd + costToAdd;
    if (projected > budget.max_cost_usd) {
      throw new BudgetExceededException(
        `Financial budget exceeded. Limit: $${budget.max_cost_usd.toFixed(4)}, Projected: $${projected.toFixed(4)}.`
      );
    }
  }
}
