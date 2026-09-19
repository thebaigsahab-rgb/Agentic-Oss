import { getDatabase } from "@/lib/server/database";
import {
  getAutonomousMission,
  updateAutonomousMission,
  listComputerUseLogs,
} from "@/lib/server/computer-skills-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params;
    const database = getDatabase();
    const mission = getAutonomousMission(database, id);
    if (!mission) {
      return Response.json({ error: "Mission not found." }, { status: 404 });
    }

    const logs = listComputerUseLogs(database, id, 50);
    return Response.json({ ok: true, mission, logs });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load mission." },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params;
    const body = (await request.json()) as { action: "pause" | "resume" | "cancel" };
    const database = getDatabase();
    const mission = getAutonomousMission(database, id);
    if (!mission) {
      return Response.json({ error: "Mission not found." }, { status: 404 });
    }

    let nextStatus = mission.status;
    if (body.action === "pause") nextStatus = "paused";
    else if (body.action === "resume") nextStatus = "running";
    else if (body.action === "cancel") nextStatus = "cancelled";

    const updated = updateAutonomousMission(database, id, { status: nextStatus });
    return Response.json({ ok: true, mission: updated });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update mission." },
      { status: 500 },
    );
  }
}
