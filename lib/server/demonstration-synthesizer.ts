import "server-only";

import { randomUUID } from "node:crypto";
import type { ComputerSkill, DemonstrationEvent, ComputerActionStep, SkillParameter } from "@/lib/computer-use-types";
import { runConfiguredAi } from "@/lib/server/ai";
import { readSettings } from "@/lib/server/settings";

export async function synthesizeDemonstrationToSkill(params: {
  skillName: string;
  triggerPhrase?: string;
  description?: string;
  events: DemonstrationEvent[];
}): Promise<Omit<ComputerSkill, "createdAt" | "updatedAt" | "runCount" | "successRate">> {
  const { skillName, triggerPhrase, description, events } = params;

  if (!events || events.length === 0) {
    throw new Error("No demonstration events recorded to synthesize.");
  }

  // 1. Convert raw events to initial action steps
  const initialSteps: ComputerActionStep[] = events.map((ev, idx) => {
    const stepId = `step_${idx + 1}`;
    let desc = `${ev.action}`;
    if (ev.action === "navigate") {
      desc = `Navigate to ${ev.targetUrl || ev.value}`;
    } else if (ev.action === "mouse_click") {
      desc = `Click on "${ev.elementText || ev.selector || "element"}"`;
    } else if (ev.action === "type_text") {
      desc = `Type "${ev.value}"`;
    } else if (ev.action === "mouse_scroll") {
      desc = `Scroll down by ${ev.scrollDelta?.dy || 300}px`;
    } else if (ev.action === "key_press") {
      desc = `Press ${ev.keyCombination || "Enter"}`;
    } else if (ev.action === "extract_data") {
      desc = `Extract data from page`;
    }

    return {
      id: stepId,
      action: ev.action,
      description: desc,
      target: {
        elementId: ev.elementId,
        selector: ev.selector,
        text: ev.elementText,
        coords: ev.coords,
      },
      value: ev.value || ev.targetUrl,
      scrollDelta: ev.scrollDelta,
      keyCombination: ev.keyCombination,
    };
  });

  // 2. Identify potential parameters from typed text or specific search queries
  const detectedParams: SkillParameter[] = [];
  const typedEvents = events.filter((e) => e.action === "type_text" && e.value && e.value.trim().length > 0);

  for (let i = 0; i < typedEvents.length; i++) {
    const val = typedEvents[i].value!.trim();
    const paramName = typedEvents.length === 1 ? "query" : `input_${i + 1}`;
    detectedParams.push({
      name: paramName,
      type: "string",
      description: `Input value for "${val}"`,
      defaultValue: val,
      required: false,
    });
  }

  // 3. Attempt AI synthesis for optimal generalization and parameters
  try {
    const settings = await readSettings();
    const prompt = `You are an elite Computer-Use AI Engineer in an Agentic OS.
A user demonstrated a browser/desktop task to teach a new autonomous skill named "${skillName}".
Here is the recorded action sequence:
${JSON.stringify(initialSteps, null, 2)}

Analyze this demonstration and output a clean JSON specification:
{
  "triggerPhrase": "A concise, natural trigger phrase (e.g. 'search github trending' or 'extract paper summaries')",
  "description": "Clear 1-2 sentence description of what this autonomous skill performs",
  "category": "browser",
  "parameters": [
    {
      "name": "paramName",
      "type": "string",
      "description": "What this input parameter represents",
      "defaultValue": "default value",
      "required": false
    }
  ],
  "steps": [
    {
      "id": "step_1",
      "action": "navigate",
      "description": "High level description of step",
      "value": "URL or text (can use {{paramName}} templates)"
    }
  ]
}
Respond ONLY in valid JSON with no markdown formatting.`;

    const aiRes = await runConfiguredAi(settings, {
      prompt,
      maxOutputTokens: 2000,
    });

    const cleaned = aiRes.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)```$/i, "$1").trim();
    const parsed = JSON.parse(cleaned);

    return {
      id: `skill_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      name: skillName.trim(),
      triggerPhrase: (triggerPhrase || parsed.triggerPhrase || skillName).toLowerCase().trim(),
      description: parsed.description || description || `Autonomous routine for ${skillName}`,
      category: parsed.category || "browser",
      parameters: Array.isArray(parsed.parameters) && parsed.parameters.length > 0 ? parsed.parameters : detectedParams,
      steps: Array.isArray(parsed.steps) && parsed.steps.length > 0 ? parsed.steps : initialSteps,
      rawDemonstration: events,
    };
  } catch (err) {
    // Graceful rule-based fallback if AI is unconfigured or failed
    return {
      id: `skill_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      name: skillName.trim(),
      triggerPhrase: (triggerPhrase || skillName).toLowerCase().trim(),
      description: description || `Learned skill: ${skillName} (${initialSteps.length} steps)`,
      category: "browser",
      parameters: detectedParams,
      steps: initialSteps,
      rawDemonstration: events,
    };
  }
}
