import { getDatabase } from "@/lib/server/database";
import { getTaughtTask, deleteTaughtTask } from "@/lib/agentic-store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const database = getDatabase();
    const task = getTaughtTask(database, id);
    if (!task) return Response.json({ error: "Taught task not found." }, { status: 404 });
    return Response.json({ ok: true, task });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load taught task." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const database = getDatabase();
    const deleted = deleteTaughtTask(database, id);
    if (!deleted) return Response.json({ error: "Taught task not found." }, { status: 404 });
    return Response.json({ ok: true, deleted: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete taught task." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const database = getDatabase();

    const { scheduleTaughtTask } = await import("@/lib/agentic-store");
    const updated = scheduleTaughtTask(database, id, {
      type: body.type || body.scheduleType || "manual",
      scheduledTime: body.scheduledTime,
      inMinutes: body.inMinutes,
      intervalMinutes: body.intervalMinutes,
    });

    if (!updated) return Response.json({ error: "Taught task not found." }, { status: 404 });
    return Response.json({ ok: true, task: updated });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update taught task schedule." },
      { status: 500 },
    );
  }
}

