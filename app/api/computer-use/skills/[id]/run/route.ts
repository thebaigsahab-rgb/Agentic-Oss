import { getDatabase } from "@/lib/server/database";
import { getComputerSkill, recordSkillRun, recordComputerUseLog } from "@/lib/server/computer-skills-store";
import { executeAction } from "@/lib/server/computer-use-engine";
import type { ActionExecutionResult, ScreenState } from "@/lib/computer-use-types";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const MAX_HUMAN_PAUSE_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params;
    const body = (await request.json().catch(() => ({}))) as {
      parameters?: Record<string, string | number | boolean>;
      stream?: boolean;
    };

    const database = getDatabase();
    const skill = getComputerSkill(database, id);
    if (!skill) {
      return Response.json({ error: "Skill not found." }, { status: 404 });
    }

    const params = body.parameters || {};
    const wantsStream =
      body.stream === true ||
      (request.headers.get("accept") || "").includes("text/event-stream");

    let currentScreen: ScreenState | undefined = undefined;
    let cursor = { x: 500, y: 260 };
    const stepResults: ActionExecutionResult[] = [];

    // JSON fallback: execute everything, respond once (used by tests and
    // any caller that has not opted into playback streaming).
    if (!wantsStream) {
      for (let i = 0; i < skill.steps.length; i += 1) {
        const step = { ...skill.steps[i] };
        if (step.value) {
          for (const [k, v] of Object.entries(params)) {
            step.value = step.value.replaceAll(`{{${k}}}`, String(v));
          }
        }

        const res = await executeAction(step, currentScreen, { cursorFrom: cursor });
        stepResults.push(res);
        if (res.cursorPosition) cursor = res.cursorPosition;
        if (res.screenState) currentScreen = res.screenState;

        recordComputerUseLog(database, {
          id: `log_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
          skillId: skill.id,
          stepNumber: i + 1,
          actionType: step.action,
          actionPayload: step,
          thought: `Executing step ${i + 1} of skill "${skill.name}": ${step.description}`,
          result: res,
          cursorPosition: res.cursorPosition,
          screenUrl: currentScreen?.url,
          screenTitle: currentScreen?.title,
          executedAt: new Date().toISOString(),
        });

        if (!res.success) {
          recordSkillRun(database, skill.id, false);
          return Response.json({
            ok: false,
            skill,
            error: `Step ${i + 1} failed: ${res.error}`,
            stepResults,
            finalScreen: currentScreen,
          });
        }
      }

      recordSkillRun(database, skill.id, true);
      return Response.json({
        ok: true,
        skill,
        completedSteps: stepResults.length,
        stepResults,
        finalScreen: currentScreen,
      });
    }

    // Streamed playback: each step is announced before execution and its
    // result (with the human motor plan) is emitted right after, spaced by a
    // human-like pause so the UI can animate the agent's own mouse/keyboard.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        try {
          emit({ type: "start", skill: { id: skill.id, name: skill.name, triggerPhrase: skill.triggerPhrase }, totalSteps: skill.steps.length });

          for (let i = 0; i < skill.steps.length; i += 1) {
            const step = { ...skill.steps[i] };
            if (step.value) {
              for (const [k, v] of Object.entries(params)) {
                step.value = step.value.replaceAll(`{{${k}}}`, String(v));
              }
            }

            emit({ type: "step_start", index: i, step, description: step.description });
            await sleep(Math.min(step.timeoutMs || 0, 400));

            const res = await executeAction(step, currentScreen, { cursorFrom: cursor });
            stepResults.push(res);
            if (res.cursorPosition) cursor = res.cursorPosition;
            if (res.screenState) currentScreen = res.screenState;

            emit({ type: "step_result", index: i, result: res });

            recordComputerUseLog(database, {
              id: `log_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
              skillId: skill.id,
              stepNumber: i + 1,
              actionType: step.action,
              actionPayload: step,
              thought: `Executing step ${i + 1} of skill "${skill.name}": ${step.description}`,
              result: res,
              cursorPosition: res.cursorPosition,
              screenUrl: currentScreen?.url,
              screenTitle: currentScreen?.title,
              executedAt: new Date().toISOString(),
            });

            if (!res.success) {
              recordSkillRun(database, skill.id, false);
              emit({ type: "done", ok: false, error: `Step ${i + 1} failed: ${res.error}`, completedSteps: stepResults.filter((r) => r.success).length, finalScreen: currentScreen });
              controller.close();
              return;
            }

            // Human-like operating cadence between actions.
            const pause = Math.min(res.motorPlan?.postDelayMs ?? 220, MAX_HUMAN_PAUSE_MS) + 120;
            await sleep(pause);
          }

          recordSkillRun(database, skill.id, true);
          emit({ type: "done", ok: true, completedSteps: stepResults.length, finalScreen: currentScreen });
          controller.close();
        } catch (error) {
          emit({ type: "error", message: error instanceof Error ? error.message : "Failed to execute skill." });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to execute skill." },
      { status: 500 },
    );
  }
}
