import type { ApprovalRecord } from "./types";
import {
  generateApprovalCode,
  hashApprovalCode,
  verifyApprovalCode,
  normalizeE164,
} from "./crypto";

export interface ParsedIntent {
  intent:
    | "status"
    | "daily_brief"
    | "panic"
    | "approve"
    | "cancel"
    | "run_task"
    | "system_exec"
    | "help"
    | "unknown";
  isSensitive: boolean;
  approvalCode?: string;
  commandPayload?: string;
  rawText: string;
}

/**
 * Deterministic command lexer & sensitivity evaluator.
 */
export function parseIntent(rawInput: string): ParsedIntent {
  const text = (rawInput || "").trim();
  const upper = text.toUpperCase();

  // 1. APPROVE <code>
  const approveMatch = text.match(/^APPROVE\s+([A-Z0-9]{4,10})/i);
  if (approveMatch) {
    return {
      intent: "approve",
      isSensitive: false,
      approvalCode: approveMatch[1].trim().toUpperCase(),
      rawText: text,
    };
  }

  // 2. CANCEL [code] or REJECT [code]
  const cancelMatch = text.match(/^(CANCEL|REJECT)(\s+([A-Z0-9]{4,10}))?/i);
  if (cancelMatch) {
    return {
      intent: "cancel",
      isSensitive: false,
      approvalCode: cancelMatch[3] ? cancelMatch[3].trim().toUpperCase() : undefined,
      rawText: text,
    };
  }

  // 3. STATUS or PING
  if (upper === "STATUS" || upper === "PING" || upper === "HEALTH") {
    return {
      intent: "status",
      isSensitive: false,
      rawText: text,
    };
  }

  // 4. DAILY BRIEF or BRIEF
  if (upper === "DAILY BRIEF" || upper === "BRIEF" || upper === "DAILY_BRIEF") {
    return {
      intent: "daily_brief",
      isSensitive: false,
      rawText: text,
    };
  }

  // 5. PANIC or LOCKDOWN (Emergency immediate execution)
  if (upper === "PANIC" || upper === "LOCKDOWN" || upper === "EMERGENCY STOP") {
    return {
      intent: "panic",
      isSensitive: false, // Auto-executes immediately for emergency defense
      rawText: text,
    };
  }

  // 6. HELP
  if (upper === "HELP" || upper === "INFO" || upper === "?") {
    return {
      intent: "help",
      isSensitive: false,
      rawText: text,
    };
  }

  // 7. Explicit execution commands: RUN <task>, EXEC <cmd>, MISSION <mission>
  const runMatch = text.match(/^(RUN|EXEC|EXECUTE|MISSION)\s+(.+)$/i);
  if (runMatch) {
    return {
      intent: "run_task",
      isSensitive: true,
      commandPayload: runMatch[2].trim(),
      rawText: text,
    };
  }

  // 8. Natural Language & Sensitivity Heuristics
  const sensitivePatterns = [
    /\b(delete|remove|rm|drop|erase)\b/i,
    /\b(restart|reboot|shutdown|poweroff|kill)\b/i,
    /\b(deploy|publish|release|push)\b/i,
    /\b(install|update|upgrade)\b/i,
    /\b(transfer|send money|pay)\b/i,
    /\b(format|reset|truncate)\b/i,
    /\b(exec|execute|script|cmd|powershell|bash)\b/i,
  ];

  const isSensitive = sensitivePatterns.some((pat) => pat.test(text));

  if (isSensitive) {
    return {
      intent: "run_task",
      isSensitive: true,
      commandPayload: text,
      rawText: text,
    };
  }

  // Harmless read queries: "what is...", "how is...", "summary", "logs"
  const readPatterns = [
    /\b(how|what|who|show|view|get|list|display|summary)\b/i,
  ];

  if (readPatterns.some((pat) => pat.test(text))) {
    return {
      intent: "status",
      isSensitive: false,
      commandPayload: text,
      rawText: text,
    };
  }

  // Default fallback: any unrecognized command defaults to sensitive to avoid unauthorized execution
  return {
    intent: "unknown",
    isSensitive: true,
    commandPayload: text,
    rawText: text,
  };
}

/**
 * Two-phase HITL (Human-In-The-Loop) Approval State Machine.
 * Enforces CSPRNG 6-character tokens, salted SHA-256 storage, 10-minute TTL, and 3-attempt limit.
 */
export class ApprovalStore {
  private static instance: ApprovalStore | null = null;
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly ttlMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.scheduleCleanup();
  }

  public static getInstance(ttlMs?: number): ApprovalStore {
    if (!ApprovalStore.instance) {
      ApprovalStore.instance = new ApprovalStore(ttlMs);
    }
    return ApprovalStore.instance;
  }

  /**
   * Creates a new pending HITL approval token for a sensitive job.
   */
  public createApproval(
    jobId: string,
    senderNumber: string,
    actionSummary: string,
    customTtlMs?: number
  ): { approval: ApprovalRecord; plainCode: string } {
    const normalizedNumber = normalizeE164(senderNumber) || senderNumber;
    const approvalId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const plainCode = generateApprovalCode(6);
    const { hash, salt } = hashApprovalCode(plainCode);

    const ttl = customTtlMs || this.ttlMs;
    const now = Date.now();

    // Invalidate any previously pending approvals for this sender number
    this.cancelPendingForSender(normalizedNumber);

    const approval: ApprovalRecord = {
      approvalId,
      jobId,
      codeHash: hash,
      salt,
      actionSummary,
      senderNumber: normalizedNumber,
      createdAt: now,
      expiresAt: now + ttl,
      attempts: 0,
      maxAttempts: 3,
      status: "PENDING",
    };

    this.approvals.set(approvalId, approval);
    return { approval, plainCode };
  }

  public findActiveOrRecentForSender(senderNumber: string): ApprovalRecord | undefined {
    let latest: ApprovalRecord | undefined;
    for (const record of this.approvals.values()) {
      if (record.senderNumber === senderNumber) {
        if (!latest || record.createdAt > latest.createdAt) {
          latest = record;
        }
      }
    }
    return latest;
  }

  /**
   * Validates and consumes candidate approval code for a sender number.
   * Enforces 10-minute expiration, 3-attempt limit, and constant-time salted verification.
   */
  public consumeApproval(
    senderNumber: string,
    candidateCode: string
  ): { success: boolean; error?: string; approval?: ApprovalRecord } {
    const normalized = normalizeE164(senderNumber) || senderNumber;
    const pending = this.findActiveOrRecentForSender(normalized);

    if (!pending) {
      return {
        success: false,
        error: "No pending approval request found for your number.",
      };
    }

    const now = Date.now();

    // Check if already rejected/cancelled or max attempts reached
    if (pending.status === "REJECTED" || pending.attempts >= pending.maxAttempts) {
      if (pending.attempts >= pending.maxAttempts) {
        return {
          success: false,
          error: "Maximum approval attempts exceeded (3/3). Action permanently rejected.",
        };
      }
      return {
        success: false,
        error: "No pending approval request found for your number.",
      };
    }

    if (pending.status === "APPROVED") {
      return {
        success: false,
        error: "This request has already been approved.",
      };
    }

    // Check expiration
    if (pending.status === "EXPIRED" || now > pending.expiresAt) {
      pending.status = "EXPIRED";
      return {
        success: false,
        error: "Approval code has expired (10-minute time limit exceeded). Action aborted.",
      };
    }

    // Increment attempt counter before comparison
    pending.attempts += 1;

    // Verify salted hash
    const isValid = verifyApprovalCode(candidateCode, pending.codeHash, pending.salt);

    if (!isValid) {
      const remaining = pending.maxAttempts - pending.attempts;
      if (remaining <= 0) {
        pending.status = "REJECTED";
        return {
          success: false,
          error: "Invalid approval code. Maximum attempts reached (3/3). Action rejected.",
        };
      }
      return {
        success: false,
        error: `Invalid approval code. ${remaining} attempt(s) remaining.`,
      };
    }

    // Success: Transition to APPROVED
    pending.status = "APPROVED";
    return {
      success: true,
      approval: pending,
    };
  }

  /**
   * Cancels any pending approval for the given sender.
   */
  public cancelPendingForSender(senderNumber: string): boolean {
    const normalized = normalizeE164(senderNumber) || senderNumber;
    const pending = this.findActiveOrRecentForSender(normalized);
    if (pending && pending.status === "PENDING") {
      pending.status = "REJECTED";
      return true;
    }
    return false;
  }

  public getApproval(approvalId: string): ApprovalRecord | undefined {
    return this.approvals.get(approvalId);
  }

  public findPendingForSender(senderNumber: string): ApprovalRecord | undefined {
    const record = this.findActiveOrRecentForSender(senderNumber);
    if (record && record.status === "PENDING" && record.expiresAt > Date.now()) {
      return record;
    }
    return undefined;
  }

  public clear(): void {
    this.approvals.clear();
  }

  public sweep(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, record] of this.approvals.entries()) {
      if (now > record.expiresAt && record.status === "PENDING") {
        record.status = "EXPIRED";
        count++;
      }
      // Delete old resolved records after 1 hour
      if (now > record.expiresAt + 60 * 60 * 1000) {
        this.approvals.delete(id);
      }
    }
    return count;
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private scheduleCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.sweep();
    }, 60 * 1000);

    if (this.cleanupTimer && typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
  }
}

export const globalApprovalStore = ApprovalStore.getInstance();
