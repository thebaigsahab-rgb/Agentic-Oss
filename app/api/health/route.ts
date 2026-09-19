import { readFileSync } from "node:fs";
import path from "node:path";
import { getDatabase } from "@/lib/server/database";

export const runtime = "nodejs";

// The launcher's smoke test asserts the served version matches package.json;
// reading it at runtime keeps the health report honest across releases.
function serviceVersion(): string {
  try {
    const raw = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version || "unknown";
  } catch {
    return "unknown";
  }
}

export async function GET() {
  try {
    getDatabase().prepare("SELECT 1").get();
    return Response.json({
      service: "control-center",
      status: "ready",
      version: serviceVersion(),
    });
  } catch {
    return Response.json(
      { service: "control-center", status: "unhealthy", version: serviceVersion() },
      { status: 503 },
    );
  }
}
