import "server-only";

import type {
  ModelCapabilityScore,
  ModelRole,
  ModelRouteDecision,
} from "./types";
import { readSettings } from "@/lib/server/settings";

/**
 * 8. Model Router & Compute Fabric
 * Selects the optimal model and execution tier for each cognitive role.
 */

export const MODEL_REGISTRY: ModelCapabilityScore[] = [
  // Local Fast Models (Ollama / LM Studio)
  {
    provider: "local",
    modelId: "llama3.2:3b",
    role: "executor",
    reasoningScore: 6,
    latencyMsEstimated: 250,
    costPer1kTokens: 0,
    contextWindow: 128000,
    isLocal: true,
    supportsVision: false,
    supportsToolCalling: true,
  },
  {
    provider: "local",
    modelId: "qwen2.5-coder:7b",
    role: "coding",
    reasoningScore: 7,
    latencyMsEstimated: 450,
    costPer1kTokens: 0,
    contextWindow: 32000,
    isLocal: true,
    supportsVision: false,
    supportsToolCalling: true,
  },
  // Cloud Frontier Models
  {
    provider: "gemini",
    modelId: "gemini-2.5-flash",
    role: "executor",
    reasoningScore: 8,
    latencyMsEstimated: 400,
    costPer1kTokens: 0.0001,
    contextWindow: 1000000,
    isLocal: false,
    supportsVision: true,
    supportsToolCalling: true,
  },
  {
    provider: "gemini",
    modelId: "gemini-2.5-pro",
    role: "planner",
    reasoningScore: 10,
    latencyMsEstimated: 1200,
    costPer1kTokens: 0.00125,
    contextWindow: 2000000,
    isLocal: false,
    supportsVision: true,
    supportsToolCalling: true,
  },
  {
    provider: "anthropic",
    modelId: "claude-3-7-sonnet-latest",
    role: "planner",
    reasoningScore: 10,
    latencyMsEstimated: 1100,
    costPer1kTokens: 0.003,
    contextWindow: 200000,
    isLocal: false,
    supportsVision: true,
    supportsToolCalling: true,
  },
  {
    provider: "openai",
    modelId: "gpt-4o-mini",
    role: "verifier",
    reasoningScore: 8,
    latencyMsEstimated: 500,
    costPer1kTokens: 0.00015,
    contextWindow: 128000,
    isLocal: false,
    supportsVision: true,
    supportsToolCalling: true,
  },
];

import { isLocalAiProvider } from "@/lib/ai-providers";

export async function routeModelForRole(
  role: ModelRole,
  options: {
    requiresVision?: boolean;
    requiresCloud?: boolean;
    maxLatencyMs?: number;
    maxCostUsd?: number;
    preferredProvider?: string;
  } = {},
): Promise<ModelRouteDecision> {
  const settings = await readSettings().catch(() => null);
  const configuredProvider = options.preferredProvider || settings?.ai?.provider || "gemini";
  const hasLocal = isLocalAiProvider(configuredProvider as any) || Boolean(settings?.ai?.localBaseUrls?.ollama || settings?.ai?.localBaseUrls?.lmstudio);

  // 1. Local-first escalation check
  if (!options.requiresCloud && hasLocal) {
    const localMatch = MODEL_REGISTRY.find(
      (m) => m.isLocal && m.role === role && (!options.requiresVision || m.supportsVision),
    );
    if (localMatch) {
      return {
        selectedProvider: "local",
        selectedModel: localMatch.modelId,
        role,
        routeReason: `Local-first policy selected ${localMatch.modelId} with 0 cost and zero cloud egress.`,
        escalationLevel: "local_fast",
        estimatedCostUsd: 0,
      };
    }
  }

  // 2. Cloud Model Selection based on Role
  if (role === "planner" || role === "research_reasoning") {
    const model = configuredProvider === "anthropic" ? "claude-3-7-sonnet-latest" : "gemini-2.5-pro";
    return {
      selectedProvider: configuredProvider,
      selectedModel: model,
      role,
      routeReason: `Deep reasoning required for ${role}; selected frontier model ${model}.`,
      escalationLevel: "cloud_frontier",
      estimatedCostUsd: 0.002,
    };
  }

  if (role === "vision_ui") {
    return {
      selectedProvider: configuredProvider === "anthropic" ? "anthropic" : "gemini",
      selectedModel: configuredProvider === "anthropic" ? "claude-3-5-sonnet-20241022" : "gemini-2.5-flash",
      role,
      routeReason: "Multimodal visual grounding required; selected high-speed vision model.",
      escalationLevel: "cloud_frontier",
      estimatedCostUsd: 0.0005,
    };
  }

  // Default fast executor / verifier
  const fallbackModel = configuredProvider === "anthropic" ? "claude-3-5-haiku-20241022" : "gemini-2.5-flash";
  return {
    selectedProvider: configuredProvider,
    selectedModel: fallbackModel,
    role,
    routeReason: `Fast execution with high reliability; routed to ${fallbackModel}.`,
    escalationLevel: "cloud_frontier",
    estimatedCostUsd: 0.0002,
  };
}

/**
 * 8.3 Compute Scheduler
 * Checks if workstation resources are sufficient or if expensive tasks should throttle.
 */
export function checkComputeThrottling(
  cpuPercent: number,
  memoryUsedMb: number,
  batteryCharging = true,
): { shouldThrottle: boolean; reason?: string } {
  if (cpuPercent > 85) {
    return { shouldThrottle: true, reason: `Workstation CPU is high (${cpuPercent}%). Throttling background agents.` };
  }
  if (!batteryCharging && cpuPercent > 50) {
    return { shouldThrottle: true, reason: "On battery power. Throttling expensive background compute." };
  }
  return { shouldThrottle: false };
}
