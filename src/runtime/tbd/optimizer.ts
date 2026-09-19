/**
 * Proposal-Only Self-Improvement Engine
 *
 * Collects execution telemetry, identifies degraded selectors or timeouts,
 * and synthesizes reviewable patch proposals (staged PRs).
 *
 * STRICT INVARIANT: Autonomous runtime self-modification is hard-blocked.
 * Direct attempts to mutate registered skills without human review signatures
 * emit a security alert and throw SecurityViolationError.
 */

import { randomUUID } from "node:crypto";
import { AuditLogger } from "./audit";
import type {
  CompiledSkill,
  ActionNode,
  ProposedSkillPatch,
} from "./types";

export class SecurityViolationError extends Error {
  public readonly code = "SECURITY_VIOLATION_AUTONOMOUS_MUTATION_BLOCKED";
  constructor(message: string) {
    super(`[CRITICAL_SECURITY_ALERT] ${message}`);
    this.name = "SecurityViolationError";
  }
}

export interface TelemetryTrace {
  skillId: string;
  stepId: string;
  selectorScore: number;
  durationMs: number;
  timedOut: boolean;
  failed: boolean;
  alternativeCandidateSelector?: string;
}

export class SkillOptimizer {
  private auditLogger: AuditLogger;
  private telemetryTraces: TelemetryTrace[] = [];
  private stagedProposals: Map<string, ProposedSkillPatch> = new Map();

  constructor(auditLogger: AuditLogger) {
    this.auditLogger = auditLogger;
  }

  /**
   * Logs telemetry data from execution runs for analysis.
   */
  public recordTelemetry(trace: TelemetryTrace): void {
    this.telemetryTraces.push({ ...trace });
  }

  /**
   * Analyzes telemetry traces to synthesize a non-binding, unmerged ProposedSkillPatch.
   */
  public synthesizeProposal(skill: CompiledSkill, stepId: string): ProposedSkillPatch | null {
    const traces = this.telemetryTraces.filter((t) => t.skillId === skill.skillId && t.stepId === stepId);
    if (traces.length === 0) return null;

    const failureCount = traces.filter((t) => t.failed || t.timedOut).length;
    const degradedScores = traces.map((t) => t.selectorScore).filter((s) => s < 0.88);
    const avgLatencyMs = Math.round(traces.reduce((acc, t) => acc + t.durationMs, 0) / traces.length);

    // If step consistently suffers from selector degradation or timeout, propose improvement
    if (degradedScores.length >= 1 || failureCount >= 1) {
      const targetNode = skill.ast.find((n) => n.stepId === stepId);
      if (!targetNode) return null;

      const altSelectorTrace = traces.find((t) => t.alternativeCandidateSelector);
      const proposedPatch: Partial<ActionNode> = {};

      if (altSelectorTrace?.alternativeCandidateSelector) {
        proposedPatch.targets = {
          ...targetNode.targets,
          cssSelector: altSelectorTrace.alternativeCandidateSelector,
        };
      }

      if (failureCount > 0) {
        proposedPatch.guards = {
          ...targetNode.guards,
          timeoutMs: Math.max(targetNode.guards.timeoutMs * 1.5, 12000),
        };
      }

      // Propose version bump (PATCH or MINOR)
      const [maj, min, pat] = skill.version.split(".").map(Number);
      const proposedVersion = proposedPatch.targets?.textFallback
        ? `${maj}.${min + 1}.0`
        : `${maj}.${min}.${pat + 1}`;

      const proposal: ProposedSkillPatch = {
        proposalId: `prop_${randomUUID().slice(0, 8)}`,
        skillId: skill.skillId,
        baseVersion: skill.version,
        proposedVersion,
        rationale: `Automated patch proposal: Observed ${failureCount} failures and ${degradedScores.length} degraded selector matches for step ${stepId}.`,
        targetStepId: stepId,
        proposedPatch,
        telemetryEvidence: {
          failureCount,
          degradedSelectorScores: degradedScores,
          avgLatencyMs,
        },
        isMerged: false,
        stagedAt: Date.now(),
      };

      this.stagedProposals.set(proposal.proposalId, proposal);

      this.auditLogger.append({
        eventType: "PATCH_PROPOSED",
        actor: "system:optimizer-proposer",
        skillId: skill.skillId,
        stepId,
        payload: { proposalId: proposal.proposalId, proposedVersion, rationale: proposal.rationale },
      });

      return proposal;
    }

    return null;
  }

  /**
   * Retrieves all staged, unmerged patch proposals for human review.
   */
  public listStagedProposals(): ProposedSkillPatch[] {
    return Array.from(this.stagedProposals.values());
  }

  /**
   * FORBIDDEN ACTION: Direct self-modification without human verification signature.
   * STRICT INVARIANT: Always throws SecurityViolationError and emits an audit alert.
   */
  public attemptAutonomousSkillMutation(skill: CompiledSkill, patch: Partial<ActionNode>): never {
    // Record critical security alert in tamper-evident audit log
    this.auditLogger.append({
      eventType: "UNAUTHORIZED_MODIFICATION_BLOCKED",
      actor: "system:autonomous-optimizer",
      skillId: skill.skillId,
      payload: {
        violation: "Autonomous self-modification attempted without human cryptographic signature.",
        attemptedPatch: patch,
      },
    });

    throw new SecurityViolationError(
      `Autonomous mutation of skill [${skill.skillId}] was rejected. Agent self-modification is strictly forbidden by OWASP LLM08 and TBD safety governance.`
    );
  }
}
