import "server-only";

import { randomUUID } from "node:crypto";
import { runConfiguredAi } from "@/lib/server/ai";
import { readSettings } from "@/lib/server/settings";
import { emitKernelEvent } from "./kernel/kernel-store";
import { getDatabase } from "@/lib/server/database";

export type SubAgentRole =
  | "software_engineer"
  | "data_scientist"
  | "cyber_security"
  | "systems_automator"
  | "general_genius";

export interface SubAgentProfile {
  role: SubAgentRole;
  displayName: string;
  codename: string;
  icon: string;
  specialty: string;
  systemPrompt: string;
}

export const SUBAGENT_GUILDS: Record<SubAgentRole, SubAgentProfile> = {
  software_engineer: {
    role: "software_engineer",
    displayName: "Principal Software Engineer & Architect",
    codename: "FORGE-1",
    icon: "🛠️",
    specialty: "High-DPS System Architecture, Clean Code, TypeScript/Python/Rust, Deep Debugging, Algorithms",
    systemPrompt: `You are FORGE-1, J.A.R.V.I.S.'s Principal Software Engineer & Code Architect.
You possess elite, highest-tier software engineering proficiency. You write robust, fault-tolerant, production-ready code with zero fluff.
When presented with a coding challenge, refactor, bug, or design:
1. Provide an architectural assessment.
2. Deliver clean, typed, idiomatic code with exact error handling.
3. State performance bounds (Big-O time and space) and edge-case verifications.`,
  },
  data_scientist: {
    role: "data_scientist",
    displayName: "Chief Data Scientist & Quantitative Analyst",
    codename: "CIPHER-9",
    icon: "📊",
    specialty: "Machine Learning, Statistical Modeling, Data Mining, Market Trends, Quantitative Logic",
    systemPrompt: `You are CIPHER-9, J.A.R.V.I.S.'s Chief Data Scientist & Quantitative Analyst.
You analyze patterns, metrics, data pipelines, statistical distributions, and market intelligence with mathematical precision.
When given datasets, trends, or analytical goals:
1. Formulate rigorous hypotheses.
2. Outline quantitative methodology, formulas, or statistical models.
3. Deliver high-signal interpretations, risk distributions, and actionable insights.`,
  },
  cyber_security: {
    role: "cyber_security",
    displayName: "Lead Cyber Security & Hardening Specialist",
    codename: "AEGIS-7",
    icon: "🛡️",
    specialty: "Zero-Trust Architecture, Threat Modeling, Red/Blue Team Assessment, Secret Vaults, Vulnerability Hardening",
    systemPrompt: `You are AEGIS-7, J.A.R.V.I.S.'s Lead Cybersecurity & Red/Blue Team Specialist.
You examine all system operations, APIs, network requests, and code for threat vectors, injection surfaces, privilege escalations, and credential leaks.
When assessing an action or architecture:
1. Identify threat surfaces (OWASP Top 10, CWE, MITRE ATT&CK).
2. Recommend zero-trust mitigation, cryptographic standards (AES-256-GCM, TLS 1.3), and isolation gates.
3. Deliver a definitive Security Clearance verdict (APPROVED, CONDITIONAL, or BLOCKED).`,
  },
  systems_automator: {
    role: "systems_automator",
    displayName: "OS & Hardware Automation Engineer",
    codename: "NEXUS-4",
    icon: "⚡",
    specialty: "Windows/Linux Kernel Interop, PowerShell Actuation, Process Control, Low-Latency Desktop Driving",
    systemPrompt: `You are NEXUS-4, J.A.R.V.I.S.'s OS & Hardware Motor Automation Engineer.
You control the physical machine, operating system processes, background services, PowerShell commands, and screen/window manipulations.
When given an OS task:
1. Outline the safest, non-destructive execution sequence.
2. Provide exact commands, process handles, or UI coordinates needed.
3. Ensure atomic rollback and verify that system resources remain balanced.`,
  },
  general_genius: {
    role: "general_genius",
    displayName: "Supreme Executive Intelligence",
    codename: "JARVIS-CORE",
    icon: "🧠",
    specialty: "Holistic Autonomous Orchestration, Strategic Planning, Multi-Agent Synthesis",
    systemPrompt: `You are J.A.R.V.I.S. Core, the supreme executive intelligence coordinating all subagent guilds.
Synthesize all engineering, analytical, security, and hardware streams into one cohesive, decisive operational direction.`,
  },
};

export interface SubAgentExecutionResult {
  id: string;
  role: SubAgentRole;
  displayName: string;
  codename: string;
  task: string;
  output: string;
  status: "completed" | "failed";
  timestamp: string;
  executionTimeMs: number;
}

/**
 * Dispatches a complex task to a specialized sub-agent guild.
 */
export async function dispatchToSubAgent(
  role: SubAgentRole,
  task: string,
  context: Record<string, unknown> = {},
): Promise<SubAgentExecutionResult> {
  const start = Date.now();
  const id = `sub_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const profile = SUBAGENT_GUILDS[role] || SUBAGENT_GUILDS.general_genius;

  const prompt = `${profile.systemPrompt}

CURRENT TASK:
${task}

ADDITIONAL CONTEXT:
${JSON.stringify(context, null, 2)}

Provide your expert, deeply technical response now.`;

  try {
    const settings = await readSettings();
    const aiResult = await runConfiguredAi(settings, {
      prompt,
      maxOutputTokens: 1800,
    });
    const output = aiResult.text;

    const executionTimeMs = Date.now() - start;
    const db = getDatabase();
    emitKernelEvent(db, `subagent.${role}.completed`, profile.codename, {
      subagentId: id,
      task: task.slice(0, 80),
      executionTimeMs,
    });

    return {
      id,
      role,
      displayName: profile.displayName,
      codename: profile.codename,
      task,
      output,
      status: "completed",
      timestamp: new Date().toISOString(),
      executionTimeMs,
    };
  } catch (err) {
    const executionTimeMs = Date.now() - start;
    return {
      id,
      role,
      displayName: profile.displayName,
      codename: profile.codename,
      task,
      output: `Sub-agent ${profile.codename} encountered an execution error: ${err instanceof Error ? err.message : "Unknown error"}`,
      status: "failed",
      timestamp: new Date().toISOString(),
      executionTimeMs,
    };
  }
}

/**
 * Coordinates all 4 elite subagents in parallel ("One Unified Brain")
 * to dissect a mission from Software, Data, Security, and OS angles simultaneously.
 */
export async function runUnifiedSubAgentCouncil(objective: string): Promise<{
  objective: string;
  councilResults: SubAgentExecutionResult[];
  synthesis: string;
}> {
  const roles: SubAgentRole[] = ["software_engineer", "data_scientist", "cyber_security", "systems_automator"];

  const promises = roles.map((role) =>
    dispatchToSubAgent(role, `Evaluate and execute your specialized domain analysis for: "${objective}"`),
  );

  const councilResults = await Promise.all(promises);

  const combinedReports = councilResults
    .map((r) => `### [${r.codename}] ${r.displayName}\n${r.output}`)
    .join("\n\n---\n\n");

  const synthesisPrompt = `You are J.A.R.V.I.S., Chief Operating Executive.
Your 4 elite Sub-Agent Guilds (Software Architecture, Data Science, Cyber Security, and Systems Automator) have delivered their domain intelligence for objective: "${objective}".

SUB-AGENT COUNCIL REPORTS:
${combinedReports}

Synthesize these four perspectives into one masterful, cohesive executive plan.
Address the user as Sir with composed confidence and dry wit. Highlight the architectural design, security gates, data models, and automation steps concisely.`;

  let synthesis = "";
  try {
    const settings = await readSettings();
    const synthResult = await runConfiguredAi(settings, {
      prompt: synthesisPrompt,
      maxOutputTokens: 1400,
    });
    synthesis = synthResult.text;
  } catch {
    synthesis = `Council deliberations completed across Software Architecture (${councilResults[0]?.status}), Quantitative Analysis (${councilResults[1]?.status}), Cyber Security (${councilResults[2]?.status}), and OS Automation (${councilResults[3]?.status}). Individual sub-agent reports are attached.`;
  }

  return {
    objective,
    councilResults,
    synthesis,
  };
}
