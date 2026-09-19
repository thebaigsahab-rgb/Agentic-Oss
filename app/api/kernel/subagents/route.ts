import { NextResponse } from "next/server";
import { SUBAGENT_GUILDS, dispatchToSubAgent, runUnifiedSubAgentCouncil, type SubAgentRole } from "@/lib/server/subagent-guild";

export async function GET() {
  return NextResponse.json({
    guilds: Object.values(SUBAGENT_GUILDS),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.council && body.objective) {
      const councilResult = await runUnifiedSubAgentCouncil(body.objective);
      return NextResponse.json({
        success: true,
        ...councilResult,
      });
    }

    const { role = "software_engineer", task, context = {} } = body;
    if (!task) {
      return NextResponse.json({ error: "Missing required 'task' property." }, { status: 400 });
    }

    const result = await dispatchToSubAgent(role as SubAgentRole, task, context);
    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
