import { getDatabase } from "@/lib/server/database";
import { listTaughtTasks, createTaughtTask, type TaughtTask } from "@/lib/agentic-store";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const tasks = listTaughtTasks(database, Math.min(limit, 100));
    return Response.json({ ok: true, tasks });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load taught tasks." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<TaughtTask>;
    const name = (body.name || "").trim();
    const triggerPhrase = (body.triggerPhrase || "").trim();
    const steps = Array.isArray(body.steps) ? body.steps : [];

    if (!name) return Response.json({ error: "Task name is required." }, { status: 400 });
    if (!triggerPhrase) return Response.json({ error: "Trigger phrase is required." }, { status: 400 });
    if (steps.length === 0) return Response.json({ error: "At least one step is required." }, { status: 400 });

    const database = getDatabase();
    const id = `tt_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

    const task = createTaughtTask(database, {
      id,
      name,
      triggerPhrase,
      description: body.description?.trim(),
      steps: steps.map((s, i) => ({
        id: s.id || `step_${i + 1}`,
        instruction: (s.instruction || "").trim(),
        tool: s.tool || undefined,
        args: s.args || undefined,
      })),
    });

    return Response.json({ ok: true, task }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create taught task." },
      { status: 500 },
    );
  }
}
