/**
 * Immutable Versioned Skill Registry
 *
 * Implements content-addressed storage, Semantic Versioning enforcement
 * (MAJOR.MINOR.PATCH), test fixture bundling, and tombstone revocation semantics.
 */

import { createHash } from "node:crypto";
import { AuditLogger } from "./audit";
import type {
  CompiledSkill,
  SkillStatus,
  SkillTestFixture,
} from "./types";

export class SkillRevokedError extends Error {
  public readonly code = "SKILL_REVOKED";
  constructor(skillId: string) {
    super(`Skill [${skillId}] has been TOMBSTONED and cannot be instantiated.`);
    this.name = "SkillRevokedError";
  }
}

export class SkillRegistry {
  private skills: Map<string, CompiledSkill> = new Map(); // key: skillId@version
  private skillLatestVersion: Map<string, string> = new Map(); // key: skillId -> latest version
  private auditLogger: AuditLogger;

  constructor(auditLogger: AuditLogger) {
    this.auditLogger = auditLogger;
  }

  /**
   * Registers a verified CompiledSkill into the immutable registry.
   * Enforces semantic version progression if an earlier version exists.
   */
  public registerSkill(skill: CompiledSkill, actor: string = "operator"): void {
    if (!skill.verification || !skill.verification.hmacSignature) {
      throw new Error(`Cannot register skill [${skill.skillId}]: Missing cryptographic verification signature.`);
    }

    const key = `${skill.skillId}@${skill.version}`;
    if (this.skills.has(key)) {
      throw new Error(`Skill version conflict: [${key}] is immutable and already registered.`);
    }

    const currentLatest = this.skillLatestVersion.get(skill.skillId);
    if (currentLatest) {
      const existing = this.skills.get(`${skill.skillId}@${currentLatest}`)!;
      this.validateSemVerProgression(existing, skill);
    }

    this.skills.set(key, { ...skill });
    this.skillLatestVersion.set(skill.skillId, skill.version);

    this.auditLogger.append({
      eventType: "SKILL_VERIFIED",
      actor,
      skillId: skill.skillId,
      payload: {
        version: skill.version,
        contentHash: skill.contentHash,
        verifiedBy: skill.verification.verifiedBy,
      },
    });
  }

  /**
   * Retrieves a skill by ID and optional version string.
   * INVARIANT: Throws SkillRevokedError if the skill is TOMBSTONED.
   */
  public getSkill(skillId: string, version?: string): CompiledSkill {
    const targetVersion = version || this.skillLatestVersion.get(skillId);
    if (!targetVersion) {
      throw new Error(`Skill [${skillId}] not found in registry.`);
    }

    const key = `${skillId}@${targetVersion}`;
    const skill = this.skills.get(key);
    if (!skill) {
      throw new Error(`Skill [${key}] not found in registry.`);
    }

    if (skill.status === "TOMBSTONED") {
      throw new SkillRevokedError(skillId);
    }

    return { ...skill };
  }

  /**
   * Revokes a skill across all registered versions, marking them as TOMBSTONED.
   */
  public revokeSkill(skillId: string, actor: string = "operator", reason: string = "Operator revocation"): void {
    let found = false;
    for (const [key, skill] of this.skills.entries()) {
      if (skill.skillId === skillId) {
        skill.status = "TOMBSTONED";
        found = true;
      }
    }

    if (!found) {
      throw new Error(`Cannot revoke skill [${skillId}]: Does not exist in registry.`);
    }

    this.auditLogger.append({
      eventType: "SKILL_REVOKED",
      actor,
      skillId,
      payload: { reason },
    });
  }

  /**
   * Lists all active (non-tombstoned) skills in the registry.
   */
  public listActiveSkills(): CompiledSkill[] {
    const results: CompiledSkill[] = [];
    for (const [skillId, latestVer] of this.skillLatestVersion.entries()) {
      const skill = this.skills.get(`${skillId}@${latestVer}`);
      if (skill && skill.status === "ACTIVE") {
        results.push({ ...skill });
      }
    }
    return results;
  }

  /**
   * Enforces strict Semantic Versioning rules (MAJOR.MINOR.PATCH):
   * - MAJOR: Changes to inputs (parameters added/removed/type changed), preconditions, or approval requirements.
   * - MINOR: Addition of fallback selectors or optional parameters.
   * - PATCH: Timeout adjustments or metadata updates.
   */
  public validateSemVerProgression(existing: CompiledSkill, updated: CompiledSkill): void {
    const [eMajor, eMinor, ePatch] = existing.version.split(".").map(Number);
    const [uMajor, uMinor, uPatch] = updated.version.split(".").map(Number);

    const requiresMajor = this.checkRequiresMajorBump(existing, updated);
    const requiresMinor = this.checkRequiresMinorBump(existing, updated);

    if (requiresMajor) {
      if (uMajor <= eMajor) {
        throw new Error(
          `SemVer violation: Changes in parameters, preconditions, or approvals require a MAJOR version bump (existing: ${existing.version}, attempted: ${updated.version}).`
        );
      }
      return;
    }

    if (requiresMinor) {
      if (uMajor === eMajor && uMinor <= eMinor) {
        throw new Error(
          `SemVer violation: Adding fallback selectors or optional parameters requires at least a MINOR version bump (existing: ${existing.version}, attempted: ${updated.version}).`
        );
      }
      return;
    }

    // Otherwise PATCH bump is acceptable
    if (uMajor === eMajor && uMinor === eMinor && uPatch <= ePatch) {
      throw new Error(
        `SemVer violation: Incremental update requires a PATCH bump (existing: ${existing.version}, attempted: ${updated.version}).`
      );
    }
  }

  private checkRequiresMajorBump(oldSkill: CompiledSkill, newSkill: CompiledSkill): boolean {
    // 1. Parameter required list or types changed
    const oldParams = oldSkill.parameters.properties;
    const newParams = newSkill.parameters.properties;

    for (const key of Object.keys(oldParams)) {
      if (!newParams[key]) return true; // Parameter removed
      if (oldParams[key].type !== newParams[key].type) return true; // Type changed
      if (oldParams[key].required !== newParams[key].required) return true; // Required flag changed
    }
    for (const key of Object.keys(newParams)) {
      if (!oldParams[key] && newParams[key].required) return true; // New REQUIRED parameter added
    }

    // 2. Preconditions or Approval Gates changed
    if (oldSkill.ast.length !== newSkill.ast.length) return true;
    for (let i = 0; i < oldSkill.ast.length; i++) {
      const oldNode = oldSkill.ast[i];
      const newNode = newSkill.ast[i];
      if (oldNode.governance.requiresExplicitApproval !== newNode.governance.requiresExplicitApproval) return true;
      if (oldNode.guards.preconditions.length !== newNode.guards.preconditions.length) return true;
    }

    return false;
  }

  private checkRequiresMinorBump(oldSkill: CompiledSkill, newSkill: CompiledSkill): boolean {
    // 1. New optional parameter added
    const oldKeys = Object.keys(oldSkill.parameters.properties);
    const newKeys = Object.keys(newSkill.parameters.properties);
    if (newKeys.length > oldKeys.length) return true;

    // 2. Fallback selectors added
    for (let i = 0; i < oldSkill.ast.length; i++) {
      const oldNode = oldSkill.ast[i];
      const newNode = newSkill.ast[i];
      if (!oldNode.targets.textFallback && newNode.targets.textFallback) return true;
      if (!oldNode.targets.xpath && newNode.targets.xpath) return true;
    }

    return false;
  }
}
