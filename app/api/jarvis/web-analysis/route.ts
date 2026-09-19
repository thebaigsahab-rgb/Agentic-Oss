import { executeAnalyzeWebPage } from "@/lib/server/jarvis-tools";
import type { AnalyzeWebPageArgs } from "@/lib/jarvis-types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    }

    const body = (await request.json()) as AnalyzeWebPageArgs;
    if (!body || !body.url) {
      return Response.json({ error: "Field 'url' is required." }, { status: 400 });
    }

    const result = await executeAnalyzeWebPage(body);
    if (!result.ok) {
      return Response.json({ error: result.error?.message || "Web analysis failed" }, { status: 422 });
    }

    return Response.json(result.data);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error analyzing webpage." },
      { status: 500 },
    );
  }
}
