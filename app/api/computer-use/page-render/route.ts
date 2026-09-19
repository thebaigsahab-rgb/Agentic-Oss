import { fetchAndPerceiveScreen } from "@/lib/server/computer-use-engine";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl || !targetUrl.trim()) {
      return Response.json({ error: "Query parameter 'url' is required." }, { status: 400 });
    }

    const screen = await fetchAndPerceiveScreen(targetUrl.trim());
    return Response.json({ ok: true, screen });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to perceive target web page." },
      { status: 500 },
    );
  }
}
