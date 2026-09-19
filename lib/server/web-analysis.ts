import "server-only";

import { safeFetchText } from "@/lib/server/safe-fetch";
import { runConfiguredAi } from "@/lib/server/ai";
import { readSettings } from "@/lib/server/settings";

export type WebPageAnalysisResult = {
  url: string;
  finalUrl: string;
  pageTitle: string;
  description?: string;
  summary: string;
  keyInsights: string[];
  extractedData: Record<string, string>;
  actionableTakeaways: string[];
  analyzedAt: string;
};

export function cleanHtmlToText(html: string): { title: string; description?: string; text: string } {
  // Extract Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/&[a-z0-9#]+;/gi, " ").trim() : "Untitled Web Page";

  // Extract Meta Description
  const descMatch =
    html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i) ||
    html.match(/<meta\s+property=["']og:description["']\s+content=["']([\s\S]*?)["']/i) ||
    html.match(/<meta\s+content=["']([\s\S]*?)["']\s+name=["']description["']/i);
  const description = descMatch ? descMatch[1].replace(/&[a-z0-9#]+;/gi, " ").trim() : undefined;

  // Remove scripts, styles, svg, noscript, iframes, nav, footer
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Convert headings and paragraphs to markdown-style breaks
  cleaned = cleaned
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, "\n\n### $1\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n")
    .replace(/<br\s*\/?>/gi, "\n");

  // Remove remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // Normalize whitespace
  cleaned = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n\n");

  // Limit length to avoid blowing LLM context window
  if (cleaned.length > 8000) {
    cleaned = cleaned.slice(0, 8000) + "\n\n[Content truncated for analysis]";
  }

  return { title, description, text: cleaned };
}

export async function analyzeWebPage(params: {
  url: string;
  instruction?: string;
  extractQuestions?: string[];
}): Promise<WebPageAnalysisResult> {
  const { url, instruction } = params;

  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  const { text: rawHtml, finalUrl } = await safeFetchText(targetUrl, {
    timeoutMs: 12000,
    maxBytes: 2_000_000,
  });

  const { title, description, text: cleanedText } = cleanHtmlToText(rawHtml);

  // Use configured AI to synthesize analysis
  const settings = await readSettings();

  const prompt = `You are an expert autonomous web analyst for an operational agentic OS.
Analyze the following webpage content and extract structured intelligence.

URL: ${finalUrl}
PAGE TITLE: ${title}
${description ? `META DESCRIPTION: ${description}\n` : ""}${
    instruction ? `SPECIFIC USER INSTRUCTION/QUESTION: ${instruction}\n` : ""
  }
WEBPAGE TEXT:
${cleanedText}

Respond ONLY with a JSON object in this exact schema:
\`\`\`json
{
  "summary": "Concise 2-3 sentence executive summary of the webpage content and main thesis",
  "keyInsights": [
    "Insight or critical fact 1",
    "Insight or critical fact 2",
    "Insight or critical fact 3"
  ],
  "extractedData": {
    "key_topic": "...",
    "entity_or_organization": "...",
    "answer_to_instruction": "..."
  },
  "actionableTakeaways": [
    "Concrete takeaway or recommended action 1",
    "Concrete takeaway or recommended action 2"
  ]
}
\`\`\``;

  let summary = description || `Extracted information from ${title}.`;
  let keyInsights: string[] = [];
  let extractedData: Record<string, string> = {};
  let actionableTakeaways: string[] = [];

  try {
    const aiRes = await runConfiguredAi(settings, { prompt, maxOutputTokens: 800 });
    const match = aiRes.text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = match ? match[1].trim() : aiRes.text.trim();
    const parsed = JSON.parse(candidate);

    if (parsed.summary && typeof parsed.summary === "string") {
      summary = parsed.summary;
    }
    if (Array.isArray(parsed.keyInsights)) {
      keyInsights = parsed.keyInsights.filter((i: unknown) => typeof i === "string");
    }
    if (parsed.extractedData && typeof parsed.extractedData === "object") {
      extractedData = parsed.extractedData;
    }
    if (Array.isArray(parsed.actionableTakeaways)) {
      actionableTakeaways = parsed.actionableTakeaways.filter((t: unknown) => typeof t === "string");
    }
  } catch {
    // Fallback heuristic extraction
    const paragraphs = cleanedText.split("\n\n").filter((p) => p.length > 40);
    summary = description || paragraphs[0] || `Webpage analysis of ${title}.`;
    keyInsights = paragraphs.slice(1, 4).map((p) => (p.length > 150 ? p.slice(0, 150) + "…" : p));
    actionableTakeaways = [`Review full content at ${finalUrl}`];
  }

  return {
    url,
    finalUrl,
    pageTitle: title,
    description,
    summary,
    keyInsights: keyInsights.slice(0, 5),
    extractedData,
    actionableTakeaways: actionableTakeaways.slice(0, 4),
    analyzedAt: new Date().toISOString(),
  };
}
