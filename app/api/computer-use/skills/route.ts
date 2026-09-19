import { getDatabase } from "@/lib/server/database";
import { listComputerSkills, createComputerSkill } from "@/lib/server/computer-skills-store";
import type { ComputerSkill } from "@/lib/computer-use-types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const skills = listComputerSkills(database, limit);
    return Response.json({ ok: true, skills });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list computer skills." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ComputerSkill>;
    const name = (body.name || "").trim();
    const triggerPhrase = (body.triggerPhrase || "").trim();

    if (!name) return Response.json({ error: "Skill name is required." }, { status: 400 });
    if (!triggerPhrase) return Response.json({ error: "Trigger phrase is required." }, { status: 400 });

    const database = getDatabase();
    const skill = createComputerSkill(database, {
      name,
      triggerPhrase,
      description: body.description || "",
      category: body.category || "custom",
      parameters: body.parameters || [],
      steps: body.steps || [],
      rawDemonstration: body.rawDemonstration,
    });

    return Response.json({ ok: true, skill }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create computer skill." },
      { status: 500 },
    );
  }
}
