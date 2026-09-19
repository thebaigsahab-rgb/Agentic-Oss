import { NextResponse, type NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.error("=== CLIENT CRASH LOGGED FROM BROWSER/MOBILE ===");
    console.error("Message:", body.message);
    console.error("Stack:", body.stack);
    console.error("Digest:", body.digest);
    console.error("UserAgent:", body.userAgent);
    console.error("================================================");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
