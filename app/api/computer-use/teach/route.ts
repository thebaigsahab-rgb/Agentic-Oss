import { getDatabase } from "@/lib/server/database";
import { createComputerSkill } from "@/lib/server/computer-skills-store";
import { synthesizeDemonstrationToSkill } from "@/lib/server/demonstration-synthesizer";
import type { DemonstrationEvent } from "@/lib/computer-use-types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      skillName: string;
      triggerPhrase?: string;
      description?: string;
      events: DemonstrationEvent[];
    };

    if (!body.skillName || !body.skillName.trim()) {
      return Response.json({ error: "Skill name is required." }, { status: 400 });
    }
    if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
      return Response.json({ error: "At least one demonstration action is required." }, { status: 400 });
    }

    const synthesized = await synthesizeDemonstrationToSkill({
      skillName: body.skillName.trim(),
      triggerPhrase: body.triggerPhrase?.trim(),
      description: body.description?.trim(),
      events: body.events,
    });

    const database = getDatabase();
    const savedSkill = createComputerSkill(database, synthesized);

    return Response.json({ ok: true, skill: savedSkill }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to synthesize demonstration into skill." },
      { status: 500 },
    );
  }
}
