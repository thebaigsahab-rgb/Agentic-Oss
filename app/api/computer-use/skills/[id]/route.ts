import { getDatabase } from "@/lib/server/database";
import {
  getComputerSkill,
  updateComputerSkill,
  deleteComputerSkill,
} from "@/lib/server/computer-skills-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params;
    const database = getDatabase();
    const skill = getComputerSkill(database, id);
    if (!skill) {
      return Response.json({ error: "Skill not found." }, { status: 404 });
    }
    return Response.json({ ok: true, skill });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load skill." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params;
    const body = await request.json();
    const database = getDatabase();
    const updated = updateComputerSkill(database, id, body);
    if (!updated) {
      return Response.json({ error: "Skill not found to update." }, { status: 404 });
    }
    return Response.json({ ok: true, skill: updated });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update skill." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params;
    const database = getDatabase();
    const deleted = deleteComputerSkill(database, id);
    return Response.json({ ok: deleted });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete skill." },
      { status: 500 },
    );
  }
}
