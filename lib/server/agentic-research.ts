import "server-only";

import { randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { AcademicPaper, AgenticJob, ResearchDossier } from "@/lib/agentic-store";
import { createAgenticJob, getAgenticJob, updateAgenticJob } from "@/lib/agentic-store";
import { getDatabase } from "@/lib/server/database";
import { readSettings } from "@/lib/server/settings";
import { runConfiguredAi } from "@/lib/server/ai";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

function cleanString(str?: unknown): string {
  if (typeof str !== "string") return "";
  return str.replace(/\s+/g, " ").trim();
}

export async function searchArxivPapers(query: string, maxResults = 6): Promise<AcademicPaper[]> {
  const sanitizedQuery = cleanString(query).replace(/[^\w\s-]/g, " ");
  if (!sanitizedQuery) return [];

  const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(sanitizedQuery)}&start=0&max_results=${Math.min(maxResults, 10)}&sortBy=relevance&sortOrder=descending`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(18_000),
      headers: { "User-Agent": "ControlCenter-Jarvis/1.0 (Research Agent)" },
    });

    if (!response.ok) {
      throw new Error(`arXiv API returned HTTP ${response.status}`);
    }

    const xmlText = await response.text();
    const parsed = xmlParser.parse(xmlText);
    const feed = parsed?.feed;
    if (!feed) return [];

    const rawEntries = feed.entry
      ? Array.isArray(feed.entry)
        ? feed.entry
        : [feed.entry]
      : [];

    type ArxivField = { name?: unknown; "#text"?: unknown };
    type ArxivLink = { "@_href"?: string; "@_title"?: string; "@_type"?: string; "@_rel"?: string };
    type ArxivEntry = {
      id?: unknown;
      title?: unknown;
      summary?: unknown;
      published?: unknown;
      author?: ArxivField | ArxivField[];
      link?: ArxivLink | ArxivLink[];
    };
      return (rawEntries as ArxivEntry[]).map((entry) => {
      const id = cleanString(entry.id);
      const title = cleanString(entry.title);
      const summary = cleanString(entry.summary);
      const published = cleanString(entry.published);

      let authors: string[] = [];
      if (entry.author) {
        if (Array.isArray(entry.author)) {
          authors = (entry.author as ArxivField[]).map((a) => cleanString(a.name || a["#text"]));
        } else {
          authors = [cleanString(entry.author.name || entry.author["#text"])];
        }
      }

      let pdfUrl: string | undefined;
      let primaryUrl = id;

      if (entry.link) {
        const links = Array.isArray(entry.link) ? entry.link : [entry.link];
        for (const link of links) {
          const href = link["@_href"];
          const titleAttr = link["@_title"];
          const typeAttr = link["@_type"];
          if (titleAttr === "pdf" || typeAttr === "application/pdf" || (href && href.includes("/pdf/"))) {
            pdfUrl = href;
          }
          if (link["@_rel"] === "alternate" && href) {
            primaryUrl = href;
          }
        }
      }

      return {
        id,
        title,
        authors: authors.filter(Boolean),
        summary,
        published: published || new Date().toISOString(),
        pdfUrl,
        url: primaryUrl || id,
      };
    });
  } catch (error) {
    console.error("Failed to fetch papers from arXiv:", error);
    return [];
  }
}

export async function synthesizeResearchDossier(
  query: string,
  papers: AcademicPaper[],
): Promise<ResearchDossier> {
  const settings = await readSettings();

  const paperSummaries = papers
    .map(
      (p, i) =>
        `[Paper ${i + 1}] "${p.title}" by ${p.authors.slice(0, 3).join(", ") || "Unknown"} (${p.published.slice(0, 10)})\nAbstract: ${p.summary.slice(0, 600)}...\nURL: ${p.url}`,
    )
    .join("\n\n");

  const prompt = `You are J.A.R.V.I.S., operational research intelligence for Control Center.
Analyze the following academic papers retrieved for the topic: "${query}".

${paperSummaries || "No direct academic papers found. Synthesize based on current scientific literature."}

Provide a structured, rigorous scientific research dossier in valid JSON only with NO markdown fences:
{
  "title": "Concise Technical Title of Research Dossier",
  "executiveSummary": "A direct, high-value 2-3 sentence overview synthesizing the breakthrough findings and current state of research.",
  "keyInsights": [
    "Insight 1: Specific technical methodology or finding",
    "Insight 2: Comparative advantage or limitation identified across papers",
    "Insight 3: Emerging consensus or breakthrough discovery"
  ],
  "recommendedActions": [
    "Action 1: Practical next step or implementation",
    "Action 2: Technical area to monitor or investigate"
  ]
}`;

  try {
    const aiResponse = await runConfiguredAi(settings, {
      prompt,
      maxOutputTokens: 2500,
    });

    const cleaned = aiResponse.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)```$/i, "$1").trim();
    const parsed = JSON.parse(cleaned);

    return {
      title: cleanString(parsed.title) || `Research: ${query}`,
      topic: query,
      executiveSummary: cleanString(parsed.executiveSummary) || "Synthesis completed.",
      keyInsights: Array.isArray(parsed.keyInsights)
        ? parsed.keyInsights.map((i: unknown) => cleanString(i)).filter(Boolean)
        : [],
      papers,
      recommendedActions: Array.isArray(parsed.recommendedActions)
        ? parsed.recommendedActions.map((a: unknown) => cleanString(a)).filter(Boolean)
        : [],
      synthesizedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Fallback if structured json parse encounters an issue
    return {
      title: `Research Analysis: ${query}`,
      topic: query,
      executiveSummary: `Analyzed ${papers.length} academic papers regarding "${query}". Key findings synthesized into reference library.`,
      keyInsights: papers.slice(0, 3).map((p) => `"${p.title}": ${p.summary.slice(0, 150)}...`),
      papers,
      recommendedActions: ["Review full paper PDF preprints", "Save key findings to workspace reminders"],
      synthesizedAt: new Date().toISOString(),
    };
  }
}

export async function runAutonomousResearchJob(jobId: string): Promise<AgenticJob> {
  const database = getDatabase();
  const job = getAgenticJob(database, jobId);
  if (!job) throw new Error(`Agentic job not found: ${jobId}`);

  updateAgenticJob(database, jobId, {
    status: "running",
    progress: "Searching academic archives and paper repositories…",
  });

  try {
    const papers = await searchArxivPapers(job.query, 6);

    updateAgenticJob(database, jobId, {
      progress: `Retrieved ${papers.length} relevant papers. Synthesizing literature review…`,
    });

    const dossier = await synthesizeResearchDossier(job.query, papers);

    const completed = updateAgenticJob(database, jobId, {
      status: "completed",
      progress: "Research synthesis complete.",
      dossier,
      completedAt: new Date().toISOString(),
    });

    return completed!;
  } catch (error) {
    const failed = updateAgenticJob(database, jobId, {
      status: "failed",
      error: error instanceof Error ? error.message : "Autonomous research execution failed.",
      completedAt: new Date().toISOString(),
    });
    return failed!;
  }
}

export function startBackgroundResearchJob(query: string, type: "paper_research" | "web_deep_dive" = "paper_research"): AgenticJob {
  const database = getDatabase();
  const jobId = `job_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const job = createAgenticJob(database, {
    id: jobId,
    type,
    query,
    status: "queued",
    progress: "Queued for autonomous background execution…",
  });

  // Launch background execution immediately without blocking the caller
  queueMicrotask(() => {
    runAutonomousResearchJob(jobId).catch((err) => {
      console.error(`Background job ${jobId} failed:`, err);
    });
  });

  return job;
}
