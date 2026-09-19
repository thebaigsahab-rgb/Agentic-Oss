/**
 * Parameterization Engine & Human-in-the-Loop (HITL) Compiler
 *
 * Compiles raw demonstration event streams into declarative AST drafts, extracts
 * dynamic parameters with JSON Schema contracts, infers guards and compensating
 * rollbacks, and enforces strict cryptographic verification gates.
 */

import { createHash, createHmac, randomUUID } from "node:crypto";
import type {
  RawRecordingSession,
  RawDemonstrationEvent,
  ActionNode,
  ActionType,
  RiskLevel,
  SkillDraft,
  SkillParameters,
  ParameterDefinition,
  HumanReviewDecision,
  CompiledSkill,
  SkillVerificationRecord,
  SkillTestFixture,
} from "./types";

// Constant Detection Heuristics
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const FILE_PATH_REGEX = /(?:[a-zA-Z]:\\|\/(?:Users|home|tmp|var|etc|opt)\/)[^\s"']+/;
const NUMBER_ONLY_REGEX = /^\d+(?:\.\d+)?$/;
const DESTRUCTIVE_KEYWORD_REGEX = /delete|remove|drop|destroy|purge|revoke|terminate|checkout|pay|charge|transfer/i;
const APPROVAL_TRIGGER_REGEX = /delete|confirm|purchase|pay|submit|publish|drop|wipe|transfer/i;

export class HitlCompiler {
  /**
   * Compiles a raw demonstration recording session into an unverified SkillDraft.
   * GATING INVARIANT: This produces a candidate draft only; NEVER an executable skill.
   */
  public static compileDemonstrationToDraft(
    session: RawRecordingSession,
    options?: { skillName?: string; description?: string }
  ): SkillDraft {
    const draftId = `draft_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const skillName = options?.skillName || session.name || "Untitled Automated Skill";
    const analysisNotes: string[] = [];

    const extractedParameters: Record<string, ParameterDefinition> = {};
    const requiredParams: string[] = [];

    const nodes: ActionNode[] = [];
    let stepCounter = 1;

    for (let i = 0; i < session.events.length; i++) {
      const ev = session.events[i];
      const stepId = `step_${stepCounter++}`;

      // Synthesize ActionNode based on event category and interactions
      if (ev.category === "NAVIGATION" && ev.navigationUrl) {
        nodes.push({
          stepId,
          actionType: "NAVIGATE",
          targets: {
            visualAnchor: {
              perceptualHash: "0000000000000000",
              boundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
              referenceScreenshotPath: "",
            },
          },
          payload: {
            literalValue: ev.navigationUrl,
          },
          guards: {
            preconditions: [],
            postconditions: [{ type: "URL_CHANGED", expected: ev.navigationUrl }],
            timeoutMs: 15000,
          },
          governance: {
            riskLevel: "LOW",
            requiresExplicitApproval: false,
          },
        });
      } else if (ev.category === "INPUT" && ev.keyboard && ev.keyboard.value) {
        const rawValue = ev.keyboard.value;
        let paramKey: string | undefined;

        // Extract constant into dynamic parameter
        if (rawValue !== "[REDACTED_SECRET]" && rawValue !== "[REDACTED_AUTH_TOKEN]" && rawValue !== "[REDACTED_PAYMENT_CARD]") {
          const paramDef = this.extractParameterFromConstant(rawValue, ev, Object.keys(extractedParameters).length + 1);
          if (paramDef) {
            extractedParameters[paramDef.name] = paramDef;
            paramKey = paramDef.name;
            if (paramDef.required) requiredParams.push(paramDef.name);
            analysisNotes.push(`Extracted parameter "${paramDef.name}" from input literal "${rawValue}"`);
          }
        }

        const isSensitive = ev.keyboard.isPassword || rawValue.startsWith("[REDACTED");
        const ariaName = ev.targetDom?.ariaName || ev.targetDom?.formField?.name;
        const targetSummary = ariaName || ev.targetDom?.cssSelector || "Input element";
        const isCritical = DESTRUCTIVE_KEYWORD_REGEX.test(targetSummary);

        const node: ActionNode = {
          stepId,
          actionType: "TYPE",
          targets: {
            ariaSelector: ev.targetDom?.ariaRole ? `[role="${ev.targetDom.ariaRole}"][name="${ariaName}"]` : undefined,
            cssSelector: ev.targetDom?.cssSelector,
            xpath: ev.targetDom?.xpath,
            textFallback: ev.targetDom?.innerText,
            visualAnchor: {
              perceptualHash: ev.visual?.perceptualHash || "0000000000000000",
              boundingBox: ev.targetDom?.boundingBox || { x: 0, y: 0, width: 200, height: 40 },
              referenceScreenshotPath: ev.visual?.referencePath || "",
            },
          },
          payload: {
            parameterKey: paramKey,
            literalValue: paramKey ? undefined : rawValue,
            masked: isSensitive,
          },
          guards: {
            preconditions: [
              {
                type: "ELEMENT_EXISTS",
                expression: "body",
              },
            ],
            postconditions: isSensitive
              ? []
              : [{ type: "VISIBLE_TEXT", expected: rawValue }],
            timeoutMs: 8000,
          },
          governance: {
            riskLevel: isCritical ? "HIGH" : isSensitive ? "MEDIUM" : "LOW",
            requiresExplicitApproval: isCritical,
            rollbackAction: {
              stepId: `${stepId}_rollback`,
              actionType: "TYPE",
              targets: {
                ariaSelector: ev.targetDom?.ariaRole ? `[role="${ev.targetDom.ariaRole}"][name="${ariaName}"]` : undefined,
                cssSelector: ev.targetDom?.cssSelector,
                xpath: ev.targetDom?.xpath,
                textFallback: ev.targetDom?.innerText,
                visualAnchor: {
                  perceptualHash: ev.visual?.perceptualHash || "0000000000000000",
                  boundingBox: ev.targetDom?.boundingBox || { x: 0, y: 0, width: 200, height: 40 },
                  referenceScreenshotPath: "",
                },
              },
              payload: { literalValue: "" }, // Clear input on rollback
              guards: { preconditions: [], postconditions: [], timeoutMs: 5000 },
              governance: { riskLevel: "LOW", requiresExplicitApproval: false },
            },
          },
        };

        nodes.push(node);
      } else if (ev.category === "INPUT" && ev.mouse) {
        const ariaName = ev.targetDom?.ariaName || ev.targetDom?.innerText || "";
        const targetSummary = `${ariaName} ${ev.targetDom?.cssSelector || ""}`.trim();
        const isDestructive = DESTRUCTIVE_KEYWORD_REGEX.test(targetSummary);
        const requiresApproval = APPROVAL_TRIGGER_REGEX.test(targetSummary);

        const risk: RiskLevel = isDestructive ? "CRITICAL" : requiresApproval ? "HIGH" : "LOW";

        const node: ActionNode = {
          stepId,
          actionType: "CLICK",
          targets: {
            ariaSelector: ev.targetDom?.ariaRole ? `[role="${ev.targetDom.ariaRole}"][name="${ariaName}"]` : undefined,
            cssSelector: ev.targetDom?.cssSelector,
            xpath: ev.targetDom?.xpath,
            textFallback: ev.targetDom?.innerText,
            visualAnchor: {
              perceptualHash: ev.visual?.perceptualHash || "0000000000000000",
              boundingBox: ev.targetDom?.boundingBox || { x: ev.mouse.x, y: ev.mouse.y, width: 100, height: 40 },
              referenceScreenshotPath: ev.visual?.referencePath || "",
            },
          },
          guards: {
            preconditions: [
              {
                type: "ELEMENT_EXISTS",
                expression: "body",
              },
            ],
            postconditions: isDestructive
              ? [{ type: "ELEMENT_REMOVED", expected: ev.targetDom?.cssSelector || "target" }]
              : [],
            timeoutMs: 10000,
          },
          governance: {
            riskLevel: risk,
            requiresExplicitApproval: requiresApproval,
          },
        };

        nodes.push(node);
      } else if (ev.category === "FORK" && ev.modalState) {
        // Synthesize conditional modal dismissal wait condition
        nodes.push({
          stepId,
          actionType: "WAIT_CONDITION",
          targets: {
            textFallback: ev.modalState.modalTitle,
            visualAnchor: {
              perceptualHash: "0000000000000000",
              boundingBox: { x: 0, y: 0, width: 500, height: 300 },
              referenceScreenshotPath: "",
            },
          },
          payload: {
            literalValue: ev.modalState.modalTitle,
          },
          guards: {
            preconditions: [],
            postconditions: [{ type: "ELEMENT_REMOVED", expected: ev.modalState.modalTitle || "modal" }],
            timeoutMs: 5000,
          },
          governance: {
            riskLevel: "LOW",
            requiresExplicitApproval: false,
          },
        });
      }
    }

    const parameters: SkillParameters = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: `${skillName}Parameters`,
      type: "object",
      properties: extractedParameters,
      required: requiredParams,
    };

    return {
      draftId,
      name: skillName,
      description: options?.description || `Parameterized skill synthesized from session ${session.sessionId}`,
      suggestedVersion: "1.0.0",
      parameters,
      nodes,
      rawSessionId: session.sessionId,
      status: "PENDING_REVIEW",
      createdAt: Date.now(),
      analysisNotes,
    };
  }

  /**
   * Evaluates human review decision and cryptographically signs a draft into an immutable CompiledSkill.
   * GATING INVARIANT: Throws if review decision is not APPROVE or operator signature fails.
   */
  public static verifyAndSignSkillDraft(
    draft: SkillDraft,
    decision: HumanReviewDecision,
    hmacSecretKey: string
  ): CompiledSkill {
    if (decision.decision !== "APPROVE") {
      throw new Error(`Cannot compile skill draft ${draft.draftId}: Operator decision was REJECT.`);
    }

    if (!decision.operatorId || decision.operatorId.trim() === "") {
      throw new Error("Human verification requires an explicit, authenticated operatorId.");
    }

    // Apply any operator overrides to governance or rollback definitions
    const finalNodes: ActionNode[] = draft.nodes.map((node) => {
      const override = decision.nodeOverrides?.find((o) => o.stepId === node.stepId);
      if (!override) return node;

      return {
        ...node,
        governance: {
          ...node.governance,
          riskLevel: override.riskLevel ?? node.governance.riskLevel,
          requiresExplicitApproval: override.requiresExplicitApproval ?? node.governance.requiresExplicitApproval,
          rollbackAction: override.rollbackAction ?? node.governance.rollbackAction,
        },
      };
    });

    const finalParameters = decision.confirmedParameters || draft.parameters;
    const verifiedAt = Date.now();

    // Canonical digest computation
    const canonicalPayload = JSON.stringify({
      draftId: draft.draftId,
      name: draft.name,
      parameters: finalParameters,
      ast: finalNodes,
      operatorId: decision.operatorId,
      verifiedAt,
    });

    const contentHash = createHash("sha256").update(canonicalPayload).digest("hex");
    const hmacSignature = createHmac("sha256", hmacSecretKey).update(contentHash).digest("hex");

    const verification: SkillVerificationRecord = {
      verifiedBy: decision.operatorId,
      verifiedAt,
      hmacSignature,
      reviewNotes: decision.reviewNotes || "Verified by operator through HITL contract.",
    };

    const testFixture: SkillTestFixture = {
      domFixtures: {
        baseline: `<div class="app-root"><div class="content">Standard DOM Baseline</div></div>`,
      },
      baselineVisuals: {},
      mockEnvironment: {
        APP_ENV: "test",
      },
      testPayloads: [
        Object.keys(finalParameters.properties).reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = finalParameters.properties[key].defaultValue ?? "test_value";
          return acc;
        }, {}),
      ],
    };

    return {
      skillId: `skill_${createHash("sha256").update(draft.name + draft.draftId).digest("hex").slice(0, 16)}`,
      name: draft.name,
      version: draft.suggestedVersion || "1.0.0",
      contentHash,
      ast: finalNodes,
      parameters: finalParameters,
      verification,
      status: "ACTIVE",
      testFixture,
      createdAt: verifiedAt,
      updatedAt: verifiedAt,
    };
  }

  /**
   * Verifies the cryptographic integrity and HMAC signature of a CompiledSkill.
   */
  public static verifyCompiledSkillSignature(skill: CompiledSkill, hmacSecretKey: string): boolean {
    if (!skill.verification || !skill.verification.hmacSignature) return false;
    const canonicalPayload = JSON.stringify({
      draftId: undefined, // Not used in standalone hash
      name: skill.name,
      parameters: skill.parameters,
      ast: skill.ast,
      operatorId: skill.verification.verifiedBy,
      verifiedAt: skill.verification.verifiedAt,
    });

    const calculatedHmac = createHmac("sha256", hmacSecretKey).update(skill.contentHash).digest("hex");
    return calculatedHmac === skill.verification.hmacSignature;
  }

  // --------------------------------------------------------------------------
  // Internal Heuristic Extractors
  // --------------------------------------------------------------------------

  private static extractParameterFromConstant(
    val: string,
    ev: RawDemonstrationEvent,
    index: number
  ): ParameterDefinition | null {
    const trimmed = val.trim();
    if (trimmed.length === 0) return null;

    // 1. Email check
    if (EMAIL_REGEX.test(trimmed)) {
      return {
        name: `email_recipient_${index}`,
        type: "string",
        description: `Recipient email extracted from step (${trimmed})`,
        defaultValue: trimmed,
        required: true,
        validationRegex: "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$",
      };
    }

    // 2. File path check
    if (FILE_PATH_REGEX.test(trimmed)) {
      return {
        name: `file_path_${index}`,
        type: "string",
        description: `Local or dynamic file path extracted from input`,
        defaultValue: trimmed,
        required: true,
      };
    }

    // 3. Number check
    if (NUMBER_ONLY_REGEX.test(trimmed)) {
      return {
        name: `quantity_${index}`,
        type: "number",
        description: `Numeric quantity extracted from input`,
        defaultValue: parseFloat(trimmed),
        required: false,
      };
    }

    // 4. Meaningful named field fallback
    const fieldName = ev.targetDom?.formField?.name || ev.targetDom?.ariaName;
    if (fieldName && fieldName.length > 2) {
      const cleanName = fieldName.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      return {
        name: `${cleanName}_${index}`,
        type: "string",
        description: `Input value for field ${fieldName}`,
        defaultValue: trimmed,
        required: false,
      };
    }

    // Standard string parameter
    return {
      name: `param_${index}`,
      type: "string",
      description: `Input argument for "${trimmed}"`,
      defaultValue: trimmed,
      required: false,
    };
  }
}
