import { NextRequest, NextResponse } from "next/server";
import {
  routeModelForRole,
  checkComputeThrottling,
  MODEL_REGISTRY,
  type ModelRole,
} from "@/lib/server/kernel";

export async function GET() {
  try {
    const defaultRoute = await routeModelForRole("planner");
    return NextResponse.json({
      modelRegistry: MODEL_REGISTRY,
      defaultRoute,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { role, requiresVision, requiresCloud, cpuPercent, memoryUsedMb } = body;

    const route = await routeModelForRole((role as ModelRole) || "executor", {
      requiresVision: Boolean(requiresVision),
      requiresCloud: Boolean(requiresCloud),
    });

    const throttleStatus = checkComputeThrottling(
      Number(cpuPercent || 15),
      Number(memoryUsedMb || 2048),
    );

    return NextResponse.json({
      success: true,
      route,
      throttleStatus,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
