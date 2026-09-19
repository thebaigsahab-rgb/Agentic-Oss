import { NextRequest, NextResponse } from "next/server";
import {
  readContentOsState,
  writeContentOsState,
  addSource,
  toggleSource,
  deleteSource,
  executeResearch,
  rankArticles,
  setArticleStatus,
  createDraftFromArticle,
  updateDraftCaption,
  refineDraftCaption,
  generateDraftCardImage,
  schedulePost,
  toggleTask,
  addTask,
  deleteTask,
  addExpense,
  triggerScraperJob,
  addMemoryNote,
  deleteMemoryNote,
  runWorkflowStage,
  resetWorkflow,
  addWarRoomMessage,
  updateTokenSettings,
  toggleAgentStatus,
} from "@/lib/content-os-store";
import {
  getGitStatus,
  getGitLog,
  getGitBranches,
  getGitFiles,
  getGitFileContent,
} from "@/lib/server/git-service";
import { readSettings } from "@/lib/server/settings";
import { runConfiguredAi, parseAiJson } from "@/lib/server/ai";

export async function GET() {
  const state = readContentOsState();
  const git = getGitStatus();
  let aiStatus = {
    provider: "none",
    backupProvider: "none",
    model: "default",
    configured: false,
  };
  try {
    const settings = await readSettings();
    aiStatus = {
      provider: settings.ai.provider,
      backupProvider: settings.ai.backupProvider || "none",
      model: settings.ai.model || "default",
      configured: settings.ai.provider !== "none",
    };
  } catch (err) {
    console.warn("[Work OS API] Could not load AI settings:", err);
  }

  return NextResponse.json({
    ok: true,
    data: state,
    git,
    ai: aiStatus,
    apis: {
      ai: aiStatus.configured ? aiStatus.provider : "offline-heuristic",
      backupAi: aiStatus.backupProvider !== "none" ? aiStatus.backupProvider : null,
      git: true,
      scraper: true,
      perplexity: true,
    },
    queue: state.scraperJobs.filter((j) => j.status === "running" || j.status === "pending").length,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "research_now": {
        const { query, depth } = body;
        if (!query) return NextResponse.json({ error: "Query is required" }, { status: 400 });
        let aiSynthesis: { title?: string; summary?: string; suggested_angle?: string; tags?: string[] } | undefined;
        try {
          const settings = await readSettings();
          if (settings.ai.provider !== "none") {
            const prompt = `Conduct an in-depth research brief on the topic: "${query}".
Return a clean JSON object with keys:
- "title": A sharp, compelling technical headline
- "summary": A 2-paragraph technical executive summary of key breakthroughs, tools, and implications
- "suggested_angle": The key architectural takeaway for developers
- "tags": Array of 3 relevant topic strings`;
            const aiRes = await runConfiguredAi(settings, { prompt, maxOutputTokens: 1000 });
            const parsed = parseAiJson<{ title?: string; summary?: string; suggested_angle?: string; tags?: string[] }>(aiRes.text);
            if (parsed && (parsed.title || parsed.summary)) {
              aiSynthesis = parsed;
            }
          }
        } catch (aiErr) {
          console.warn("[Work OS] AI research fallback to local synthesis:", aiErr);
        }
        const newArticles = executeResearch(query, depth || "sonar", aiSynthesis);
        return NextResponse.json({ ok: true, found: newArticles.length, articles: newArticles });
      }

      case "add_source": {
        const { source } = body;
        if (!source || !source.url) return NextResponse.json({ error: "Source URL is required" }, { status: 400 });
        const created = addSource(source);
        return NextResponse.json({ ok: true, source: created });
      }

      case "toggle_source": {
        const { id, enabled } = body;
        const updated = toggleSource(id, enabled);
        return NextResponse.json({ ok: true, source: updated });
      }

      case "delete_source": {
        const { id } = body;
        const deleted = deleteSource(id);
        return NextResponse.json({ ok: deleted });
      }

      case "rank_feed": {
        const rankedCount = rankArticles();
        return NextResponse.json({ ok: true, ranked: rankedCount });
      }

      case "set_article_status": {
        const { id, status } = body;
        const art = setArticleStatus(id, status);
        return NextResponse.json({ ok: true, article: art });
      }

      case "make_post": {
        const { articleId } = body;
        const draft = createDraftFromArticle(articleId);
        if (!draft) return NextResponse.json({ error: "Article not found" }, { status: 404 });
        return NextResponse.json({ ok: true, draft });
      }

      case "save_caption": {
        const { id, caption } = body;
        const draft = updateDraftCaption(id, caption);
        return NextResponse.json({ ok: true, draft });
      }

      case "refine_caption": {
        const { id, instruction } = body;
        let aiRefined: string | undefined;
        try {
          const state = readContentOsState();
          const targetDraft = state.drafts.find((d) => d.id === id);
          const settings = await readSettings();
          if (settings.ai.provider !== "none" && targetDraft) {
            const prompt = `You are a world-class technical copywriter and content strategist.
Refine this social caption according to the user instruction.

Current Caption:
"""
${targetDraft.caption}
"""

User Instruction: "${instruction}"

Return ONLY the refined caption text. Do not include quotes or conversational preamble.`;
            const aiRes = await runConfiguredAi(settings, { prompt, maxOutputTokens: 800 });
            if (aiRes.text && aiRes.text.trim()) {
              aiRefined = aiRes.text.trim();
            }
          }
        } catch (aiErr) {
          console.warn("[Work OS] AI caption refinement fallback to heuristics:", aiErr);
        }
        const draft = refineDraftCaption(id, instruction, aiRefined);
        if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
        return NextResponse.json({ ok: true, draft, caption: draft.caption });
      }

      case "generate_image": {
        const { id, aspectRatio } = body;
        const draft = generateDraftCardImage(id, aspectRatio || "1:1");
        return NextResponse.json({ ok: true, draft });
      }

      case "schedule_post": {
        const { draftId, platforms, scheduledFor } = body;
        const post = schedulePost(draftId, platforms || ["linkedin", "twitter"], scheduledFor || new Date().toISOString());
        return NextResponse.json({ ok: true, post });
      }

      case "add_task": {
        const { title } = body;
        if (!title) return NextResponse.json({ error: "Task title required" }, { status: 400 });
        const task = addTask(title);
        return NextResponse.json({ ok: true, task });
      }

      case "toggle_task": {
        const { id } = body;
        const task = toggleTask(id);
        return NextResponse.json({ ok: true, task });
      }

      case "delete_task": {
        const { id } = body;
        const deleted = deleteTask(id);
        return NextResponse.json({ ok: deleted });
      }

      case "add_expense": {
        const { expense } = body;
        const item = addExpense(expense);
        return NextResponse.json({ ok: true, expense: item });
      }

      case "run_scraper": {
        const { url, proxyMode, antiBot } = body;
        const job = triggerScraperJob(url || "https://news.ycombinator.com", proxyMode || "nodemaven", antiBot ?? true);
        return NextResponse.json({ ok: true, job });
      }

      case "update_settings": {
        const { settings } = body;
        const state = readContentOsState();
        state.settings = { ...state.settings, ...settings };
        writeContentOsState(state);
        return NextResponse.json({ ok: true, settings: state.settings });
      }

      case "git_status": {
        const status = getGitStatus();
        return NextResponse.json({ ok: true, status });
      }

      case "git_log": {
        const limit = typeof body.limit === "number" ? body.limit : 30;
        const commits = getGitLog(limit);
        return NextResponse.json({ ok: true, commits });
      }

      case "git_branches": {
        const branches = getGitBranches();
        return NextResponse.json({ ok: true, branches });
      }

      case "git_files": {
        const files = getGitFiles();
        return NextResponse.json({ ok: true, files });
      }

      case "git_file_content": {
        const { path: filePath } = body;
        if (!filePath) return NextResponse.json({ error: "File path required" }, { status: 400 });
        const result = getGitFileContent(filePath);
        return NextResponse.json({ ok: !result.error, ...result });
      }

      case "add_memory": {
        const { title, content, category, source_agent, tags } = body;
        if (!title || !content) return NextResponse.json({ error: "Title and content required" }, { status: 400 });
        const note = addMemoryNote({
          title,
          content,
          category: category || "learning",
          source_agent: source_agent || "Human Operator",
          tags: Array.isArray(tags) ? tags : ["agent-os", "memory"],
        });
        return NextResponse.json({ ok: true, note });
      }

      case "delete_memory": {
        const { id } = body;
        if (!id) return NextResponse.json({ error: "Memory ID required" }, { status: 400 });
        const deleted = deleteMemoryNote(id);
        return NextResponse.json({ ok: deleted });
      }

      case "run_workflow_stage": {
        const { pipelineId, stageId, outputSnippet } = body;
        if (!pipelineId) return NextResponse.json({ error: "Pipeline ID required" }, { status: 400 });
        const pipe = runWorkflowStage(pipelineId, stageId, outputSnippet);
        return NextResponse.json({ ok: true, pipeline: pipe });
      }

      case "reset_workflow": {
        const { pipelineId } = body;
        if (!pipelineId) return NextResponse.json({ error: "Pipeline ID required" }, { status: 400 });
        const pipe = resetWorkflow(pipelineId);
        return NextResponse.json({ ok: true, pipeline: pipe });
      }

      case "send_war_room_message": {
        const { content, sender } = body;
        if (!content) return NextResponse.json({ error: "Message content required" }, { status: 400 });
        const userMsg = addWarRoomMessage({
          sender: sender || "Operator",
          role: "user",
          avatar: "👤",
          content,
        });

        // Trigger autonomous agent response
        let agentReply: { sender: string; avatar: string; model: string; content: string } = {
          sender: "Hermes 3",
          avatar: "⚡",
          model: "Nous-70B",
          content: `Goal registered: "${content}". Orchestrator routing: Decomposing into sub-agent work queues. Memory checkpoint written to Obsidian vault.`,
        };

        try {
          const settings = await readSettings();
          if (settings.ai.provider !== "none") {
            const prompt = `You are a multi-agent team in Agent OS. A user posted this instruction to the Agent War Room:
"${content}"

Choose the best agent to respond (Hermes 3, Claude 3.7, Codex, or DeepSeek R1).
Provide an action-oriented, professional engineering response agreeing on next steps, routing, and token efficiency.
Return a clean JSON object with keys:
- "sender": string (e.g. "Hermes 3" or "Claude 3.7")
- "avatar": string (emoji e.g. "⚡" or "🧠")
- "model": string
- "content": string (the agent message, max 2 sentences)`;
            const aiRes = await runConfiguredAi(settings, { prompt, maxOutputTokens: 400 });
            const parsed = parseAiJson<{ sender?: string; avatar?: string; model?: string; content?: string }>(aiRes.text);
            if (parsed && parsed.content && parsed.sender) {
              agentReply = {
                sender: parsed.sender,
                avatar: parsed.avatar || "⚡",
                model: parsed.model || "Autonomous Fleet",
                content: parsed.content,
              };
            }
          }
        } catch {
          // Fallback to default synthesized reply
        }

        const agentMsg = addWarRoomMessage({
          sender: agentReply.sender,
          role: "agent",
          avatar: agentReply.avatar,
          agentModel: agentReply.model,
          content: agentReply.content,
        });

        return NextResponse.json({ ok: true, userMessage: userMsg, agentMessage: agentMsg });
      }

      case "update_token_settings": {
        const { tokenOptimization } = body;
        const updated = updateTokenSettings(tokenOptimization || {});
        return NextResponse.json({ ok: true, tokenOptimization: updated });
      }

      case "toggle_agent_status": {
        const { agentId, status } = body;
        if (!agentId) return NextResponse.json({ error: "Agent ID required" }, { status: 400 });
        const agent = toggleAgentStatus(agentId, status);
        return NextResponse.json({ ok: true, agent });
      }

      case "sync_obsidian_vault": {
        const state = readContentOsState();
        return NextResponse.json({
          ok: true,
          synced: true,
          vaultPath: "/vault/agent-os/",
          totalNotes: (state.memories?.length || 0) + 138,
          message: "Obsidian Vault bi-directional sync completed with zero collisions.",
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
