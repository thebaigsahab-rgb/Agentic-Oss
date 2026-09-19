import type { LiveStory, ReminderItem, TaskItem } from "./types";

export type JarvisMessageRole = "user" | "assistant" | "tool";

export type JarvisChatMessage = {
  id: string;
  role: JarvisMessageRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolResult?: unknown;
  timestamp: string;
};

export type JarvisActionConfirmation = {
  actionId: string;
  confirmed: boolean;
};

export type JarvisChatRequest = {
  conversationId?: string;
  messages: Array<{
    role: JarvisMessageRole;
    content: string;
    toolCallId?: string;
  }>;
  mode: "chat" | "voice";
  confirmation?: JarvisActionConfirmation;
  clientTimeZone?: string;
};

export type ToolResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  meta?: {
    source?: string;
    timestamp: string;
    truncated?: boolean;
  };
};

export type ProposedAction = {
  actionId: string;
  type: string;
  summary: string;
  details: Record<string, unknown>;
  recordIds?: Array<string | number>;
  expiresAt: number;
};

export type JarvisEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; tool: string; label: string }
  | { type: "tool_result"; tool: string; result: ToolResult }
  | { type: "confirmation_required"; actionId: string; action: ProposedAction }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done"; conversationId: string };

// Tool Argument Types
export type CreateTaskArgs = {
  title: string;
  due?: string;
  priority?: "low" | "medium" | "high" | "urgent" | string;
  notes?: string;
  recurrence?: "One-time" | "Daily" | "Weekly" | "Monthly" | string;
};

export type ListTasksArgs = {
  status?: "active" | "completed" | "all";
  search?: string;
  limit?: number;
  dateRange?: "today" | "upcoming" | "overdue" | "all";
};

export type CompleteTaskArgs = {
  taskId?: string | number;
  taskQuery?: string;
  confirmed?: boolean;
};

export type CreateReminderArgs = {
  url?: string;
  note: string;
  title?: string;
  accent?: string;
};

export type GetRemindersArgs = {
  search?: string;
  limit?: number;
};

export type GetIndustryNewsArgs = {
  topic?: string;
  limit?: number;
};

export type GetDailyBriefArgs = {
  lookbackDays?: number;
};

export type GetMentionsArgs = {
  sentiment?: string;
  search?: string;
  limit?: number;
};

export type GetAudienceStatsArgs = {
  platform?: string;
  timeRange?: string;
};

export type OpenUrlArgs = {
  url?: string;
  destination?: string;
  searchQuery?: string;
  label?: string;
  openOnDevice?: boolean;
};

export type TeachTaskArgs = {
  name: string;
  triggerPhrase: string;
  description?: string;
  steps: Array<{
    id?: string;
    instruction: string;
    tool?: string;
    args?: Record<string, unknown>;
  }>;
};

export type RunTaughtTaskArgs = {
  taskId?: string;
  taskName?: string;
  triggerPhrase?: string;
};

export type ListTaughtTasksArgs = {
  limit?: number;
};

export type AnalyzeWebPageArgs = {
  url: string;
  instruction?: string;
  extractQuestions?: string[];
};

export type TaughtTaskSchedule = {
  type: "manual" | "one_time" | "recurring";
  scheduledTime?: string;
  inMinutes?: number;
  intervalMinutes?: number;
};

export type ScheduleTaughtTaskArgs = {
  taskId?: string;
  taskName?: string;
  triggerPhrase?: string;
  schedule: TaughtTaskSchedule;
};

export type StartComputerMissionArgs = {
  goal: string;
  mode?: "away" | "interactive";
  userAway?: boolean;
};

export type RunComputerSkillArgs = {
  skillName?: string;
  skillId?: string;
  triggerPhrase?: string;
  parameters?: Record<string, string | number | boolean>;
};

export type TeachComputerSkillArgs = {
  name: string;
  triggerPhrase: string;
  description?: string;
  steps: Array<{
    id?: string;
    action: string;
    description: string;
    value?: string;
    target?: Record<string, unknown>;
  }>;
};

export type GetComputerStatusArgs = {
  limit?: number;
};

// --- Device bridge tools (real system actuation) ---

export type PlayMediaArgs = {
  query: string;
  kind?: "song" | "video" | "playlist" | string;
};

export type ControlMediaArgs = {
  action: "play" | "pause" | "toggle" | "next" | "previous" | "stop" | string;
};

export type ControlVolumeArgs = {
  action: "get" | "set" | "increase" | "decrease" | "mute" | "unmute" | string;
  level?: number;
  step?: number;
};

export type TakeScreenshotArgs = {
  label?: string;
};

export type SavePagePdfArgs = {
  url: string;
  name?: string;
};

export type GetSystemStatusArgs = {
  detail?: "full" | "compact";
};

export type ListWindowsArgs = {
  limit?: number;
};

export type ResearchPapersArgs = {
  query: string;
  limit?: number;
};

export type StartBackgroundJobArgs = {
  query: string;
  type?: "paper_research" | "web_deep_dive";
};

export type GetBackgroundJobsArgs = {
  limit?: number;
};

export type TaughtTaskRun = {
  id: string;
  taskId: string;
  taskName: string;
  triggeredBy: "user" | "scheduler" | "voice";
  status: "completed" | "failed";
  stepResults: Array<{ stepIndex: number; instruction: string; result: unknown; success: boolean }>;
  summary?: string;
  executedAt: string;
  durationMs?: number;
};

export type JarvisUiState =
  | "idle"
  | "sending"
  | "streaming"
  | "awaiting_confirmation"
  | "listening"
  | "transcribing"
  | "speaking"
  | "error";

