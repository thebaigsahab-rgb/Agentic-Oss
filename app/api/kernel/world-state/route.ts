import { NextRequest, NextResponse } from "next/server";
import {
  queryWorldStateFacts,
  refreshWorkstationDigitalTwin,
} from "@/lib/server/kernel";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || undefined;
    const facts = queryWorldStateFacts(category);
    return NextResponse.json({ facts });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const digitalTwin = await refreshWorkstationDigitalTwin();
    const facts = queryWorldStateFacts();
    return NextResponse.json({
      success: true,
      digitalTwin,
      facts,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
