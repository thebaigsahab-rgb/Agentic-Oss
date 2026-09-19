import { normalize, resolve, isAbsolute } from "node:path";
import type { CapabilityScope, ActionStep } from "../core/types";

export interface BrokerValidationResult {
  permitted: boolean;
  reason?: string;
}

/**
 * Capability Broker
 * Enforces least-privilege capability bounds and sandboxed path boundaries before actuation.
 */
export class CapabilityBroker {
  private readonly sandboxRoot: string;

  constructor(sandboxRoot = process.cwd()) {
    this.sandboxRoot = normalize(resolve(sandboxRoot));
  }

  /**
   * Evaluates whether the proposed action step is authorized under the job's capability grants.
   */
  public evaluateStep(
    step: ActionStep,
    grants: CapabilityScope[]
  ): BrokerValidationResult {
    const requiredScope = this.getRequiredScope(step.tool);

    if (requiredScope && !grants.includes(requiredScope)) {
      return {
        permitted: false,
        reason: `Missing required capability scope '${requiredScope}' for tool '${step.tool}'. Granted scopes: [${grants.join(", ")}]`,
      };
    }

    // Inspect file path arguments for sandbox traversal
    const pathViolation = this.validatePathSafety(step.input_params);
    if (pathViolation) {
      return {
        permitted: false,
        reason: `Sandbox violation: ${pathViolation}`,
      };
    }

    return { permitted: true };
  }

  /**
   * Maps tool names to required capability scopes.
   */
  private getRequiredScope(toolName: string): CapabilityScope | null {
    const tool = toolName.toLowerCase();

    if (tool.includes("write") || tool.includes("create_file") || tool.includes("delete")) {
      return "fs:write";
    }
    if (tool.includes("read") || tool.includes("view_file") || tool.includes("list_dir")) {
      return "fs:read";
    }
    if (tool.includes("shell") || tool.includes("exec") || tool.includes("command") || tool.includes("cmd")) {
      return "shell:execute";
    }
    if (tool.includes("fetch") || tool.includes("http") || tool.includes("web") || tool.includes("curl") || tool.includes("network")) {
      return "net:fetch";
    }
    if (tool.includes("llm") || tool.includes("subagent") || tool.includes("prompt")) {
      return "llm:call";
    }

    return null;
  }

  /**
   * Verifies that any file or directory path in parameters stays within the sandbox root.
   */
  private validatePathSafety(params: Record<string, unknown>): string | null {
    const pathKeys = ["path", "filePath", "targetFile", "destination", "directory", "dir"];

    for (const key of pathKeys) {
      const val = params[key];
      if (typeof val === "string" && val.trim().length > 0) {
        const rawPath = val.trim();

        // Detect directory traversal tokens
        if (rawPath.includes("../") || rawPath.includes("..\\")) {
          return `Path traversal token '..' detected in parameter '${key}': '${rawPath}'`;
        }

        const absolutePath = isAbsolute(rawPath)
          ? normalize(rawPath)
          : normalize(resolve(this.sandboxRoot, rawPath));

        // Ensure path remains inside sandbox
        if (!absolutePath.toLowerCase().startsWith(this.sandboxRoot.toLowerCase())) {
          return `Path '${absolutePath}' escapes sandbox root '${this.sandboxRoot}'`;
        }
      }
    }

    return null;
  }
}
