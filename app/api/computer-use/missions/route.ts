import { getDatabase } from "@/lib/server/database";
import { listAutonomousMissions } from "@/lib/server/computer-skills-store";
import { startAutonomousMission } from "@/lib/server/mission-orchestrator";
import type { AgentInputMode } from "@/lib/computer-use-types";

export const runtime = "nodejs";

const INPUT_MODES: AgentInputMode[] = ["agent_owned", "auto_idle", "takeover"];

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const missions = listAutonomousMissions(database, limit);
    return Response.json({ ok: true, missions });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list missions." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      goal: string;
      mode?: "away" | "interactive";
      userAway?: boolean;
      inputMode?: AgentInputMode;
    };

    if (!body.goal || !body.goal.trim()) {
      return Response.json({ error: "Mission goal is required." }, { status: 400 });
    }

    const database = getDatabase();
    const mission = await startAutonomousMission(database, {
      goal: body.goal.trim(),
      mode: body.mode || "away",
      userAway: body.userAway !== false,
      inputMode: body.inputMode && INPUT_MODES.includes(body.inputMode) ? body.inputMode : undefined,
    });

    return Response.json({ ok: true, mission }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to launch autonomous mission." },
      { status: 500 },
    );
  }
}
