import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { getDatabase } from "@/lib/server/database";
import type { CapabilityGrant, ToolRiskLevel, VaultSecret } from "./types";
import { grantCapability, verifyCapability } from "./kernel-store";

// Master local encryption key derived from machine identifier + app salt
const KERNEL_SALT = "agentic-os-kernel-capability-vault-salt";
const MASTER_KEY = scryptSync("agentic-os-local-vault-key", KERNEL_SALT, 32);

/**
 * 11.2 Tool Risk Classification Dictionary
 */
export const TOOL_RISK_MAP: Record<string, ToolRiskLevel> = {
  // Read Operations
  get_system_status: "read",
  query_world_state: "read",
  list_desktop_windows: "read",
  take_screenshot: "read",
  search_arxiv: "read",
  read_file: "read",
  query_knowledge_memory: "read",

  // Low-risk Writes
  create_task: "low_risk_write",
  complete_task: "low_risk_write",
  create_reminder: "low_risk_write",
  save_memory: "low_risk_write",
  control_volume: "low_risk_write",

  // External Communication
  send_chat_message: "external_communication",
  open_url: "external_communication",
  search_web: "external_communication",

  // Sensitive Operations
  execute_terminal_command: "sensitive",
  execute_action: "sensitive",
  click_screen_coordinate: "sensitive",
  save_page_pdf: "sensitive",

  // Destructive / Irreversible
  delete_file: "destructive",
  format_disk: "irreversible",
  kill_system_process: "destructive",
  restart_workstation: "irreversible",
};

export function classifyToolRisk(toolName: string): ToolRiskLevel {
  return TOOL_RISK_MAP[toolName] || "sensitive";
}

/**
 * Checks policy permissions before allowing a tool call to proceed.
 */
export function enforceCapabilityPolicy(
  missionId: string,
  toolName: string,
  mode: "copilot" | "delegated" | "ghost" | "lockdown" = "delegated",
): { allowed: boolean; requiresUserApproval: boolean; reason?: string } {
  // 1. Lockdown mode blocks all action dispatches
  if (mode === "lockdown") {
    return { allowed: false, requiresUserApproval: false, reason: "System is in EMERGENCY LOCKDOWN mode." };
  }

  const risk = classifyToolRisk(toolName);

  // 2. Destructive and Irreversible actions always require approval
  if (risk === "destructive" || risk === "irreversible") {
    return { allowed: false, requiresUserApproval: true, reason: `Action '${toolName}' is classified as ${risk.toUpperCase()} and requires explicit user consent.` };
  }

  // 3. Copilot mode requests approval for anything above READ
  if (mode === "copilot" && risk !== "read") {
    return { allowed: false, requiresUserApproval: true, reason: `Copilot mode requires confirmation for write action '${toolName}'.` };
  }

  // 4. Ghost mode blocks sensitive external communication or desktop takeovers
  if (mode === "ghost" && risk === "sensitive") {
    return { allowed: false, requiresUserApproval: true, reason: `Ghost mode cannot execute sensitive desktop input without user presence.` };
  }

  // 5. Verify database capability grant
  const db = getDatabase();
  const grant = verifyCapability(db, missionId, `tool:${toolName}`);
  if (!grant.allowed) {
    // Auto-grant for safe read/low-risk tools under delegated mode
    if (risk === "read" || risk === "low_risk_write") {
      grantCapability(db, missionId, `tool:${toolName}`, risk);
      return { allowed: true, requiresUserApproval: false };
    }
  }

  return { allowed: true, requiresUserApproval: false };
}

/**
 * 11.3 Secret Redaction & Local Vault
 */
const SECRET_PATTERNS = [
  /(?:sk-[a-zA-Z0-9]{20,64})/g, // OpenAI style
  /(?:AIzaSy[a-zA-Z0-9_-]{25,45})/g, // Google API key style
  /(?:ant-[a-zA-Z0-9_-]{30,80})/g, // Anthropic key style
  /(?:ghp_[a-zA-Z0-9]{36})/g, // GitHub Personal Access Token
  /(?:bearer\s+[a-zA-Z0-9_.-]{30,})/gi, // Bearer tokens
  /(?:password\s*[:=]\s*["'][^"']+["'])/gi, // Plaintext passwords
];

export function redactSecrets(input: string): string {
  if (!input) return "";
  let sanitized = input;
  for (const regex of SECRET_PATTERNS) {
    sanitized = sanitized.replace(regex, "[REDACTED_SECRET]");
  }
  return sanitized;
}

export function encryptVaultSecret(plainText: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", MASTER_KEY, iv);
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptVaultSecret(payload: string): string | null {
  try {
    const [ivHex, tagHex, encryptedHex] = payload.split(":");
    if (!ivHex || !tagHex || !encryptedHex) return null;
    const decipher = createDecipheriv("aes-256-gcm", MASTER_KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}
