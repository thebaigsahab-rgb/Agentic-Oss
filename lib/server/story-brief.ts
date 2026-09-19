import "server-only";

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { safeFetchText } from "@/lib/server/safe-fetch";
import { cleanHtmlToText } from "@/lib/server/web-analysis";
import { runConfiguredAi, parseAiJson, AiNotConfiguredError } from "@/lib/server/ai";
import { readSettings } from "@/lib/server/settings";
import { getDatabase } from "@/lib/server/database";
import type { StoryBrief } from "@/lib/types";

export type { StoryBrief };

export function initializeStoryBriefStore(database: DatabaseSync): DatabaseSync {
  database.exec(`
    CREATE TABLE IF NOT EXISTS industry_story_briefs (
      url_hash TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      key_points TEXT NOT NULL,
      official_source TEXT NOT NULL,
      read_time_minutes INTEGER,
      curation_mode TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
  `);
  return database;
}

function hashUrl(url: string): string {
  return createHash("sha256").update(url.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export function getCachedStoryBrief(database: DatabaseSync, url: string): StoryBrief | null {
  try {
    const row = database
      .prepare("SELECT * FROM industry_story_briefs WHERE url_hash = ?")
      .get(hashUrl(url)) as
      | {
          url: string;
          title: string;
          summary: string;
          key_points: string;
          official_source: string;
          read_time_minutes: number | null;
          curation_mode: string;
          generated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      url: row.url,
      finalUrl: row.url,
      title: row.title,
      summary: row.summary,
      keyPoints: JSON.parse(row.key_points) as string[],
      officialSource: row.official_source,
      readTimeMinutes: row.read_time_minutes ?? undefined,
      curationMode: row.curation_mode,
      generatedAt: row.generated_at,
      cached: true,
    };
  } catch {
    return null;
  }
}

function saveStoryBrief(database: DatabaseSync, brief: StoryBrief): void {
  try {
    database
      .prepare(
        `INSERT INTO industry_story_briefs (url_hash, url, title, summary, key_points, official_source, read_time_minutes, curation_mode, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url_hash) DO UPDATE SET
           title = excluded.title,
           summary = excluded.summary,
           key_points = excluded.key_points,
           generated_at = excluded.generated_at`,
      )
      .run(
        hashUrl(brief.url),
        brief.url,
        brief.title,
        brief.summary,
        JSON.stringify(brief.keyPoints),
        brief.officialSource,
        brief.readTimeMinutes ?? null,
        brief.curationMode,
        brief.generatedAt,
      );
  } catch {
    // Brief caching is best effort; the response is still returned.
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Deterministic offline brief: position-weighted extractive key points so the
// story detail view is fully functional without any AI provider configured.
export function extractiveBrief(title: string, text: string, description?: string): { summary: string; keyPoints: string[] } {
  const sentences = text
    .replace(/###\s*/g, "")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 45 && s.length <= 320);

  const lead = sentences.slice(0, 14);
  const scored = lead.map((sentence, index) => ({
    sentence,
    score: (index === 0 ? 3 : index < 3 ? 2 : 1) + Math.min(1, sentence.length / 220),
  }));
  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .sort((a, b) => lead.indexOf(a.sentence) - lead.indexOf(b.sentence))
    .map((s) => s.sentence);

  const summary = description || top.slice(0, 2).join(" ") || `Coverage from ${title}.`;
  const keyPoints = (top.length > 2 ? top.slice(2) : top).slice(0, 4);
  return { summary, keyPoints };
}

export async function buildStoryBrief(params: {
  url: string;
  title: string;
  summary?: string;
}): Promise<StoryBrief> {
  const { url, title } = params;
  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = `https://${targetUrl}`;

  const generatedAt = new Date().toISOString();
  const officialSource = hostOf(targetUrl);

  let finalUrl = targetUrl;
  let pageText = "";
  let description: string | undefined;

  try {
    const { text: rawHtml, finalUrl: resolved } = await safeFetchText(targetUrl, {
      timeoutMs: 12_000,
      maxBytes: 2_000_000,
    });
    finalUrl = resolved;
    const parsed = cleanHtmlToText(rawHtml);
    pageText = parsed.text;
    description = parsed.description || undefined;
  } catch {
    // Blocked or unreachable page: brief from feed evidence only.
  }

  const settings = await readSettings();
  const sourceEvidence = [
    `TITLE: ${title}`,
    params.summary ? `FEED SUMMARY: ${params.summary}` : "",
    description ? `META DESCRIPTION: ${description}` : "",
    pageText ? `ARTICLE TEXT (bounded):\n${pageText.slice(0, 6500)}` : "ARTICLE TEXT: (page not readable; use feed evidence only)",
  ]
    .filter(Boolean)
    .join("\n");

  if (settings.ai.provider !== "none") {
    try {
      const aiRes = await runConfiguredAi(settings, {
        prompt: `You are the briefing analyst of an agentic OS. Read the story evidence below and produce a briefing.

${sourceEvidence}

Respond ONLY with JSON: {"summary": "2-3 sentence grounded summary", "keyPoints": ["4 to 6 short factual key points", "..."]}
Every key point must be directly supported by the evidence. No markdown outside the JSON.`,
        maxOutputTokens: 700,
      });
      const parsed = parseAiJson<{ summary?: string; keyPoints?: string[] }>(aiRes.text);
      const brief: StoryBrief = {
        url: targetUrl,
        finalUrl,
        title,
        summary: parsed.summary || description || params.summary || title,
        keyPoints: (Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [])
          .filter((p) => typeof p === "string" && p.trim().length > 0)
          .slice(0, 6),
        officialSource,
        readTimeMinutes: pageText ? Math.max(1, Math.round(pageText.split(/\s+/).length / 220)) : undefined,
        curationMode: settings.ai.provider,
        generatedAt,
        cached: false,
      };
      if (brief.keyPoints.length === 0) {
        const fallback = extractiveBrief(title, pageText || params.summary || "", description);
        brief.keyPoints = fallback.keyPoints;
        if (!parsed.summary) brief.summary = fallback.summary;
      }
      saveStoryBrief(getDatabase(), brief);
      return brief;
    } catch (error) {
      if (!(error instanceof AiNotConfiguredError)) {
        console.warn("[StoryBrief] AI briefing failed; using extractive fallback:", (error as Error).message);
      }
    }
  }

  const fallback = extractiveBrief(title, pageText || params.summary || "", description || params.summary);
  const brief: StoryBrief = {
    url: targetUrl,
    finalUrl,
    title,
    summary: fallback.summary || params.summary || title,
    keyPoints: fallback.keyPoints.length > 0
      ? fallback.keyPoints
      : [params.summary || `Open the official source for the full update.`],
    officialSource,
    readTimeMinutes: pageText ? Math.max(1, Math.round(pageText.split(/\s+/).length / 220)) : undefined,
    curationMode: "local",
    generatedAt,
    cached: false,
  };
  saveStoryBrief(getDatabase(), brief);
  return brief;
}

