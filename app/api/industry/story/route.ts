import { getDatabase } from "@/lib/server/database";
import { buildStoryBrief, getCachedStoryBrief } from "@/lib/server/story-brief";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return Response.json({ error: "A story url is required." }, { status: 400 });
  }
  const cached = getCachedStoryBrief(getDatabase(), url);
  return Response.json({ brief: cached });
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    }

    const body = (await request.json().catch(() => null)) as {
      url?: string;
      title?: string;
      summary?: string;
    } | null;

    if (!body?.url || typeof body.url !== "string") {
      return Response.json({ error: "A story url is required." }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(body.url.trim())) {
      return Response.json({ error: "Only http(s) story urls can be briefed." }, { status: 400 });
    }

    const database = getDatabase();
    const cached = getCachedStoryBrief(database, body.url);
    if (cached) {
      return Response.json({ brief: cached });
    }

    const brief = await buildStoryBrief({
      url: body.url,
      title: (body.title || body.url).slice(0, 300),
      summary: typeof body.summary === "string" ? body.summary.slice(0, 2000) : undefined,
    });

    return Response.json({ brief });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to build the story brief." },
      { status: 500 },
    );
  }
}
