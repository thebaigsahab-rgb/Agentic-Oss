import { NextRequest, NextResponse } from "next/server";
import {
  recallMemories,
  rememberFact,
  rememberPreference,
  rememberProcedure,
  consolidateEpisodicMemories,
  type MemoryLayer,
} from "@/lib/server/kernel";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const layer = searchParams.get("layer") as MemoryLayer | undefined;
    const limit = Number(searchParams.get("limit") || 15);

    const memories = recallMemories(q, { layer, limit });
    return NextResponse.json({ memories });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, title, content, tags, layer, importance, preferenceKey, preferenceValue } = body;

    if (action === "consolidate") {
      const result = consolidateEpisodicMemories();
      return NextResponse.json({ success: true, ...result });
    }

    if (preferenceKey && preferenceValue) {
      const mem = rememberPreference(preferenceKey, preferenceValue);
      return NextResponse.json({ success: true, memory: mem });
    }

    if (!title || !content) {
      return NextResponse.json({ error: "Missing required 'title' or 'content'" }, { status: 400 });
    }

    let mem;
    if (layer === "procedural") {
      mem = rememberProcedure(title, content);
    } else {
      mem = rememberFact(
        title,
        content,
        Array.isArray(tags) ? tags : [],
        (layer as MemoryLayer) || "semantic",
        Number(importance || 0.7),
      );
    }

    return NextResponse.json({ success: true, memory: mem });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
