import { NextRequest, NextResponse } from "next/server";
import {
  classifyToolRisk,
  enforceCapabilityPolicy,
  TOOL_RISK_MAP,
  getCollaborationMode,
} from "@/lib/server/kernel";

export async function GET() {
  try {
    const currentMode = getCollaborationMode();
    return NextResponse.json({
      collaborationMode: currentMode,
      toolRiskMatrix: TOOL_RISK_MAP,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { missionId, toolName, mode } = body;

    if (!toolName) {
      return NextResponse.json({ error: "Missing required 'toolName'" }, { status: 400 });
    }

    const effectiveMode = mode || getCollaborationMode();
    const evaluation = enforceCapabilityPolicy(
      missionId || "adhoc_session",
      toolName,
      effectiveMode,
    );

    return NextResponse.json({
      toolName,
      riskLevel: classifyToolRisk(toolName),
      evaluation,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
