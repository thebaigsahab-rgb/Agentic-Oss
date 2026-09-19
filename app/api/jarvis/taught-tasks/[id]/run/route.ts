import { executeRunTaughtTask } from "@/lib/server/jarvis-tools";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const clientTimeZone = body.clientTimeZone || "UTC";

    const res = await executeRunTaughtTask({ taskId: id }, clientTimeZone);
    if (!res.ok) {
      return Response.json({ error: res.error?.message || "Failed to execute taught task" }, { status: 400 });
    }

    return Response.json(res);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to execute taught task." },
      { status: 500 },
    );
  }
}
