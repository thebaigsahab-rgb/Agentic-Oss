import "server-only";

import { randomUUID } from "node:crypto";
import type { ReminderItem, TaskItem, WorkspaceState, LiveFeedResponse, NewsletterFeedResponse } from "@/lib/types";
import type {
  CompleteTaskArgs,
  CreateReminderArgs,
  CreateTaskArgs,
  GetAudienceStatsArgs,
  GetDailyBriefArgs,
  GetIndustryNewsArgs,
  GetMentionsArgs,
  GetRemindersArgs,
  ListTasksArgs,
  ProposedAction,
  ToolResult,
} from "@/lib/jarvis-types";
import { getDatabase } from "@/lib/server/database";
import { readWorkspaceState, writeWorkspaceState } from "@/lib/workspace-store";
import { cleanTaskItems, completeTaskItems } from "@/lib/tasks";
import { readSettings } from "@/lib/server/settings";
import { readCollectorSnapshot } from "@/lib/collector-cache";
import { industryCacheScope, mentionsCacheScope } from "@/lib/collector-scopes";
import { newsletterCollectionScope } from "@/lib/server/newsletter-collector";
import { buildDailyBriefSnapshot } from "@/lib/daily-brief-snapshot";
import { listBriefItems } from "@/lib/brief-store";
import { readAudienceHistory, collectAudience } from "@/lib/server/audience";
import { audienceComparisonLabel } from "@/lib/audience-growth";
import { searchArxivPapers, synthesizeResearchDossier, startBackgroundResearchJob } from "@/lib/server/agentic-research";
import {
  listAgenticJobs,
  createTaughtTask,
  getTaughtTask,
  findTaughtTaskByTrigger,
  listTaughtTasks,
  recordTaughtTaskRun,
  scheduleTaughtTask,
  recordTaskRunLog,
  listTaskRunLogs,
  type AgenticJob,
  type ResearchDossier,
  type TaughtTask,
  type TaughtTaskStep,
  type TaughtTaskRunRecord,
} from "@/lib/agentic-store";
import { analyzeWebPage, type WebPageAnalysisResult } from "@/lib/server/web-analysis";
import type {
  OpenUrlArgs,
  TeachTaskArgs,
  RunTaughtTaskArgs,
  ListTaughtTasksArgs,
  AnalyzeWebPageArgs,
  ScheduleTaughtTaskArgs,
  StartComputerMissionArgs,
  RunComputerSkillArgs,
  TeachComputerSkillArgs,
  GetComputerStatusArgs,
} from "@/lib/jarvis-types";
import { startAutonomousMission } from "@/lib/server/mission-orchestrator";
import {
  findComputerSkillByTrigger,
  getComputerSkill,
  createComputerSkill,
  getActiveAutonomousMission,
  listComputerSkills,
  listAutonomousMissions,
} from "@/lib/server/computer-skills-store";
import { executeAction } from "@/lib/server/computer-use-engine";
import type {
  AutonomousMission,
  ComputerActionStep,
  ComputerActionType,
  ComputerSkill,
  ActionExecutionResult,
} from "@/lib/computer-use-types";

// In-memory registry for pending actions awaiting user confirmation (TTL: 10 mins)
const pendingActionStore = new Map<string, ProposedAction>();

function prunePendingActions() {
  const now = Date.now();
  for (const [id, action] of pendingActionStore.entries()) {
    if (action.expiresAt < now) pendingActionStore.delete(id);
  }
}

export function registerProposedAction(action: Omit<ProposedAction, "actionId" | "expiresAt">): ProposedAction {
  prunePendingActions();
  const actionId = `act_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const proposed: ProposedAction = {
    ...action,
    actionId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  pendingActionStore.set(actionId, proposed);
  return proposed;
}

export function getProposedAction(actionId: string): ProposedAction | undefined {
  prunePendingActions();
  return pendingActionStore.get(actionId);
}

export function consumeProposedAction(actionId: string): ProposedAction | undefined {
  prunePendingActions();
  const action = pendingActionStore.get(actionId);
  if (action) pendingActionStore.delete(actionId);
  return action;
}

export function resolveRelativeDate(input?: string, timeZone = "UTC"): string {
  if (!input || !input.trim()) {
    return formatDateInTimeZone(new Date(), timeZone);
  }
  const raw = input.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;

  if (raw === "today") {
    return formatDateInTimeZone(now, timeZone);
  }
  if (raw === "tomorrow") {
    return formatDateInTimeZone(new Date(now.getTime() + dayMs), timeZone);
  }
  if (raw === "yesterday") {
    return formatDateInTimeZone(new Date(now.getTime() - dayMs), timeZone);
  }

  const inDaysMatch = raw.match(/^in\s+(\d+)\s+days?$/);
  if (inDaysMatch) {
    const count = parseInt(inDaysMatch[1], 10);
    return formatDateInTimeZone(new Date(now.getTime() + count * dayMs), timeZone);
  }

  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const targetDay = weekdays.findIndex((day) => raw.includes(day));
  if (targetDay !== -1) {
    const currentDay = now.getUTCDay();
    let diff = targetDay - currentDay;
    if (diff <= 0 || raw.includes("next")) diff += 7;
    return formatDateInTimeZone(new Date(now.getTime() + diff * dayMs), timeZone);
  }

  const parsed = Date.parse(input);
  if (!Number.isNaN(parsed)) {
    return formatDateInTimeZone(new Date(parsed), timeZone);
  }

  return formatDateInTimeZone(now, timeZone);
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

// Tool 1: create_task
export async function executeCreateTask(args: CreateTaskArgs, timeZone = "UTC"): Promise<ToolResult<TaskItem>> {
  if (!args.title || !args.title.trim()) {
    return {
      ok: false,
      error: { code: "MISSING_TITLE", message: "Task title is required.", retryable: false },
    };
  }

  const database = getDatabase();
  const state = readWorkspaceState(database);
  const normalizedDue = resolveRelativeDate(args.due, timeZone);
  const newTask: TaskItem = {
    id: randomUUID(),
    title: args.title.trim(),
    description: (args.notes || "").trim(),
    due: normalizedDue,
    recurrence: args.recurrence || "One-time",
    priority: args.priority || "medium",
    done: false,
    createdAt: new Date().toISOString(),
  };

  const updatedTasks = cleanTaskItems([...state.tasks, newTask]);
  writeWorkspaceState(database, { ...state, tasks: updatedTasks });

  return {
    ok: true,
    data: newTask,
    meta: { source: "workspace_state", timestamp: new Date().toISOString() },
  };
}

// Tool 2: list_tasks
export async function executeListTasks(args: ListTasksArgs = {}, timeZone = "UTC"): Promise<ToolResult<{ tasks: TaskItem[]; totalCount: number; truncated: boolean }>> {
  const database = getDatabase();
  const state = readWorkspaceState(database);
  const today = formatDateInTimeZone(new Date(), timeZone);
  const limit = Math.min(Math.max(1, args.limit || 20), 50);

  let filtered = state.tasks;

  if (args.status === "active") {
    filtered = filtered.filter((t) => !t.done);
  } else if (args.status === "completed") {
    filtered = filtered.filter((t) => t.done);
  }

  if (args.dateRange === "today") {
    filtered = filtered.filter((t) => t.due === today);
  } else if (args.dateRange === "upcoming") {
    filtered = filtered.filter((t) => t.due > today);
  } else if (args.dateRange === "overdue") {
    filtered = filtered.filter((t) => !t.done && t.due < today);
  }

  if (args.search && args.search.trim()) {
    const q = args.search.toLowerCase().trim();
    filtered = filtered.filter((t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  }

  filtered.sort((a, b) => a.due.localeCompare(b.due));

  const totalCount = filtered.length;
  const sliced = filtered.slice(0, limit);

  return {
    ok: true,
    data: {
      tasks: sliced,
      totalCount,
      truncated: totalCount > limit,
    },
    meta: { source: "workspace_state", timestamp: new Date().toISOString(), truncated: totalCount > limit },
  };
}

// Tool 3: complete_task
export async function executeCompleteTask(args: CompleteTaskArgs): Promise<ToolResult<{ completedTask?: TaskItem; candidates?: TaskItem[]; requiresConfirmation?: boolean; actionId?: string }>> {
  const database = getDatabase();
  const state = readWorkspaceState(database);
  const activeTasks = state.tasks.filter((t) => !t.done);

  let matched: TaskItem[] = [];

  if (args.taskId !== undefined && args.taskId !== "") {
    matched = activeTasks.filter((t) => String(t.id) === String(args.taskId));
  } else if (args.taskQuery && args.taskQuery.trim()) {
    const q = args.taskQuery.toLowerCase().trim();
    matched = activeTasks.filter((t) => t.title.toLowerCase().includes(q));
  }

  if (matched.length === 0) {
    return {
      ok: false,
      error: { code: "TASK_NOT_FOUND", message: `No active task found matching '${args.taskId || args.taskQuery}'.`, retryable: false },
    };
  }

  if (matched.length > 1) {
    return {
      ok: true,
      data: {
        candidates: matched,
      },
      error: {
        code: "MULTIPLE_MATCHES",
        message: `Found ${matched.length} tasks matching '${args.taskQuery}'. Please specify the exact task ID.`,
        retryable: false,
      },
    };
  }

  const target = matched[0];
  const updatedTasks = completeTaskItems(state.tasks, target.id);
  writeWorkspaceState(database, { ...state, tasks: updatedTasks });

  const completed = updatedTasks.find((t) => String(t.id) === String(target.id) || t.seriesId === target.id);

  return {
    ok: true,
    data: {
      completedTask: completed || { ...target, done: true },
    },
    meta: { source: "workspace_state", timestamp: new Date().toISOString() },
  };
}

// Tool 4: create_reminder
export async function executeCreateReminder(args: CreateReminderArgs): Promise<ToolResult<ReminderItem>> {
  if (!args.note && !args.title) {
    return {
      ok: false,
      error: { code: "MISSING_NOTE", message: "Reminder note or title is required.", retryable: false },
    };
  }

  let cleanUrlVal: string | undefined;
  if (args.url && args.url.trim()) {
    try {
      const parsed = new URL(args.url.trim());
      if (["http:", "https:"].includes(parsed.protocol)) {
        cleanUrlVal = parsed.toString();
      }
    } catch {
      return {
        ok: false,
        error: { code: "INVALID_URL", message: "Please provide a valid HTTP or HTTPS URL.", retryable: false },
      };
    }
  }

  const title = (args.title || args.note).trim().slice(0, 300);
  const note = (args.note || "").trim().slice(0, 1000);
  const database = getDatabase();
  const state = readWorkspaceState(database);

  const newReminder: ReminderItem = {
    id: randomUUID(),
    type: cleanUrlVal ? "Link" : "Saved",
    title,
    note: note || title,
    source: "J.A.R.V.I.S.",
    accent: args.accent || (cleanUrlVal ? "blue" : "teal"),
    url: cleanUrlVal,
    createdAt: new Date().toISOString(),
    added: "Just now",
  };

  const updatedReminders = [newReminder, ...state.reminders].slice(0, 500);
  writeWorkspaceState(database, { ...state, reminders: updatedReminders });

  return {
    ok: true,
    data: newReminder,
    meta: { source: "workspace_state", timestamp: new Date().toISOString() },
  };
}

// Tool 5: get_reminders
export async function executeGetReminders(args: GetRemindersArgs = {}): Promise<ToolResult<{ reminders: ReminderItem[]; total: number }>> {
  const database = getDatabase();
  const state = readWorkspaceState(database);
  const limit = Math.min(Math.max(1, args.limit || 20), 50);

  let reminders = state.reminders;
  if (args.search && args.search.trim()) {
    const q = args.search.toLowerCase().trim();
    reminders = reminders.filter((r) => r.title.toLowerCase().includes(q) || r.note.toLowerCase().includes(q) || (r.url && r.url.toLowerCase().includes(q)));
  }

  return {
    ok: true,
    data: {
      reminders: reminders.slice(0, limit),
      total: reminders.length,
    },
    meta: { source: "workspace_state", timestamp: new Date().toISOString() },
  };
}

// Tool 6: get_industry_news
export async function executeGetIndustryNews(args: GetIndustryNewsArgs = {}): Promise<ToolResult<{ stories: Array<{ title: string; source: string; summary: string; url: string; publishedAt: string }>; topic?: string; checkedAt: string }>> {
  const database = getDatabase();
  const settings = await readSettings();
  const scope = industryCacheScope(settings);
  const snapshot = readCollectorSnapshot<LiveFeedResponse>(database, "industry", scope);
  const limit = Math.min(Math.max(1, args.limit || 10), 30);

  const items = snapshot?.payload?.items || [];
  let filtered = items;
  if (args.topic && args.topic.trim()) {
    const t = args.topic.toLowerCase().trim();
    filtered = filtered.filter((item) => (item.matchedTerm && item.matchedTerm.toLowerCase().includes(t)) || item.title.toLowerCase().includes(t) || item.summary.toLowerCase().includes(t));
  }

  const stories = filtered.slice(0, limit).map((item) => ({
    title: item.title,
    source: item.source,
    summary: item.aiSummary || item.summary || "",
    url: item.url,
    publishedAt: item.publishedAt,
  }));

  return {
    ok: true,
    data: {
      stories,
      topic: args.topic,
      checkedAt: snapshot?.payload?.checkedAt || new Date().toISOString(),
    },
    meta: { source: "collector_cache:industry", timestamp: new Date().toISOString() },
  };
}

// Tool 7: get_daily_brief
export async function executeGetDailyBrief(args: GetDailyBriefArgs = {}): Promise<ToolResult<{
  sections: Array<{ category: string; title: string; items: Array<{ title: string; summary: string; source: string; url?: string }> }>;
  connectorItems: Array<{ id: string; title: string; summary: string; source: string; kind: string }>;
  lookbackDays: number;
}>> {
  const database = getDatabase();
  const settings = await readSettings();
  const lookbackDays = args.lookbackDays || settings.dailyBrief.lookbackDays || 7;
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();

  const industrySnap = readCollectorSnapshot<LiveFeedResponse>(database, "industry", industryCacheScope(settings))?.payload;
  const mentionsSnap = readCollectorSnapshot<LiveFeedResponse>(database, "mentions", mentionsCacheScope(settings))?.payload;
  const newslettersSnap = readCollectorSnapshot<NewsletterFeedResponse>(database, "newsletters", newsletterCollectionScope(settings))?.payload;

  const snapshotSections = buildDailyBriefSnapshot(settings.dailyBrief.sections, {
    industry: industrySnap,
    mentions: mentionsSnap,
    newsletters: newslettersSnap,
  });

  const connectorItems = listBriefItems(database, since, 20, settings.dailyBrief.sourceLabels).map((i) => ({
    id: i.id,
    title: i.title,
    summary: i.summary,
    source: i.source,
    kind: i.kind,
  }));

  const sections = snapshotSections.map((sec) => ({
    category: sec.category,
    title: sec.category,
    items: (sec.items || []).slice(0, 5).map((item) => ({
      title: item.title,
      summary: item.summary || "",
      source: item.source,
      url: item.url,
    })),
  }));

  return {
    ok: true,
    data: {
      sections,
      connectorItems,
      lookbackDays,
    },
    meta: { source: "daily_brief", timestamp: new Date().toISOString() },
  };
}

// Tool 8: get_mentions
export async function executeGetMentions(args: GetMentionsArgs = {}): Promise<ToolResult<{
  mentions: Array<{ id: string; title: string; source: string; summary: string; url: string; publishedAt: string; matchedTerm?: string; confidence?: string }>;
  total: number;
}>> {
  const database = getDatabase();
  const settings = await readSettings();
  const scope = mentionsCacheScope(settings);
  const snapshot = readCollectorSnapshot<LiveFeedResponse>(database, "mentions", scope);
  const limit = Math.min(Math.max(1, args.limit || 15), 50);

  const items = snapshot?.payload?.items || [];
  let filtered = items;
  if (args.search && args.search.trim()) {
    const q = args.search.toLowerCase().trim();
    filtered = filtered.filter((m) => m.title.toLowerCase().includes(q) || m.summary.toLowerCase().includes(q) || (m.matchedTerm && m.matchedTerm.toLowerCase().includes(q)));
  }

  const mentions = filtered.slice(0, limit).map((m) => ({
    id: m.id,
    title: m.title,
    source: m.source,
    summary: m.aiSummary || m.summary || "",
    url: m.url,
    publishedAt: m.publishedAt,
    matchedTerm: m.matchedTerm,
    confidence: m.confidence,
  }));

  return {
    ok: true,
    data: {
      mentions,
      total: items.length,
    },
    meta: { source: "collector_cache:mentions", timestamp: new Date().toISOString() },
  };
}

// Tool 9: get_audience_stats
export async function executeGetAudienceStats(args: GetAudienceStatsArgs = {}): Promise<ToolResult<{
  accounts: Array<{
    platform: string;
    label: string;
    username: string;
    currentTotal: number;
    metric: string;
    growthLabel: string;
    freshness: string;
  }>;
  totalFollowers: number;
  trackedAccountsCount: number;
}>> {
  const settings = await readSettings();
  if (!settings.audience.accounts.length) {
    return {
      ok: true,
      data: {
        accounts: [],
        totalFollowers: 0,
        trackedAccountsCount: 0,
      },
      meta: { source: "audience", timestamp: new Date().toISOString() },
    };
  }

  const liveItems = await collectAudience(settings, { forceRefresh: false });
  const history = await readAudienceHistory(settings);

  let totalFollowers = 0;
  const accounts = liveItems.map((item) => {
    const total = item.total ?? 0;
    totalFollowers += total;
    const accountHistory = Array.isArray(history) ? history.find((h) => h.id === item.id) : undefined;
    let growthLabel = "Recent snapshot";
    if (accountHistory && accountHistory.samples && accountHistory.samples.length > 1) {
      const prior = accountHistory.samples[1];
      const diff = total - prior.total;
      const pct = prior.total > 0 ? ((diff / prior.total) * 100).toFixed(1) : undefined;
      growthLabel = `${diff >= 0 ? "+" : ""}${diff.toLocaleString()} (${pct ? `${pct}%` : "no prior base"})`;
    }

    return {
      platform: item.platform,
      label: item.label,
      username: item.handle,
      currentTotal: total,
      metric: item.primaryLabel || "followers",
      growthLabel,
      freshness: item.changeComparedAt || new Date().toISOString(),
    };
  });

  return {
    ok: true,
    data: {
      accounts,
      totalFollowers,
      trackedAccountsCount: accounts.length,
    },
    meta: { source: "audience", timestamp: new Date().toISOString() },
  };
}

// Tool 10: research_papers
export async function executeResearchPapers(args: { query: string; limit?: number }): Promise<ToolResult<{ dossier: ResearchDossier; papersCount: number }>> {
  if (!args.query || !args.query.trim()) {
    return {
      ok: false,
      error: { code: "MISSING_QUERY", message: "Research query or topic is required.", retryable: false },
    };
  }

  const papers = await searchArxivPapers(args.query, args.limit || 6);
  const dossier = await synthesizeResearchDossier(args.query, papers);

  return {
    ok: true,
    data: { dossier, papersCount: papers.length },
    meta: { source: "arxiv_research", timestamp: new Date().toISOString() },
  };
}

// Tool 11: start_background_job
export async function executeStartBackgroundJob(args: { query: string; type?: "paper_research" | "web_deep_dive" }): Promise<ToolResult<AgenticJob>> {
  if (!args.query || !args.query.trim()) {
    return {
      ok: false,
      error: { code: "MISSING_QUERY", message: "Research topic or job instruction is required.", retryable: false },
    };
  }

  const job = startBackgroundResearchJob(args.query, args.type || "paper_research");

  return {
    ok: true,
    data: job,
    meta: { source: "agentic_jobs", timestamp: new Date().toISOString() },
  };
}

// Tool 12: get_background_jobs
export async function executeGetBackgroundJobs(args: { limit?: number } = {}): Promise<ToolResult<{ jobs: AgenticJob[]; total: number }>> {
  const database = getDatabase();
  const jobs = listAgenticJobs(database, args.limit || 15);

  return {
    ok: true,
    data: { jobs, total: jobs.length },
    meta: { source: "agentic_jobs", timestamp: new Date().toISOString() },
  };
}

// Tool 13: open_url
export async function executeOpenUrl(args: OpenUrlArgs): Promise<ToolResult<{
  url: string;
  label: string;
  destination?: string;
  searchQuery?: string;
  autoOpen: boolean;
  openedOnDevice: boolean;
}>> {
  let targetUrl = (args.url || "").trim();
  const dest = (args.destination || "").toLowerCase().trim();
  const query = (args.searchQuery || "").trim();
  let label = (args.label || "").trim();

  if (dest === "youtube" || targetUrl.includes("youtube.com") || (!dest && !targetUrl && query)) {
    if (query) {
      targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      label = label || `YouTube: "${query}"`;
    } else {
      targetUrl = "https://www.youtube.com";
      label = label || "YouTube";
    }
  } else if (dest === "google" || targetUrl.includes("google.com")) {
    if (query) {
      targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      label = label || `Google Search: "${query}"`;
    } else {
      targetUrl = "https://www.google.com";
      label = label || "Google";
    }
  } else if (dest === "github" || targetUrl.includes("github.com")) {
    if (query) {
      targetUrl = `https://github.com/search?q=${encodeURIComponent(query)}`;
      label = label || `GitHub: "${query}"`;
    } else {
      targetUrl = "https://github.com";
      label = label || "GitHub";
    }
  } else if (dest === "arxiv" || targetUrl.includes("arxiv.org")) {
    if (query) {
      targetUrl = `https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all`;
      label = label || `arXiv: "${query}"`;
    } else {
      targetUrl = "https://arxiv.org";
      label = label || "arXiv";
    }
  } else if (dest === "twitter" || dest === "x" || targetUrl.includes("x.com") || targetUrl.includes("twitter.com")) {
    if (query) {
      targetUrl = `https://x.com/search?q=${encodeURIComponent(query)}`;
      label = label || `X / Twitter: "${query}"`;
    } else {
      targetUrl = "https://x.com";
      label = label || "X / Twitter";
    }
  } else if (dest === "reddit" || targetUrl.includes("reddit.com")) {
    if (query) {
      targetUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`;
      label = label || `Reddit: "${query}"`;
    } else {
      targetUrl = "https://www.reddit.com";
      label = label || "Reddit";
    }
  } else if (targetUrl) {
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    }
    label = label || targetUrl;
  } else {
    return {
      ok: false,
      error: { code: "INVALID_URL", message: "Please specify a URL, destination, or search query.", retryable: false },
    };
  }

  // The agent now acts on the real device first: the OS default browser opens
  // the tab server-side (no popup blocker, works from voice). The dashboard
  // client only falls back to window.open when device opening failed.
  let openedOnDevice = false;
  if (args.openOnDevice !== false) {
    try {
      const { openUrlInDefaultBrowser } = await import("@/lib/server/system-bridge");
      await openUrlInDefaultBrowser(targetUrl);
      openedOnDevice = true;
    } catch {
      openedOnDevice = false;
    }
  }

  return {
    ok: true,
    data: {
      url: targetUrl,
      label,
      destination: dest || undefined,
      searchQuery: query || undefined,
      autoOpen: !openedOnDevice,
      openedOnDevice,
    },
    meta: { source: "browser_action", timestamp: new Date().toISOString() },
  };
}

// Tool 14: teach_task
export async function executeTeachTask(args: TeachTaskArgs): Promise<ToolResult<{ task: TaughtTask }>> {
  if (!args.name || !args.name.trim()) {
    return {
      ok: false,
      error: { code: "MISSING_NAME", message: "Task name is required.", retryable: false },
    };
  }
  if (!args.triggerPhrase || !args.triggerPhrase.trim()) {
    return {
      ok: false,
      error: { code: "MISSING_TRIGGER", message: "Trigger phrase is required (e.g. 'morning routine').", retryable: false },
    };
  }

  const steps: TaughtTaskStep[] = (args.steps || []).map((s, i) => ({
    id: s.id || `step_${i + 1}_${randomUUID().slice(0, 6)}`,
    instruction: (s.instruction || "").trim(),
    tool: s.tool || undefined,
    args: s.args || undefined,
  })).filter((s) => s.instruction.length > 0 || Boolean(s.tool));

  if (steps.length === 0) {
    return {
      ok: false,
      error: { code: "EMPTY_STEPS", message: "At least one instruction step is required.", retryable: false },
    };
  }

  const database = getDatabase();
  const id = `tt_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

  const task = createTaughtTask(database, {
    id,
    name: args.name.trim(),
    triggerPhrase: args.triggerPhrase.trim(),
    description: args.description?.trim(),
    steps,
  });

  return {
    ok: true,
    data: { task },
    meta: { source: "taught_tasks", timestamp: new Date().toISOString() },
  };
}

// Tool 15: list_taught_tasks
export async function executeListTaughtTasks(args: ListTaughtTasksArgs = {}): Promise<ToolResult<{ tasks: TaughtTask[]; total: number }>> {
  const database = getDatabase();
  const tasks = listTaughtTasks(database, args.limit || 50);

  return {
    ok: true,
    data: { tasks, total: tasks.length },
    meta: { source: "taught_tasks", timestamp: new Date().toISOString() },
  };
}

// Tool 16: run_taught_task
export async function executeRunTaughtTask(
  args: RunTaughtTaskArgs,
  clientTimeZone = "UTC",
  triggeredBy: "user" | "scheduler" | "voice" = "user",
): Promise<ToolResult<{
  task: TaughtTask;
  stepResults: Array<{ stepIndex: number; instruction: string; result: unknown; success: boolean }>;
  completedSteps: number;
}>> {
  const startTime = Date.now();
  const database = getDatabase();
  let task: TaughtTask | null = null;

  if (args.taskId) {
    task = getTaughtTask(database, args.taskId);
  }
  if (!task && (args.triggerPhrase || args.taskName)) {
    task = findTaughtTaskByTrigger(database, (args.triggerPhrase || args.taskName)!);
  }

  if (!task) {
    return {
      ok: false,
      error: { code: "TASK_NOT_FOUND", message: `Taught task '${args.taskId || args.taskName || args.triggerPhrase}' was not found.`, retryable: false },
    };
  }

  const stepResults: Array<{ stepIndex: number; instruction: string; result: unknown; success: boolean }> = [];

  for (let i = 0; i < task.steps.length; i++) {
    const step = task.steps[i];
    const instruction = step.instruction;
    const tool = step.tool?.toLowerCase();
    let res: ToolResult;

    try {
      if (tool === "create_task" || instruction.toLowerCase().startsWith("add task") || instruction.toLowerCase().startsWith("create task")) {
        const title = (step.args?.title as string) || instruction.replace(/^(add|create)\s+task:?\s*/i, "");
        res = await executeCreateTask({ title, ...(step.args || {}) }, clientTimeZone);
      } else if (tool === "list_tasks" || instruction.toLowerCase().includes("list tasks") || instruction.toLowerCase().includes("check tasks")) {
        res = await executeListTasks(step.args || {}, clientTimeZone);
      } else if (tool === "complete_task" || instruction.toLowerCase().startsWith("complete task")) {
        res = await executeCompleteTask(step.args || { taskQuery: instruction.replace(/^complete\s+task:?\s*/i, "") });
      } else if (tool === "create_reminder" || instruction.toLowerCase().startsWith("save reminder") || instruction.toLowerCase().startsWith("remind")) {
        const note = (step.args?.note as string) || instruction;
        res = await executeCreateReminder({ note, ...(step.args || {}) });
      } else if (tool === "get_reminders" || instruction.toLowerCase().includes("reminders")) {
        res = await executeGetReminders(step.args || {});
      } else if (tool === "analyze_web_page" || (instruction.toLowerCase().includes("analyze") && (instruction.includes("http://") || instruction.includes("https://")))) {
        const urlMatch = instruction.match(/https?:\/\/[^\s]+/i);
        const url = (step.args?.url as string) || (urlMatch ? urlMatch[0] : "");
        const query = (step.args?.instruction as string) || instruction.replace(/.*analyze\s+(?:webpage\s+|url\s+)?https?:\/\/[^\s]*/i, "").trim();
        res = await executeAnalyzeWebPage({ url, instruction: query || undefined, ...(step.args || {}) });
      } else if (tool === "research_papers" || instruction.toLowerCase().includes("research paper")) {
        const query = (step.args?.query as string) || instruction.replace(/.*research\s+(?:papers?\s+on\s+)?/i, "").trim();
        res = await executeResearchPapers({ query: query || "agentic AI", ...(step.args || {}) });
      } else if (tool === "start_background_job" || instruction.toLowerCase().includes("background job")) {
        const query = (step.args?.query as string) || instruction.replace(/.*(?:background\s+job|autonomous\s+research)\s+(?:on\s+)?/i, "").trim();
        res = await executeStartBackgroundJob({ query: query || "agentic AI" });
      } else if (tool === "get_background_jobs" || instruction.toLowerCase().includes("background jobs")) {
        res = await executeGetBackgroundJobs(step.args || {});
      } else if (tool === "get_industry_news" || instruction.toLowerCase().includes("industry news")) {
        res = await executeGetIndustryNews(step.args || {});
      } else if (tool === "get_daily_brief" || instruction.toLowerCase().includes("daily brief")) {
        res = await executeGetDailyBrief(step.args || {});
      } else if (tool === "get_mentions" || instruction.toLowerCase().includes("mentions")) {
        res = await executeGetMentions(step.args || {});
      } else if (tool === "get_audience_stats" || instruction.toLowerCase().includes("audience")) {
        res = await executeGetAudienceStats(step.args || {});
      } else if (tool === "open_url" || instruction.toLowerCase().startsWith("open")) {
        res = await executeOpenUrl((step.args as OpenUrlArgs) || { searchQuery: instruction.replace(/^open\s+/i, "") });
      } else {
        res = { ok: true, data: { instruction, status: "executed" } };
      }

      stepResults.push({
        stepIndex: i + 1,
        instruction,
        result: res.data || res.error,
        success: res.ok,
      });
    } catch (err) {
      stepResults.push({
        stepIndex: i + 1,
        instruction,
        result: err instanceof Error ? err.message : "Step execution failed",
        success: false,
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const completedCount = stepResults.filter((s) => s.success).length;
  const isAllSuccess = completedCount === stepResults.length;
  const summaryText = `${task.name}: ${completedCount}/${stepResults.length} steps completed`;

  recordTaughtTaskRun(database, task.id, JSON.stringify({ completedCount, total: stepResults.length }));

  recordTaskRunLog(database, {
    id: `run_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    taskId: task.id,
    taskName: task.name,
    triggeredBy,
    status: isAllSuccess ? "completed" : "failed",
    stepResults,
    summary: summaryText,
    executedAt: new Date().toISOString(),
    durationMs,
  });

  return {
    ok: true,
    data: {
      task,
      stepResults,
      completedSteps: completedCount,
    },
    meta: { source: "taught_tasks", timestamp: new Date().toISOString() },
  };
}

// Tool 17: analyze_web_page
export async function executeAnalyzeWebPage(args: AnalyzeWebPageArgs): Promise<ToolResult<WebPageAnalysisResult>> {
  if (!args.url || typeof args.url !== "string" || !args.url.trim()) {
    return {
      ok: false,
      error: { code: "INVALID_URL", message: "A valid web URL is required for deep analysis.", retryable: false },
    };
  }

  try {
    const analysis = await analyzeWebPage({
      url: args.url,
      instruction: args.instruction,
      extractQuestions: args.extractQuestions,
    });

    return {
      ok: true,
      data: analysis,
      meta: { source: "web_analyst", timestamp: new Date().toISOString() },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "ANALYSIS_FAILED",
        message: err instanceof Error ? err.message : "Failed to analyze webpage.",
        retryable: true,
      },
    };
  }
}

// Tool 18: schedule_taught_task
export async function executeScheduleTaughtTask(args: ScheduleTaughtTaskArgs): Promise<ToolResult<{ task: TaughtTask }>> {
  const database = getDatabase();
  let task: TaughtTask | null = null;

  if (args.taskId) {
    task = getTaughtTask(database, args.taskId);
  }
  if (!task && (args.triggerPhrase || args.taskName)) {
    task = findTaughtTaskByTrigger(database, (args.triggerPhrase || args.taskName)!);
  }

  if (!task) {
    return {
      ok: false,
      error: { code: "TASK_NOT_FOUND", message: `Taught task '${args.taskId || args.taskName || args.triggerPhrase}' was not found to schedule.`, retryable: false },
    };
  }

  const updated = scheduleTaughtTask(database, task.id, args.schedule);
  if (!updated) {
    return {
      ok: false,
      error: { code: "SCHEDULE_FAILED", message: "Failed to update routine schedule.", retryable: false },
    };
  }

  return {
    ok: true,
    data: { task: updated },
    meta: { source: "taught_tasks", timestamp: new Date().toISOString() },
  };
}

// Tool 19: start_computer_mission
export async function executeStartComputerMission(
  args: StartComputerMissionArgs,
): Promise<ToolResult<{ mission: AutonomousMission; message: string }>> {
  if (!args.goal || !args.goal.trim()) {
    return {
      ok: false,
      error: { code: "MISSING_GOAL", message: "Mission goal is required.", retryable: false },
    };
  }

  const database = getDatabase();
  const mission = await startAutonomousMission(database, {
    goal: args.goal.trim(),
    mode: args.mode || "away",
    userAway: args.userAway !== false,
  });

  return {
    ok: true,
    data: {
      mission,
      message: `Autonomous mission initiated. Running unattended in background with ${mission.totalSubtasks} planned subtasks while you are away.`,
    },
    meta: { source: "computer_use_engine", timestamp: new Date().toISOString() },
  };
}

// Tool 20: run_computer_skill
export async function executeRunComputerSkill(
  args: RunComputerSkillArgs,
): Promise<ToolResult<{ skill: ComputerSkill; stepResults: ActionExecutionResult[]; completedSteps: number }>> {
  const database = getDatabase();
  let skill: ComputerSkill | null = null;

  if (args.skillId) {
    skill = getComputerSkill(database, args.skillId);
  }
  if (!skill && (args.triggerPhrase || args.skillName)) {
    skill = findComputerSkillByTrigger(database, (args.triggerPhrase || args.skillName)!);
  }

  if (!skill) {
    return {
      ok: false,
      error: {
        code: "SKILL_NOT_FOUND",
        message: `Computer skill '${args.skillId || args.skillName || args.triggerPhrase}' was not found in skill vault.`,
        retryable: false,
      },
    };
  }

  const stepResults: ActionExecutionResult[] = [];
  let currentScreen = undefined;
  let cursor = { x: 500, y: 260 };
  const params = args.parameters || {};

  for (let i = 0; i < skill.steps.length; i++) {
    const step = { ...skill.steps[i] };
    if (step.value) {
      for (const [k, v] of Object.entries(params)) {
        step.value = step.value.replaceAll(`{{${k}}}`, String(v));
      }
    }

    const res = await executeAction(step, currentScreen, { cursorFrom: cursor });
    stepResults.push(res);
    if (res.cursorPosition) cursor = res.cursorPosition;
    if (res.screenState) currentScreen = res.screenState;
    if (!res.success) break;
  }

  const completedSteps = stepResults.filter((s) => s.success).length;

  return {
    ok: true,
    data: {
      skill,
      stepResults,
      completedSteps,
    },
    meta: { source: "computer_use_skills", timestamp: new Date().toISOString() },
  };
}

// Tool 21: teach_computer_skill
export async function executeTeachComputerSkill(
  args: TeachComputerSkillArgs,
): Promise<ToolResult<{ skill: ComputerSkill }>> {
  if (!args.name || !args.name.trim()) {
    return {
      ok: false,
      error: { code: "MISSING_NAME", message: "Skill name is required.", retryable: false },
    };
  }
  if (!args.triggerPhrase || !args.triggerPhrase.trim()) {
    return {
      ok: false,
      error: { code: "MISSING_TRIGGER", message: "Trigger phrase is required.", retryable: false },
    };
  }

  const database = getDatabase();
  const skill = createComputerSkill(database, {
    name: args.name.trim(),
    triggerPhrase: args.triggerPhrase.trim(),
    description: args.description || "",
    category: "custom",
    parameters: [],
    steps: (args.steps || []).map((s, i) => ({
      id: s.id || `step_${i + 1}`,
      action: (s.action as ComputerActionType) || "navigate",
      description: s.description || `Step ${i + 1}`,
      value: s.value,
      target: s.target as ComputerActionStep["target"],
    })),
  });

  return {
    ok: true,
    data: { skill },
    meta: { source: "computer_use_skills", timestamp: new Date().toISOString() },
  };
}

// Tool 22: get_computer_status
export async function executeGetComputerStatus(
  args: GetComputerStatusArgs = {},
): Promise<ToolResult<{ activeMission: AutonomousMission | null; totalSkills: number; recentMissions: AutonomousMission[] }>> {
  const database = getDatabase();
  const activeMission = getActiveAutonomousMission(database);
  const skills = listComputerSkills(database, 50);
  const recentMissions = listAutonomousMissions(database, args.limit || 5);

  return {
    ok: true,
    data: {
      activeMission,
      totalSkills: skills.length,
      recentMissions,
    },
    meta: { source: "computer_use_engine", timestamp: new Date().toISOString() },
  };
}


