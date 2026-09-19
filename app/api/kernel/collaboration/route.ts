import { NextRequest, NextResponse } from "next/server";
import {
  getCollaborationMode,
  setCollaborationMode,
  type CollaborationMode,
} from "@/lib/server/kernel";

export async function GET() {
  try {
    const mode = getCollaborationMode();
    return NextResponse.json({ mode });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mode, reason } = body;

    if (!mode || !["copilot", "delegated", "ghost", "lockdown"].includes(mode)) {
      return NextResponse.json(
        { error: "Invalid mode. Valid modes are: copilot, delegated, ghost, lockdown" },
        { status: 400 },
      );
    }

    const result = setCollaborationMode(mode as CollaborationMode, reason);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
