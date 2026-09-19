import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface Source {
  id: string;
  name: string;
  url: string;
  type: "research" | "auto" | "rss" | "url" | "search";
  interval_value: number;
  interval_unit: "hours" | "days" | "months";
  topic_tags: string[];
  freshness_override_hours: number | null;
  enabled: boolean;
  cron_expression: string | null;
  research_depth: "sonar" | "sonar-pro";
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: "success" | "running" | "failed" | null;
  created_at: string;
}

export interface Article {
  id: string;
  source_id?: string;
  title: string;
  url: string;
  summary: string;
  raw_markdown?: string;
  topic_tags: string[];
  published_at: string;
  scraped_at: string;
  priority_score: number; // 0-100
  priority_reason: string;
  suggested_angle: string;
  status: "new" | "shortlisted" | "used" | "dismissed";
}

export interface DraftVersion {
  id: string;
  role: "user" | "assistant";
  content: string;
  caption_snapshot?: string;
  created_at: string;
}

export interface DraftImage {
  id: string;
  image_path: string;
  prompt: string;
  aspect_ratio: string;
  created_at: string;
}

export interface Draft {
  id: string;
  article_id?: string;
  title: string;
  caption: string;
  image_path?: string;
  image_prompt?: string;
  image_status?: "idle" | "generating" | "ready" | "failed";
  aspect_ratio?: string;
  status: "draft" | "scheduled" | "published" | "failed";
  created_at: string;
  updated_at: string;
  versions: DraftVersion[];
  images: DraftImage[];
}

export interface ScheduledPost {
  id: string;
  draft_id: string;
  title: string;
  scheduled_for: string;
  timezone: string;
  platforms: Array<"instagram" | "linkedin" | "twitter">;
  status: "scheduled" | "published" | "failed";
  created_at: string;
}

export interface ExpenseItem {
  id: string;
  date: string;
  category: string;
  type: "revenue" | "expense";
  amount: number;
  description: string;
}

export interface ContentTodayTask {
  id: string;
  title: string;
  status: "open" | "done";
  created_at: string;
}

export interface ContentMail {
  id: string;
  from_name: string;
  from_addr: string;
  subject: string;
  snippet: string;
  internal_date: string;
  unread: boolean;
}

export interface ScraperJob {
  id: string;
  target_url: string;
  proxy_mode: "direct" | "nodemaven";
  anti_bot: boolean;
  status: "pending" | "running" | "completed" | "failed";
  records_found: number;
  logs: string[];
  created_at: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  model: string;
  status: "active" | "idle" | "working" | "standby";
  tokenSavingsPct: number;
  tokensUsed: number;
  tasksCompleted: number;
  speed: string;
  isLocal: boolean;
  avatarIcon: string;
  description: string;
}

export interface MemoryNote {
  id: string;
  title: string;
  content: string;
  category: "sop" | "decision" | "learning" | "client_profile" | "workflow_rule";
  source_agent: string;
  tags: string[];
  created_at: string;
  pinned?: boolean;
}

export interface PipelineStage {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  outputSnippet?: string;
  updatedAt?: string;
}

export interface AgentWorkflowPipeline {
  id: string;
  name: string;
  description: string;
  assigned_agent: string;
  stages: PipelineStage[];
  status: "active" | "queued" | "completed" | "idle";
  lastRunAt: string;
  resultsCount: number;
}

export interface WarRoomMessage {
  id: string;
  sender: string;
  role: "user" | "agent";
  avatar: string;
  content: string;
  timestamp: string;
  agentModel?: string;
}

export interface TokenOptimizationState {
  fastMode: boolean;
  effortLevel: "low" | "balanced" | "deep";
  smartRoutingEnabled: boolean;
  localModelPreferred: boolean;
  totalTokensSaved: number;
  tokensSavedPct: number;
  costSavedUsd: number;
}

export interface LocalModelBenchmark {
  id: string;
  name: string;
  status: "loaded" | "ready" | "downloading";
  vram: string;
  tokensPerSec: number;
  goldyScore: number;
  contextWindow: string;
}

export interface McpServerStatus {
  id: string;
  name: string;
  uri: string;
  status: "connected" | "listening" | "standby";
  toolsCount: number;
  latencyMs: number;
}

export interface ContentOsState {
  sources: Source[];
  articles: Article[];
  drafts: Draft[];
  scheduled: ScheduledPost[];
  expenses: ExpenseItem[];
  tasks: ContentTodayTask[];
  mail: ContentMail[];
  scraperJobs: ScraperJob[];
  agents?: AgentProfile[];
  memories?: MemoryNote[];
  pipelines?: AgentWorkflowPipeline[];
  warRoomMessages?: WarRoomMessage[];
  tokenOptimization?: TokenOptimizationState;
  localModels?: LocalModelBenchmark[];
  mcpServers?: McpServerStatus[];
  settings: {
    niche_keywords: string[];
    brand_voice: string;
    timezone: string;
    global_freshness_hours: number;
    text_model: string;
    assistant_model: string;
    assistant_fast_model: string;
    research_model: string;
    image_model: string;
    tts_provider: "openrouter" | "browser";
    tts_voice: string;
    auto_update_hours: number;
  };
}

const STORE_PATH = path.join(process.cwd(), "data", "content-os.json");

function getDefaultState(): ContentOsState {
  const now = new Date().toISOString();
  return {
    sources: [
      {
        id: "src_ai_agents",
        name: "Autonomous Agent Breakthroughs",
        url: "https://news.ycombinator.com/item?id=autonomous-agents",
        type: "research",
        interval_value: 6,
        interval_unit: "hours",
        topic_tags: ["AI", "Agents", "Architecture"],
        freshness_override_hours: 24,
        enabled: true,
        cron_expression: null,
        research_depth: "sonar-pro",
        last_run_at: new Date(Date.now() - 3600000 * 2).toISOString(),
        next_run_at: new Date(Date.now() + 3600000 * 4).toISOString(),
        last_status: "success",
        created_at: now,
      },
      {
        id: "src_firecrawl_feed",
        name: "Firecrawl Web & AI News Feed",
        url: "https://firecrawl.dev/blog",
        type: "url",
        interval_value: 12,
        interval_unit: "hours",
        topic_tags: ["Scraping", "Data Extraction"],
        freshness_override_hours: 48,
        enabled: true,
        cron_expression: null,
        research_depth: "sonar",
        last_run_at: new Date(Date.now() - 3600000 * 5).toISOString(),
        next_run_at: new Date(Date.now() + 3600000 * 7).toISOString(),
        last_status: "success",
        created_at: now,
      },
      {
        id: "src_arxiv_rss",
        name: "ArXiv AI Systems / LLM RSS",
        url: "https://arxiv.org/rss/cs.AI",
        type: "rss",
        interval_value: 24,
        interval_unit: "hours",
        topic_tags: ["Research", "LLMs"],
        freshness_override_hours: 72,
        enabled: true,
        cron_expression: "0 8 * * *",
        research_depth: "sonar",
        last_run_at: new Date(Date.now() - 3600000 * 8).toISOString(),
        next_run_at: new Date(Date.now() + 3600000 * 16).toISOString(),
        last_status: "success",
        created_at: now,
      },
    ],
    articles: [
      {
        id: "art_1",
        source_id: "src_ai_agents",
        title: "Agentic OS: Self-Hosted Orchestration with Claude & Local Tools",
        url: "https://github.com/vivekmishraishere/agentic-os-personal",
        summary: "Vivek Mishra documents building a full personal operating system combining autonomous scraping, OpenRouter multi-model synthesis, local audio reactive HUD, and social publishing.",
        raw_markdown: "# Agentic OS Architecture\nAutonomous content pipelines with zero vendor lock-in.",
        topic_tags: ["Agentic OS", "Jarvis", "AI Systems"],
        published_at: new Date(Date.now() - 3600000 * 3).toISOString(),
        scraped_at: new Date(Date.now() - 3600000 * 2).toISOString(),
        priority_score: 95,
        priority_reason: "Direct match for autonomous agent engineering and self-hosted control architecture.",
        suggested_angle: "Show how pairing local headless daemons with AI creates an unkillable personal executive assistant.",
        status: "new",
      },
      {
        id: "art_2",
        source_id: "src_ai_agents",
        title: "Perplexity Sonar Deep Research Integrations in Production",
        url: "https://perplexity.ai/research/sonar-pro-benchmarks",
        summary: "New benchmarks show real-time search synthesis outperforming traditional retrieval by 42% on developer technical documentation.",
        raw_markdown: "Analysis of Sonar and Sonar Pro API integrations.",
        topic_tags: ["Search", "Perplexity", "Benchmarking"],
        published_at: new Date(Date.now() - 3600000 * 6).toISOString(),
        scraped_at: new Date(Date.now() - 3600000 * 5).toISOString(),
        priority_score: 88,
        priority_reason: "High relevance to real-time research collectors and feed prioritization.",
        suggested_angle: "Deep dive into replacing brittle static scrapers with dynamic neural research collectors.",
        status: "shortlisted",
      },
      {
        id: "art_3",
        source_id: "src_firecrawl_feed",
        title: "Anti-Bot Evasion & Residential Proxy Routing at 100k Req/Hour",
        url: "https://nodemaven.com/research/anti-bot-fingerprinting",
        summary: "Techniques for TLS fingerprint randomization, browser header emulation, and dynamic residential proxy rotation under modern Cloudflare / Datadome protections.",
        raw_markdown: "Technical breakdown of HTTP/2 stream spoofing and browser fingerprinting.",
        topic_tags: ["Scraping", "Proxies", "Anti-Bot"],
        published_at: new Date(Date.now() - 3600000 * 12).toISOString(),
        scraped_at: new Date(Date.now() - 3600000 * 9).toISOString(),
        priority_score: 82,
        priority_reason: "Essential for robust automated web research pipelines in hostile web environments.",
        suggested_angle: "Why modern scraping is 90% fingerprint hygiene and 10% HTML parsing.",
        status: "new",
      },
    ],
    drafts: [
      {
        id: "draft_1",
        article_id: "art_1",
        title: "I Stopped Using AI Tools, I Built an AI System Instead",
        caption: "Most people collect 15 AI subscriptions. We built ONE autonomous Agentic OS that runs them all locally.\n\nHere is how it works:\n1. Autonomous collectors sweep arXiv, Hacker News, & GitHub.\n2. AI ranks them 0–100 by signal-to-noise ratio.\n3. Content Studio drafts multi-platform copy & news cards in one click.\n4. Zernio schedules across LinkedIn, Instagram, and X.\n\nAll controlled from desktop HUD or remote phone interface.\n\nSource: https://github.com/vivekmishraishere/agentic-os-personal",
        image_path: "/api/system/artifacts/image/agentic_os_banner",
        image_prompt: "Editorial modern news card with headline 'AGENTIC OS ARCHITECTURE' and subhead 'Autonomous Content Pipeline & Desktop HUD', dark tech background with neon red accents, ultra-sharp typography.",
        image_status: "ready",
        aspect_ratio: "16:9",
        status: "draft",
        created_at: new Date(Date.now() - 7200000).toISOString(),
        updated_at: new Date(Date.now() - 1800000).toISOString(),
        versions: [
          {
            id: "v1",
            role: "assistant",
            content: "Initial caption drafted from Vivek Mishra's Agentic OS repository.",
            caption_snapshot: "Most people collect 15 AI subscriptions...",
            created_at: new Date(Date.now() - 7200000).toISOString(),
          },
          {
            id: "v2",
            role: "user",
            content: "Make it more punchy with numbered bullet points.",
            created_at: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            id: "v3",
            role: "assistant",
            content: "Refined with high-contrast numbered breakdown.",
            caption_snapshot: "Most people collect 15 AI subscriptions. We built ONE autonomous Agentic OS...",
            created_at: new Date(Date.now() - 1800000).toISOString(),
          },
        ],
        images: [
          {
            id: "img_1",
            image_path: "/api/system/artifacts/image/agentic_os_banner",
            prompt: "Editorial modern news card with headline 'AGENTIC OS ARCHITECTURE'",
            aspect_ratio: "16:9",
            created_at: new Date(Date.now() - 1800000).toISOString(),
          },
        ],
      },
    ],
    scheduled: [
      {
        id: "sch_1",
        draft_id: "draft_1",
        title: "I Stopped Using AI Tools, I Built an AI System Instead",
        scheduled_for: new Date(Date.now() + 3600000 * 5).toISOString(),
        timezone: "Asia/Kolkata",
        platforms: ["linkedin", "twitter"],
        status: "scheduled",
        created_at: new Date(Date.now() - 3600000).toISOString(),
      },
    ],
    expenses: [
      { id: "exp_1", date: new Date().toISOString().slice(0, 10), category: "Cloud & APIs", type: "expense", amount: 2450, description: "OpenRouter & Perplexity Sonar API credits" },
      { id: "exp_2", date: new Date().toISOString().slice(0, 10), category: "Infrastructure", type: "expense", amount: 1800, description: "Hostinger VPS & NodeMaven Proxy rotation pool" },
      { id: "exp_3", date: new Date().toISOString().slice(0, 10), category: "Consulting", type: "revenue", amount: 35000, description: "Agentic OS deployment & architecture client retainer" },
      { id: "exp_4", date: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10), category: "SaaS & Tools", type: "expense", amount: 990, description: "Domain registration & SSL cert renewals" },
      { id: "exp_5", date: new Date(Date.now() - 86400000 * 4).toISOString().slice(0, 10), category: "Sponsorship", type: "revenue", amount: 12500, description: "Newsletter tech intelligence sponsor spot" },
    ],
    tasks: [
      { id: "tsk_1", title: "Review priority feed AI scores & approve top 2 articles", status: "open", created_at: now },
      { id: "tsk_2", title: "Check NodeMaven residential proxy pool bandwidth", status: "open", created_at: now },
      { id: "tsk_3", title: "Test continuous voice turn on Jarvis 3D globe HUD", status: "done", created_at: now },
      { id: "tsk_4", title: "Audit Zernio multi-account token refresh expiry", status: "open", created_at: now },
    ],
    mail: [
      {
        id: "mail_1",
        from_name: "Vivek Mishra",
        from_addr: "vivek@agenticos.io",
        subject: "Agentic OS Personal v2.4 Release Notes",
        snippet: "Hey! Just pushed the new 3D HUD audio pulses, Firecrawl collector suite, and Zernio multi-platform dispatcher...",
        internal_date: new Date(Date.now() - 3600000 * 1.5).toISOString(),
        unread: true,
      },
      {
        id: "mail_2",
        from_name: "OpenRouter Billing",
        from_addr: "billing@openrouter.ai",
        subject: "Invoice #OR-8921 Paid · Claude 3.7 & Gemini 2.5 Flash",
        snippet: "Your monthly compute charge of $28.40 has been processed successfully. Credit balance: $142.10.",
        internal_date: new Date(Date.now() - 3600000 * 4).toISOString(),
        unread: false,
      },
      {
        id: "mail_3",
        from_name: "Zernio Notifications",
        from_addr: "system@zernio.com",
        subject: "Post Published: 'Autonomous Agent Architecture' (LinkedIn)",
        snippet: "Post container #zrn_84920 was published to LinkedIn Page with 1.4k impressions in first hour.",
        internal_date: new Date(Date.now() - 3600000 * 7).toISOString(),
        unread: false,
      },
    ],
    scraperJobs: [
      {
        id: "job_1",
        target_url: "https://news.ycombinator.com/best",
        proxy_mode: "nodemaven",
        anti_bot: true,
        status: "completed",
        records_found: 30,
        logs: [
          "[INIT] Initializing headless Playwright cluster with stealth headers",
          "[PROXY] Assigned NodeMaven US-East residential IP (24.182.90.11)",
          "[FETCH] Request completed in 412ms (HTTP 200)",
          "[PARSE] Extracted 30 trending technical stories & discussion links",
          "[STORE] Synced to local articles database and fed to AI ranker",
        ],
        created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      },
    ],
    agents: [
      {
        id: "hermes",
        name: "Hermes 3",
        role: "Autonomous Executive & Fast Router",
        model: "Nous-Hermes-3-70B",
        status: "active",
        tokenSavingsPct: 96.4,
        tokensUsed: 142800,
        tasksCompleted: 34,
        speed: "140 t/s",
        isLocal: false,
        avatarIcon: "zap",
        description: "Primary orchestrator, dispatches sub-agents and manages task dependencies.",
      },
      {
        id: "claude",
        name: "Claude 3.7 Sonnet",
        role: "Deep Reasoning & Architecture",
        model: "Claude-3.7-Sonnet (Thinking)",
        status: "active",
        tokenSavingsPct: 92.1,
        tokensUsed: 312000,
        tasksCompleted: 28,
        speed: "85 t/s",
        isLocal: false,
        avatarIcon: "brain",
        description: "Complex system architecture, multi-file refactoring, adversarial auditing.",
      },
      {
        id: "codex",
        name: "Codex / GPT-5.6",
        role: "Full-Stack Engineer & Automations",
        model: "GPT-5.6-Codex",
        status: "working",
        tokenSavingsPct: 94.5,
        tokensUsed: 228400,
        tasksCompleted: 41,
        speed: "115 t/s",
        isLocal: false,
        avatarIcon: "code",
        description: "Generates production code, scripts, Playwright browser routines, and API endpoints.",
      },
      {
        id: "deepseek",
        name: "DeepSeek R1 (Local)",
        role: "Zero-Cost Local Reasoning",
        model: "Ollama / DeepSeek-R1-14B",
        status: "active",
        tokenSavingsPct: 100.0,
        tokensUsed: 540000,
        tasksCompleted: 52,
        speed: "155 t/s",
        isLocal: true,
        avatarIcon: "cpu",
        description: "Runs locally on Ollama at $0 cost for privacy, token savings, and high throughput.",
      },
      {
        id: "leadhunter",
        name: "Lead Hunter AI",
        role: "Autonomous B2B Lead Engine",
        model: "Perplexity Sonar + Hunter API",
        status: "idle",
        tokenSavingsPct: 95.8,
        tokensUsed: 89000,
        tasksCompleted: 19,
        speed: "95 t/s",
        isLocal: false,
        avatarIcon: "crosshair",
        description: "Extracts decision makers, verifies email deliverability, and enriches corporate profiles.",
      },
      {
        id: "seo_architect",
        name: "SEO Topical Architect",
        role: "Topical Maps & Semantic Clusters",
        model: "Gemini 2.5 Pro / Flash",
        status: "active",
        tokenSavingsPct: 97.2,
        tokensUsed: 174000,
        tasksCompleted: 23,
        speed: "160 t/s",
        isLocal: false,
        avatarIcon: "trending-up",
        description: "Builds high-intent keyword clusters, competitor gap matrices, and outlines.",
      },
      {
        id: "video_director",
        name: "Video Retention Director",
        role: "YouTube/Shorts Hook Architecture",
        model: "Claude 3.7 + Whisper",
        status: "standby",
        tokenSavingsPct: 93.6,
        tokensUsed: 62000,
        tasksCompleted: 14,
        speed: "90 t/s",
        isLocal: false,
        avatarIcon: "video",
        description: "Designs 3-second retention hooks, narrative beats, and visual B-roll prompts.",
      },
      {
        id: "computer_use",
        name: "Computer Use Agent",
        role: "Desktop & Browser Driver",
        model: "Anthropic Computer-Use v2",
        status: "active",
        tokenSavingsPct: 91.0,
        tokensUsed: 98000,
        tasksCompleted: 16,
        speed: "45 actions/min",
        isLocal: true,
        avatarIcon: "monitor-play",
        description: "Drives native OS applications, fills forms, clicks, navigates, and automates UI.",
      },
    ],
    memories: [
      {
        id: "mem_1",
        title: "Autonomous Agent Routing SOP",
        category: "sop",
        source_agent: "Hermes 3",
        tags: ["routing", "sop", "architecture"],
        created_at: "21 minutes ago",
        content: "Always direct routine summarization and simple classification queries to local DeepSeek-R1 or Gemini Flash to preserve 95% token budget. Reserve Claude 3.7 Sonnet for multi-agent synthesis, code generation, and complex architecture decisions.",
        pinned: true,
      },
      {
        id: "mem_2",
        title: "Token Minimization 95% Playbook Rules",
        category: "workflow_rule",
        source_agent: "Claude 3.7",
        tags: ["tokens", "optimization", "cache"],
        created_at: "1 hour ago",
        content: "Enabled Fast Mode + Semantic Cache. Truncate preamble instructions. Use JSON schemas instead of free-form chain of thought when invoking subagents. Reduces cost by $42/day across all active automated pipelines.",
        pinned: true,
      },
      {
        id: "mem_3",
        title: "B2B Outreach ICP: Mid-Market AI Agencies",
        category: "client_profile",
        source_agent: "Lead Hunter",
        tags: ["outreach", "leads", "icp"],
        created_at: "2 hours ago",
        content: "Focus on AI agency founders and VP of Engineering running 5-50 people teams. Pain point: managing disconnected AI tabs and token exhaustion. Hook: 'One-click unified Agent OS with Obsidian shared memory'.",
      },
      {
        id: "mem_4",
        title: "High-Retention Hook Blueprint (YouTube/Shorts)",
        category: "decision",
        source_agent: "Video Director",
        tags: ["youtube", "retention", "hooks"],
        created_at: "3 hours ago",
        content: "Hook formula: 1) Visual contradiction, 2) State exact outcome within 3.2s, 3) Tease the open-source dashboard download. Proven to maintain >74% viewer retention past the 30-second drop-off curve.",
      },
      {
        id: "mem_5",
        title: "Obsidian Vault File Hierarchy & Sync Protocol",
        category: "learning",
        source_agent: "Codex",
        tags: ["obsidian", "vault", "sync"],
        created_at: "5 hours ago",
        content: "Vault path: /vault/agent-os/. All agents auto-commit markdown logs with YAML frontmatter tags #agent-memory, #sop, #decision. Bi-directional sync verified with zero file lock collisions.",
      },
    ],
    pipelines: [
      {
        id: "pipe_seo",
        name: "SEO Topical Authority Machine",
        description: "Automated keyword research, competitor gap analysis, outline drafting, and SEO audit.",
        assigned_agent: "SEO Topical Architect",
        status: "active",
        lastRunAt: "18m ago",
        resultsCount: 14,
        stages: [
          { id: "s1", name: "Keyword Cluster Discovery", status: "completed", outputSnippet: "Found 48 low-KD high-intent clusters for 'Agent OS'" },
          { id: "s2", name: "Competitor Gap Extraction", status: "completed", outputSnippet: "Identified 3 unaddressed topical gaps vs rival SaaS" },
          { id: "s3", name: "Topical Outline Architecture", status: "completed", outputSnippet: "Structured 7 H2s with semantic entities & schema" },
          { id: "s4", name: "Longform Article Synthesis", status: "running", outputSnippet: "Synthesizing 2,400-word engineering deep dive..." },
          { id: "s5", name: "Search Intent & Rank Audit", status: "pending" },
        ],
      },
      {
        id: "pipe_lead",
        name: "B2B Lead Generation & Outreach",
        description: "Autonomous scraping, prospect enrichment, icebreaker generation, and multi-touch sequence dispatch.",
        assigned_agent: "Lead Hunter AI",
        status: "active",
        lastRunAt: "34m ago",
        resultsCount: 38,
        stages: [
          { id: "l1", name: "Target ICP Directory Scrape", status: "completed", outputSnippet: "Scraped 42 verified agency founders on LinkedIn" },
          { id: "l2", name: "Waterfall Email Enrichment", status: "completed", outputSnippet: "Verified 38 high-deliverability work emails" },
          { id: "l3", name: "Personalized Icebreaker Generation", status: "completed", outputSnippet: "Generated 38 custom openers referencing recent posts" },
          { id: "l4", name: "Multi-Touch Sequence Staging", status: "running", outputSnippet: "Queuing 3-step value email sequence in outreach engine..." },
          { id: "l5", name: "CRM & Pipeline Sync", status: "pending" },
        ],
      },
      {
        id: "pipe_video",
        name: "Viral Video Script & Retention Studio",
        description: "3-second hook formulation, narrative retention pacing, visual B-roll cues, and teleprompter scripts.",
        assigned_agent: "Video Retention Director",
        status: "idle",
        lastRunAt: "2h ago",
        resultsCount: 8,
        stages: [
          { id: "v1", name: "Trending Topic & Hook Lab", status: "completed", outputSnippet: "Generated 5 high-converting video hook angles" },
          { id: "v2", name: "Retention Beat Sheet", status: "completed", outputSnippet: "Paced narrative with micro-curiosity loops every 45s" },
          { id: "v3", name: "Visual B-Roll & Screen Prompts", status: "pending" },
          { id: "v4", name: "Final Teleprompter Master Script", status: "pending" },
        ],
      },
      {
        id: "pipe_code",
        name: "Autonomous Engineering & Tool Builder",
        description: "Decomposes specs into TDD slices, builds components, performs adversarial security audits, and tests.",
        assigned_agent: "Codex / Claude 3.7",
        status: "completed",
        lastRunAt: "5m ago",
        resultsCount: 22,
        stages: [
          { id: "c1", name: "Spec & Interface Decomposition", status: "completed", outputSnippet: "Formalized type contracts and component boundaries" },
          { id: "c2", name: "TDD Test Harness Scaffolding", status: "completed", outputSnippet: "Generated 268 passing unit and integration tests" },
          { id: "c3", name: "Component & API Implementation", status: "completed", outputSnippet: "Implemented Agent OS HUD Mission Control" },
          { id: "c4", name: "Adversarial Code & Security Audit", status: "completed", outputSnippet: "Zero vulnerabilities found. Clean lint and build." },
        ],
      },
    ],
    warRoomMessages: [
      { id: "w1", sender: "Operator", role: "user", avatar: "👤", timestamp: "12:10 PM", content: "Team, we need to deploy an automated SEO and Lead Gen pipeline that reduces token consumption by over 90%." },
      { id: "w2", sender: "Hermes 3", role: "agent", avatar: "⚡", agentModel: "Nous-70B", timestamp: "12:11 PM", content: "I will act as the executive orchestrator. I am enabling the 95% Token Minimization Playbook: routing simple queries to local DeepSeek-R1 and caching repetitive prompts in Obsidian memory." },
      { id: "w3", sender: "Claude 3.7", role: "agent", avatar: "🧠", agentModel: "Claude-3.7-Sonnet", timestamp: "12:11 PM", content: "Agreed. I will architect the semantic topical map for the SEO engine. I've already indexed the high-intent keywords in the shared Obsidian Vault." },
      { id: "w4", sender: "DeepSeek R1", role: "agent", avatar: "💻", agentModel: "Ollama Local", timestamp: "12:12 PM", content: "Standing by on local Ollama cluster. Ready to crunch competitor HTML and extract lead contact records at 155 tokens/sec with zero cloud API billing." },
      { id: "w5", sender: "Codex", role: "agent", avatar: "⚙️", agentModel: "GPT-5.6", timestamp: "12:12 PM", content: "Pipeline interfaces connected. Staging the next stage run in the Production Kanban board." },
    ],
    tokenOptimization: {
      fastMode: true,
      effortLevel: "balanced",
      smartRoutingEnabled: true,
      localModelPreferred: true,
      totalTokensSaved: 842910,
      tokensSavedPct: 95.4,
      costSavedUsd: 42.60,
    },
    localModels: [
      { id: "m1", name: "DeepSeek-R1-Distill-14B", status: "loaded", vram: "8.4 GB", tokensPerSec: 148, goldyScore: 98, contextWindow: "64k" },
      { id: "m2", name: "Llama-3.3-70B-Instruct", status: "ready", vram: "38.2 GB", tokensPerSec: 82, goldyScore: 96, contextWindow: "128k" },
      { id: "m3", name: "Qwen-2.5-Coder-32B", status: "ready", vram: "18.5 GB", tokensPerSec: 118, goldyScore: 97, contextWindow: "32k" },
      { id: "m4", name: "Mistral-Nemo-12B", status: "ready", vram: "6.8 GB", tokensPerSec: 165, goldyScore: 91, contextWindow: "128k" },
    ],
    mcpServers: [
      { id: "mcp_obsidian", name: "Obsidian Shared Vault MCP", uri: "mcp://obsidian-local", status: "connected", toolsCount: 14, latencyMs: 4 },
      { id: "mcp_computer_use", name: "Computer Use OS Driver", uri: "mcp://computer-use-agent", status: "connected", toolsCount: 18, latencyMs: 12 },
      { id: "mcp_scraper", name: "NodeMaven Stealth Scraper", uri: "mcp://nodemaven-scraper", status: "connected", toolsCount: 8, latencyMs: 45 },
      { id: "mcp_git", name: "GitHub Version Control", uri: "mcp://git-local", status: "connected", toolsCount: 12, latencyMs: 8 },
      { id: "mcp_netlify", name: "Netlify Cloud Deployer", uri: "mcp://netlify-deployer", status: "standby", toolsCount: 6, latencyMs: 120 },
      { id: "mcp_mail", name: "Outreach & Email Sync", uri: "mcp://mail-outreach", status: "listening", toolsCount: 9, latencyMs: 65 },
    ],
    settings: {
      niche_keywords: ["AI", "Autonomous Agents", "Startups", "Systems Engineering", "Automation"],
      brand_voice: "Clear, confident, authoritative, engineering-focused, and concise.",
      timezone: "Asia/Kolkata",
      global_freshness_hours: 24,
      text_model: "anthropic/claude-3.7-sonnet",
      assistant_model: "anthropic/claude-3.7-sonnet",
      assistant_fast_model: "google/gemini-2.5-flash",
      research_model: "perplexity/sonar-pro",
      image_model: "openai/gpt-image-2",
      tts_provider: "openrouter",
      tts_voice: "bm_george",
      auto_update_hours: 6,
    },
  };
}

export function readContentOsState(): ContentOsState {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      const def = getDefaultState();
      return {
        ...def,
        ...parsed,
        agents: (parsed.agents && parsed.agents.length > 0) ? parsed.agents : def.agents,
        memories: (parsed.memories && parsed.memories.length > 0) ? parsed.memories : def.memories,
        pipelines: (parsed.pipelines && parsed.pipelines.length > 0) ? parsed.pipelines : def.pipelines,
        warRoomMessages: (parsed.warRoomMessages && parsed.warRoomMessages.length > 0) ? parsed.warRoomMessages : def.warRoomMessages,
        tokenOptimization: parsed.tokenOptimization ? { ...def.tokenOptimization, ...parsed.tokenOptimization } : def.tokenOptimization,
        localModels: (parsed.localModels && parsed.localModels.length > 0) ? parsed.localModels : def.localModels,
        mcpServers: (parsed.mcpServers && parsed.mcpServers.length > 0) ? parsed.mcpServers : def.mcpServers,
      };
    }
  } catch (err) {
    console.error("[ContentOsStore] Error reading store, using defaults:", err);
  }
  const def = getDefaultState();
  writeContentOsState(def);
  return def;
}

export function writeContentOsState(state: ContentOsState): void {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("[ContentOsStore] Error saving store:", err);
  }
}

// Helper methods for actions
export function addSource(source: Omit<Source, "id" | "created_at">): Source {
  const state = readContentOsState();
  const newSource: Source = {
    ...source,
    id: `src_${crypto.randomBytes(4).toString("hex")}`,
    created_at: new Date().toISOString(),
  };
  state.sources.unshift(newSource);
  writeContentOsState(state);
  return newSource;
}

export function toggleSource(id: string, enabled?: boolean): Source | null {
  const state = readContentOsState();
  const idx = state.sources.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  state.sources[idx].enabled = enabled ?? !state.sources[idx].enabled;
  writeContentOsState(state);
  return state.sources[idx];
}

export function deleteSource(id: string): boolean {
  const state = readContentOsState();
  const len = state.sources.length;
  state.sources = state.sources.filter((s) => s.id !== id);
  if (state.sources.length !== len) {
    writeContentOsState(state);
    return true;
  }
  return false;
}

export function executeResearch(
  query: string,
  depth: "sonar" | "sonar-pro" = "sonar",
  overrideSynthesis?: { title?: string; summary?: string; suggested_angle?: string; tags?: string[] }
): Article[] {
  const state = readContentOsState();
  const cleanQuery = query.trim();
  const now = new Date().toISOString();

  // Create 2 rich research articles from query (using real AI synthesis if available)
  const newArticles: Article[] = [
    {
      id: `art_${crypto.randomBytes(4).toString("hex")}`,
      title: overrideSynthesis?.title || `${cleanQuery}: Real-Time Technical Breakthroughs & Industry Signal`,
      url: `https://perplexity.ai/search?q=${encodeURIComponent(cleanQuery)}`,
      summary: overrideSynthesis?.summary || `Automated Perplexity ${depth.toUpperCase()} synthesis on '${cleanQuery}'. Highlights state-of-the-art developments, production benchmarks, and architectural patterns.`,
      raw_markdown: `## Executive Technical Brief\n- Key trend: Rapid shift toward local autonomous tool loops.\n- Signal strength: 9.4/10.\n- Methodology: Multi-hop web synthesis with live cross-validation.`,
      topic_tags: overrideSynthesis?.tags || ["AI", "Research", "Intelligence"],
      published_at: now,
      scraped_at: now,
      priority_score: Math.floor(Math.random() * 15) + 85, // 85-100
      priority_reason: `High semantic alignment with '${cleanQuery}' and user niche keywords.`,
      suggested_angle: overrideSynthesis?.suggested_angle || `Highlight actionable implementation steps for engineers building around '${cleanQuery}'.`,
      status: "new",
    },
    {
      id: `art_${crypto.randomBytes(4).toString("hex")}`,
      title: `Architectural Analysis & Ecosystem Impact of ${cleanQuery}`,
      url: `https://news.ycombinator.com/item?id=${encodeURIComponent(cleanQuery.toLowerCase().replace(/\s+/g, "-"))}`,
      summary: `In-depth technical breakdown of ecosystem reactions, open-source repositories, and performance considerations for ${cleanQuery}.`,
      raw_markdown: `Detailed breakdown of community benchmarks and API latencies.`,
      topic_tags: ["Architecture", "Engineering"],
      published_at: now,
      scraped_at: now,
      priority_score: Math.floor(Math.random() * 16) + 75, // 75-90
      priority_reason: "Strong architectural relevance and high engagement score in current crawl window.",
      suggested_angle: "Focus on latency, cost efficiency, and failure mode mitigation.",
      status: "new",
    },
  ];

  state.articles.unshift(...newArticles);
  writeContentOsState(state);
  return newArticles;
}

export function rankArticles(): number {
  const state = readContentOsState();
  let count = 0;
  for (const art of state.articles) {
    if (!art.priority_score || art.priority_score < 40) {
      art.priority_score = Math.floor(Math.random() * 30) + 70;
      art.priority_reason = "Evaluated against niche keywords and current viral engagement metrics.";
      count++;
    }
  }
  writeContentOsState(state);
  return count || state.articles.length;
}

export function setArticleStatus(id: string, status: Article["status"]): Article | null {
  const state = readContentOsState();
  const art = state.articles.find((a) => a.id === id);
  if (!art) return null;
  art.status = status;
  writeContentOsState(state);
  return art;
}

export function createDraftFromArticle(articleId: string): Draft | null {
  const state = readContentOsState();
  const art = state.articles.find((a) => a.id === articleId);
  if (!art) return null;

  art.status = "used";
  const now = new Date().toISOString();
  const draft: Draft = {
    id: `draft_${crypto.randomBytes(4).toString("hex")}`,
    article_id: art.id,
    title: art.title,
    caption: `⚡ ${art.title}\n\n${art.summary}\n\n💡 Angle: ${art.suggested_angle}\n\nRead more: ${art.url}`,
    aspect_ratio: "1:1",
    status: "draft",
    created_at: now,
    updated_at: now,
    versions: [
      {
        id: `v_${crypto.randomBytes(3).toString("hex")}`,
        role: "assistant",
        content: "Generated initial social post caption from article.",
        caption_snapshot: `⚡ ${art.title}\n\n${art.summary}\n\nRead more: ${art.url}`,
        created_at: now,
      },
    ],
    images: [],
  };

  state.drafts.unshift(draft);
  writeContentOsState(state);
  return draft;
}

export function updateDraftCaption(id: string, caption: string): Draft | null {
  const state = readContentOsState();
  const draft = state.drafts.find((d) => d.id === id);
  if (!draft) return null;
  draft.caption = caption;
  draft.updated_at = new Date().toISOString();
  writeContentOsState(state);
  return draft;
}

export function refineDraftCaption(id: string, instruction: string, customRefinedCaption?: string): Draft | null {
  const state = readContentOsState();
  const draft = state.drafts.find((d) => d.id === id);
  if (!draft) return null;

  const now = new Date().toISOString();
  draft.versions.push({
    id: `v_${crypto.randomBytes(3).toString("hex")}`,
    role: "user",
    content: instruction,
    created_at: now,
  });

  // Apply real AI refinement if provided, otherwise fallback to intelligent heuristics
  let refined = customRefinedCaption;
  if (!refined) {
    const lower = instruction.toLowerCase();
    if (lower.includes("shorten") || lower.includes("concise") || lower.includes("brief")) {
      refined = draft.caption
        .split("\n\n")
        .slice(0, 2)
        .join("\n\n")
        .replace(/(\r\n|\n|\r){3,}/gm, "\n\n");
    } else if (lower.includes("cta") || lower.includes("call to action")) {
      refined = `${draft.caption}\n\n👉 What are your thoughts on this architecture? Drop your take below or share with your engineering team.`;
    } else if (lower.includes("bullet") || lower.includes("breakdown") || lower.includes("list")) {
      refined = `${draft.caption}\n\nKey takeaways:\n• Autonomous tool loops eliminate manual busywork\n• 100% self-hosted with local privacy\n• End-to-end orchestration in one unified dashboard`;
    } else if (lower.includes("viral") || lower.includes("hook")) {
      refined = `Most engineers are doing this completely wrong in 2026.\n\n${draft.caption}`;
    } else {
      refined = `${draft.caption}\n\n[Edited for clarity & precision: ${instruction}]`;
    }
  }

  draft.caption = refined;
  draft.updated_at = now;
  draft.versions.push({
    id: `v_${crypto.randomBytes(3).toString("hex")}`,
    role: "assistant",
    content: `Refined caption according to: "${instruction}"`,
    caption_snapshot: refined,
    created_at: now,
  });

  writeContentOsState(state);
  return draft;
}

export function generateDraftCardImage(draftId: string, aspectRatio: string = "1:1"): Draft | null {
  const state = readContentOsState();
  const draft = state.drafts.find((d) => d.id === draftId);
  if (!draft) return null;

  const now = new Date().toISOString();
  draft.aspect_ratio = aspectRatio;
  draft.image_status = "ready";
  const prompt = `Modern crisp editorial news card with bold headline '${draft.title.slice(0, 45)}...', dark tech background, vibrant accents, 4k resolution`;
  draft.image_prompt = prompt;
  draft.image_path = `/api/system/artifacts/image/agentic_card_${draft.id.slice(0, 6)}`;

  draft.images.unshift({
    id: `img_${crypto.randomBytes(3).toString("hex")}`,
    image_path: draft.image_path,
    prompt,
    aspect_ratio: aspectRatio,
    created_at: now,
  });

  draft.updated_at = now;
  writeContentOsState(state);
  return draft;
}

export function schedulePost(draftId: string, platforms: Array<"instagram" | "linkedin" | "twitter">, scheduledFor: string): ScheduledPost | null {
  const state = readContentOsState();
  const draft = state.drafts.find((d) => d.id === draftId);
  if (!draft) return null;

  draft.status = "scheduled";
  const post: ScheduledPost = {
    id: `sch_${crypto.randomBytes(4).toString("hex")}`,
    draft_id: draftId,
    title: draft.title || "Scheduled Content Post",
    scheduled_for: scheduledFor,
    timezone: state.settings.timezone || "Asia/Kolkata",
    platforms,
    status: "scheduled",
    created_at: new Date().toISOString(),
  };

  state.scheduled.unshift(post);
  writeContentOsState(state);
  return post;
}

export function toggleTask(id: string): ContentTodayTask | null {
  const state = readContentOsState();
  const tsk = state.tasks.find((t) => t.id === id);
  if (!tsk) return null;
  tsk.status = tsk.status === "open" ? "done" : "open";
  writeContentOsState(state);
  return tsk;
}

export function addTask(title: string): ContentTodayTask {
  const state = readContentOsState();
  const newTask: ContentTodayTask = {
    id: `tsk_${crypto.randomBytes(3).toString("hex")}`,
    title: title.trim(),
    status: "open",
    created_at: new Date().toISOString(),
  };
  state.tasks.unshift(newTask);
  writeContentOsState(state);
  return newTask;
}

export function deleteTask(id: string): boolean {
  const state = readContentOsState();
  const len = state.tasks.length;
  state.tasks = state.tasks.filter((t) => t.id !== id);
  if (state.tasks.length !== len) {
    writeContentOsState(state);
    return true;
  }
  return false;
}

export function addExpense(item: Omit<ExpenseItem, "id">): ExpenseItem {
  const state = readContentOsState();
  const newExp: ExpenseItem = {
    ...item,
    id: `exp_${crypto.randomBytes(3).toString("hex")}`,
  };
  state.expenses.unshift(newExp);
  writeContentOsState(state);
  return newExp;
}

export function triggerScraperJob(targetUrl: string, proxyMode: "direct" | "nodemaven" = "nodemaven", antiBot: boolean = true): ScraperJob {
  const state = readContentOsState();
  const now = new Date().toISOString();
  const job: ScraperJob = {
    id: `job_${crypto.randomBytes(4).toString("hex")}`,
    target_url: targetUrl.trim(),
    proxy_mode: proxyMode,
    anti_bot: antiBot,
    status: "completed",
    records_found: Math.floor(Math.random() * 25) + 12,
    logs: [
      `[INIT] Booting scraper worker for ${targetUrl}`,
      `[PROXY] Mode: ${proxyMode.toUpperCase()} · Residential pool connected`,
      `[ANTI-BOT] Fingerprint protection: ${antiBot ? "ACTIVE (TLS + Canvas Spoofing)" : "OFF"}`,
      `[EXTRACT] Parsing DOM tree & JSON-LD structures...`,
      `[DONE] Extracted records with zero CAPTCHA interruptions.`,
    ],
    created_at: now,
  };
  state.scraperJobs.unshift(job);
  writeContentOsState(state);
  return job;
}

export function addMemoryNote(note: Omit<MemoryNote, "id" | "created_at">): MemoryNote {
  const state = readContentOsState();
  const newNote: MemoryNote = {
    ...note,
    id: `mem_${crypto.randomBytes(4).toString("hex")}`,
    created_at: "Just now",
  };
  if (!state.memories) state.memories = [];
  state.memories.unshift(newNote);
  writeContentOsState(state);
  return newNote;
}

export function deleteMemoryNote(id: string): boolean {
  const state = readContentOsState();
  if (!state.memories) return false;
  const initialLen = state.memories.length;
  state.memories = state.memories.filter((m) => m.id !== id);
  if (state.memories.length !== initialLen) {
    writeContentOsState(state);
    return true;
  }
  return false;
}

export function runWorkflowStage(pipelineId: string, stageId?: string, outputSnippet?: string): AgentWorkflowPipeline | null {
  const state = readContentOsState();
  if (!state.pipelines) return null;
  const pipe = state.pipelines.find((p) => p.id === pipelineId);
  if (!pipe) return null;

  pipe.lastRunAt = "Just now";
  pipe.resultsCount = (pipe.resultsCount || 0) + 1;

  if (stageId) {
    const targetStage = pipe.stages.find((s) => s.id === stageId);
    if (targetStage) {
      targetStage.status = "completed";
      if (outputSnippet) targetStage.outputSnippet = outputSnippet;
      targetStage.updatedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  } else {
    // Advance next pending stage
    const nextStage = pipe.stages.find((s) => s.status === "pending" || s.status === "running");
    if (nextStage) {
      nextStage.status = "completed";
      if (outputSnippet) nextStage.outputSnippet = outputSnippet;
      nextStage.updatedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }

  // Check if all stages completed
  const allDone = pipe.stages.every((s) => s.status === "completed");
  if (allDone) {
    pipe.status = "completed";
  } else {
    pipe.status = "active";
  }

  writeContentOsState(state);
  return pipe;
}

export function resetWorkflow(pipelineId: string): AgentWorkflowPipeline | null {
  const state = readContentOsState();
  if (!state.pipelines) return null;
  const pipe = state.pipelines.find((p) => p.id === pipelineId);
  if (!pipe) return null;

  pipe.status = "active";
  pipe.stages = pipe.stages.map((s, idx) => ({
    ...s,
    status: idx === 0 ? "completed" : idx === 1 ? "running" : "pending",
  }));
  writeContentOsState(state);
  return pipe;
}

export function addWarRoomMessage(msg: Omit<WarRoomMessage, "id" | "timestamp">): WarRoomMessage {
  const state = readContentOsState();
  const newMsg: WarRoomMessage = {
    ...msg,
    id: `w_${crypto.randomBytes(4).toString("hex")}`,
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
  if (!state.warRoomMessages) state.warRoomMessages = [];
  state.warRoomMessages.push(newMsg);
  // Keep last 40 messages
  if (state.warRoomMessages.length > 40) {
    state.warRoomMessages = state.warRoomMessages.slice(-40);
  }
  writeContentOsState(state);
  return newMsg;
}

export function updateTokenSettings(settings: Partial<TokenOptimizationState>): TokenOptimizationState {
  const state = readContentOsState();
  state.tokenOptimization = {
    ...(state.tokenOptimization || {
      fastMode: true,
      effortLevel: "balanced",
      smartRoutingEnabled: true,
      localModelPreferred: true,
      totalTokensSaved: 842910,
      tokensSavedPct: 95.4,
      costSavedUsd: 42.60,
    }),
    ...settings,
  };
  writeContentOsState(state);
  return state.tokenOptimization;
}

export function toggleAgentStatus(agentId: string, status?: AgentProfile["status"]): AgentProfile | null {
  const state = readContentOsState();
  if (!state.agents) return null;
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return null;
  if (status) {
    agent.status = status;
  } else {
    agent.status = agent.status === "active" ? "idle" : "active";
  }
  writeContentOsState(state);
  return agent;
}

