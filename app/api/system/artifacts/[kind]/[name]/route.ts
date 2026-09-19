import { readArtifact } from "@/lib/server/system-bridge";
import type { ArtifactKind } from "@/lib/computer-use-types";

export const runtime = "nodejs";

const KINDS: ArtifactKind[] = ["screenshots", "pdf"];

const MIME: Record<ArtifactKind, string> = {
  screenshots: "image/png",
  pdf: "application/pdf",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; name: string }> },
) {
  const { kind, name } = await params;

  if (!KINDS.includes(kind as ArtifactKind)) {
    return Response.json({ error: "Unknown artifact vault." }, { status: 404 });
  }

  try {
    const buffer = readArtifact(kind as ArtifactKind, decodeURIComponent(name));
    const body = new Uint8Array(buffer);
    return new Response(body, {
      headers: {
        "Content-Type": MIME[kind as ArtifactKind],
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${encodeURIComponent(name)}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Artifact not found.";
    const isInvalid = message.includes("must be") || message.includes("reserved") || message.includes("plain file");
    return Response.json({ error: message }, { status: isInvalid ? 400 : 404 });
  }
}
