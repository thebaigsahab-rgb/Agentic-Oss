import { getDatabase } from "@/lib/server/database";
import { listAgenticJobs, getAgenticJob } from "@/lib/agentic-store";
import { startBackgroundResearchJob } from "@/lib/server/agentic-research";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const url = new URL(request.url);
    const jobId = url.searchParams.get("id");

    if (jobId) {
      const job = getAgenticJob(database, jobId);
      if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
      return Response.json({ ok: true, job });
    }

    const limit = parseInt(url.searchParams.get("limit") || "30", 10);
    const jobs = listAgenticJobs(database, Math.min(limit, 100));
    return Response.json({ ok: true, jobs });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load agentic jobs." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: string; type?: "paper_research" | "web_deep_dive" };
    const query = (body.query || "").trim();

    if (!query) {
      return Response.json({ error: "Query is required to start a background research job." }, { status: 400 });
    }

    const job = startBackgroundResearchJob(query, body.type || "paper_research");
    return Response.json({ ok: true, job }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to start agentic job." },
      { status: 500 },
    );
  }
}
