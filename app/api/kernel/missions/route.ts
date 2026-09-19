import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/server/database";
import {
  createMissionFromObjective,
  getExecutableTasks,
  listMissions,
  getMissionGraph,
  getMissionJournal,
} from "@/lib/server/kernel";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const missionId = searchParams.get("id");
    const db = getDatabase();

    if (missionId) {
      const mission = getMissionGraph(db, missionId);
      if (!mission) {
        return NextResponse.json({ error: "Mission not found" }, { status: 404 });
      }
      const journal = getMissionJournal(db, missionId);
      const executableTasks = getExecutableTasks(mission);
      return NextResponse.json({ mission, journal, executableTasks });
    }

    const missions = listMissions(db);
    return NextResponse.json({ missions });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { objective, collaborationMode, maxSpendUsd } = body;

    if (!objective || typeof objective !== "string") {
      return NextResponse.json({ error: "Missing required string 'objective'" }, { status: 400 });
    }

    const mission = createMissionFromObjective(objective, {
      collaborationMode,
      maxSpendUsd,
    });

    return NextResponse.json({
      success: true,
      mission,
      executableTasks: getExecutableTasks(mission),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
