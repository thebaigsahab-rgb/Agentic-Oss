import { getDatabase } from "@/lib/server/database";
import { listTaskRunLogs } from "@/lib/agentic-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId") || undefined;
    const limit = Number(searchParams.get("limit")) || 30;

    const database = getDatabase();
    const runs = listTaskRunLogs(database, taskId, limit);

    return Response.json({ runs, total: runs.length });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to retrieve run logs." },
      { status: 500 },
    );
  }
}
