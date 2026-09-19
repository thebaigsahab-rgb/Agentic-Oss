import { NextResponse } from "next/server";
import { runSupervisorHealthProbes } from "@/lib/server/kernel";

export async function GET() {
  try {
    const health = await runSupervisorHealthProbes();
    return NextResponse.json(health);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
