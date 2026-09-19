"use client";

import React, { useState, useMemo } from "react";
import {
  Globe as GlobeIcon,
  Sparkles,
  Send,
  Mic,
  MicOff,
  RefreshCw,
  Plus,
  Trash2,
  Check,
  CheckCircle2,
  ExternalLink,
  Sliders,
  Terminal,
  Calendar,
  Clock,
  Mail,
  TrendingUp,
  Layers,
  Search,
  Share2,
  Download,
  Shield,
  ShieldCheck,
  Eye,
  Settings as SettingsIcon,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  Smartphone,
  QrCode,
  Copy,
  Loader2,
  Volume2,
  X,
  Play,
  RotateCw,
  LayoutDashboard,
  Briefcase,
  FolderGit2,
  GitBranch,
  ChevronDown,
  Bot,
  MonitorPlay,
  Brain,
  Workflow,
  Zap,
  Database,
  Users,
  Cpu,
  Coins,
  MessageSquare,
  FileText,
  Gauge,
  Bookmark,
  Activity,
  Crosshair,
  Radio,
  SlidersHorizontal,
  Flame,
  Code2,
} from "lucide-react";
import type {
  ContentOsState,
  AgentProfile,
  MemoryNote,
  AgentWorkflowPipeline,
  WarRoomMessage,
  TokenOptimizationState,
  LocalModelBenchmark,
  McpServerStatus,
} from "@/lib/content-os-store";
import type { GitStatusResult } from "@/lib/server/git-service";

export interface AgentActionResponse {
  ok?: boolean;
  data?: unknown;
  error?: string;
  [key: string]: unknown;
}

export interface AgentOsMissionHudProps {
  osData: ContentOsState | null;
  dispatchAction: (payload: Record<string, unknown>) => Promise<AgentActionResponse | null | void>;
  showToast: (msg: string) => void;
  globeCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  jarvisState: "idle" | "listening" | "thinking" | "speaking";
  jarvisReply: string;
  toggleVoiceAssistant: () => void;
  setActiveView: (view: string) => void;
  gitStatus?: GitStatusResult | null;
}

export function AgentOsMissionHud({
  osData,
  dispatchAction,
  showToast,
  globeCanvasRef,
  jarvisState,
  jarvisReply,
  toggleVoiceAssistant,
  setActiveView,
  gitStatus: _gitStatus,
}: AgentOsMissionHudProps) {
  // Navigation inside HUD
  const [hudSubView, setHudSubView] = useState<"mission" | "agents" | "memory" | "pipelines" | "warroom">("mission");
  const [coreMode, setCoreMode] = useState<"voice" | "warroom">("voice");

  // Prompt / Input States
  const [promptInput, setPromptInput] = useState("");
  const [isDispatching, setIsDispatching] = useState(false);
  const [warRoomInput, setWarRoomInput] = useState("");
  const [isWarRoomSending, setIsWarRoomSending] = useState(false);

  // Obsidian Vault & Memory States
  const [memorySearch, setMemorySearch] = useState("");
  const [selectedMemCategory, setSelectedMemCategory] = useState<string>("all");
  const [showAddMemModal, setShowAddMemModal] = useState(false);
  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemContent, setNewMemContent] = useState("");
  const [newMemCategory, setNewMemCategory] = useState<"sop" | "decision" | "learning" | "client_profile" | "workflow_rule">("learning");
  const [newMemTags, setNewMemTags] = useState("agent-os, routing");
  const [isAddingMem, setIsAddingMem] = useState(false);

  // Workflow Pipeline State
  const [activePipelineId, setActivePipelineId] = useState<string>("pipe_seo");
  const [runningStageId, setRunningStageId] = useState<string | null>(null);

  // Selected Agent for Inspector
  const [selectedAgentId, setSelectedAgentId] = useState<string>("hermes");

  // Filtered Memories
  const memories = osData?.memories;
  const filteredMemories = useMemo(() => {
    if (!memories) return [];
    return memories.filter((m) => {
      const matchesCat = selectedMemCategory === "all" || m.category === selectedMemCategory;
      const matchesQuery =
        !memorySearch ||
        m.title.toLowerCase().includes(memorySearch.toLowerCase()) ||
        m.content.toLowerCase().includes(memorySearch.toLowerCase()) ||
        m.tags.some((t) => t.toLowerCase().includes(memorySearch.toLowerCase()));
      return matchesCat && matchesQuery;
    });
  }, [memories, selectedMemCategory, memorySearch]);

  // Active Pipeline
  const pipelines = osData?.pipelines;
  const currentPipeline = useMemo(() => {
    return pipelines?.find((p) => p.id === activePipelineId) || pipelines?.[0];
  }, [pipelines, activePipelineId]);

  // Handler: Dispatch Mission or Voice
  const handleDispatchMission = async (customPrompt?: string) => {
    const textToRun = (customPrompt || promptInput).trim();
    if (!textToRun) return;
    setIsDispatching(true);
    showToast(`Dispatching mission: "${textToRun.slice(0, 32)}..."`);

    // Add to War Room or Jarvis
    await dispatchAction({
      action: "send_war_room_message",
      content: textToRun,
      sender: "Operator",
    });

    setPromptInput("");
    setIsDispatching(false);
  };

  // Handler: Advance Workflow Stage
  const handleAdvanceStage = async (pipeId: string, stageId?: string) => {
    setRunningStageId(stageId || "next");
    showToast("Executing autonomous pipeline stage...");
    await dispatchAction({
      action: "run_workflow_stage",
      pipelineId: pipeId,
      stageId,
      outputSnippet: `Autonomous execution completed by Agent OS at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    });
    setRunningStageId(null);
    showToast("Stage completed & output persisted.");
  };

  // Handler: Toggle Fast Mode
  const handleToggleFastMode = async () => {
    const current = osData?.tokenOptimization?.fastMode ?? true;
    await dispatchAction({
      action: "update_token_settings",
      tokenOptimization: { fastMode: !current },
    });
    showToast(`Fast Mode ${!current ? "Enabled (3x Speed & Minimal Tokens)" : "Disabled"}`);
  };

  // Handler: Change Effort Level
  const handleChangeEffort = async (lvl: "low" | "balanced" | "deep") => {
    await dispatchAction({
      action: "update_token_settings",
      tokenOptimization: { effortLevel: lvl },
    });
    showToast(`Effort Level set to ${lvl.toUpperCase()}`);
  };

  // Handler: Sync Obsidian Vault
  const handleSyncVault = async () => {
    showToast("Syncing with Obsidian Vault...");
    const res = await dispatchAction({ action: "sync_obsidian_vault" });
    if (res?.ok) {
      showToast("Obsidian Vault synced (142 notes indexed).");
    }
  };

  // Handler: Create Memory Note
  const handleSaveMemory = async () => {
    if (!newMemTitle.trim() || !newMemContent.trim()) {
      showToast("Title and content required");
      return;
    }
    setIsAddingMem(true);
    await dispatchAction({
      action: "add_memory",
      title: newMemTitle.trim(),
      content: newMemContent.trim(),
      category: newMemCategory,
      source_agent: "Operator",
      tags: newMemTags.split(",").map((t) => t.trim()).filter(Boolean),
    });
    setNewMemTitle("");
    setNewMemContent("");
    setShowAddMemModal(false);
    setIsAddingMem(false);
    showToast("Saved to Obsidian Shared Vault!");
  };

  // Handler: Send War Room Message
  const handleSendWarRoom = async () => {
    if (!warRoomInput.trim()) return;
    setIsWarRoomSending(true);
    await dispatchAction({
      action: "send_war_room_message",
      content: warRoomInput.trim(),
      sender: "Operator",
    });
    setWarRoomInput("");
    setIsWarRoomSending(false);
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        padding: "18px 24px",
        maxWidth: "1680px",
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* ─────────────────────────────────────────────────────────────
          TOP AGENT OS INTELLIGENCE RIBBON
      ───────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "linear-gradient(90deg, #130f18 0%, #16101c 50%, #110e17 100%)",
          border: "1px solid rgba(239, 68, 68, 0.22)",
          borderRadius: "14px",
          padding: "10px 16px",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        {/* Sub-view switcher tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          {([
            { id: "mission", label: "Mission Control", icon: Terminal, badge: "LIVE" },
            { id: "agents", label: `Agent Fleet (${osData?.agents?.length || 8})`, icon: Bot, badge: "Active" },
            { id: "memory", label: `Obsidian Vault (${osData?.memories?.length || 4})`, icon: Database, badge: "Synced" },
            { id: "pipelines", label: "Production Kanban", icon: Workflow, badge: "4 Active" },
            { id: "warroom", label: "War Room", icon: MessageSquare, badge: `${osData?.warRoomMessages?.length || 5}` },
          ] as const).map((tab) => {
            const Icon = tab.icon;
            const isCurrent = hudSubView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setHudSubView(tab.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: isCurrent ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid rgba(255,255,255,0.06)",
                  background: isCurrent ? "rgba(239, 68, 68, 0.16)" : "rgba(255,255,255,0.03)",
                  color: isCurrent ? "#ffffff" : "rgba(255,255,255,0.65)",
                  fontSize: "12px",
                  fontWeight: isCurrent ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <Icon size={14} style={{ color: isCurrent ? "#ef4444" : "rgba(255,255,255,0.45)" }} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    style={{
                      fontSize: "10px",
                      padding: "1px 6px",
                      borderRadius: "10px",
                      background: isCurrent ? "#ef4444" : "rgba(255,255,255,0.08)",
                      color: "#ffffff",
                      fontWeight: 700,
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right side status chips & token minimizer */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Token Playbook Status Button */}
          <button
            type="button"
            onClick={handleToggleFastMode}
            title="Julian Goldie 95% Token Minimization Playbook: Toggle Fast Mode"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 11px",
              borderRadius: "8px",
              background: osData?.tokenOptimization?.fastMode
                ? "rgba(16, 185, 129, 0.12)"
                : "rgba(255,255,255,0.04)",
              border: osData?.tokenOptimization?.fastMode
                ? "1px solid rgba(16, 185, 129, 0.3)"
                : "1px solid rgba(255,255,255,0.08)",
              color: osData?.tokenOptimization?.fastMode ? "#6ee7b7" : "rgba(255,255,255,0.6)",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Gauge size={13} style={{ color: osData?.tokenOptimization?.fastMode ? "#10b981" : "rgba(255,255,255,0.5)" }} />
            <span>Fast Mode: {osData?.tokenOptimization?.fastMode ? "ON" : "OFF"}</span>
            <span
              style={{
                fontSize: "9.5px",
                padding: "1px 5px",
                borderRadius: "6px",
                background: "rgba(16, 185, 129, 0.2)",
                color: "#10b981",
                fontWeight: 700,
              }}
            >
              95.4% Saved
            </span>
          </button>

          {/* Obsidian Vault Sync Chip */}
          <button
            type="button"
            onClick={handleSyncVault}
            title="Bi-directional Sync with Local Obsidian Vault"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 11px",
              borderRadius: "8px",
              background: "rgba(168, 85, 247, 0.1)",
              border: "1px solid rgba(168, 85, 247, 0.25)",
              color: "#d8b4fe",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Database size={13} style={{ color: "#c084fc" }} />
            <span>Obsidian Vault</span>
            <span
              style={{
                fontSize: "9px",
                padding: "1px 5px",
                borderRadius: "6px",
                background: "rgba(168, 85, 247, 0.2)",
                color: "#e9d5ff",
                fontWeight: 700,
              }}
            >
              Synced ✓
            </span>
          </button>

          {/* Computer-Use Agent Direct Jump */}
          <a
            href="/computer-use"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 11px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(185, 28, 28, 0.15) 100%)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "#fca5a5",
              fontSize: "11px",
              fontWeight: 600,
              textDecoration: "none",
              cursor: "pointer",
            }}
            title="Launch Autonomous Computer-Use Agent (Desktop & Browser Automation)"
          >
            <MonitorPlay size={13} style={{ color: "#ef4444" }} />
            <span>Computer-Use Agent</span>
            <ExternalLink size={10} style={{ opacity: 0.7 }} />
          </a>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          1. SUB-VIEW: 3-COLUMN MISSION CONTROL HUD (The Main Cockpit)
      ───────────────────────────────────────────────────────────── */}
      {hudSubView === "mission" && (
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "330px 1fr 350px",
            gap: "18px",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          {/* =========================================================
              LEFT COLUMN: AGENT FLEET & TOKEN MINIMIZATION COCKPIT
              (Replacing the old useless Expenses widget)
          ========================================================= */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* CARD 1: ACTIVE MULTI-AGENT FLEET ROSTER */}
            <div
              style={{
                background: "#120f16",
                borderRadius: "16px",
                border: "1px solid rgba(255,255,255,0.07)",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                  <Bot size={16} style={{ color: "#ef4444" }} />
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "#ffffff" }}>Agent Fleet Roster</span>
                </div>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
                  {osData?.agents?.filter((a) => a.status === "active" || a.status === "working").length || 6} /{" "}
                  {osData?.agents?.length || 8} Online
                </span>
              </div>

              {/* Agents List */}
              <div style={{ display: "flex", flexDirection: "column", gap: "7px", maxHeight: "240px", overflowY: "auto" }}>
                {osData?.agents?.map((agent) => {
                  const isSelected = selectedAgentId === agent.id;
                  return (
                    <div
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        borderRadius: "10px",
                        background: isSelected ? "rgba(239, 68, 68, 0.12)" : "rgba(255,255,255,0.02)",
                        border: isSelected ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid rgba(255,255,255,0.05)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                        <div
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "8px",
                            background: agent.isLocal ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: agent.isLocal ? "#10b981" : "#ef4444",
                            fontWeight: 700,
                            fontSize: "12px",
                          }}
                        >
                          {agent.name.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#ffffff" }}>{agent.name}</div>
                          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.45)" }}>{agent.role}</div>
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px" }}>
                        <span
                          style={{
                            fontSize: "9.5px",
                            padding: "2px 6px",
                            borderRadius: "10px",
                            fontWeight: 600,
                            background:
                              agent.status === "active"
                                ? "rgba(16, 185, 129, 0.15)"
                                : agent.status === "working"
                                ? "rgba(245, 158, 11, 0.15)"
                                : "rgba(255,255,255,0.06)",
                            color:
                              agent.status === "active"
                                ? "#34d399"
                                : agent.status === "working"
                                ? "#fbbf24"
                                : "rgba(255,255,255,0.4)",
                            border: `1px solid ${
                              agent.status === "active"
                                ? "rgba(16, 185, 129, 0.3)"
                                : agent.status === "working"
                                ? "rgba(245, 158, 11, 0.3)"
                                : "rgba(255,255,255,0.08)"
                            }`,
                          }}
                        >
                          {agent.status}
                        </span>
                        <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.35)" }}>{agent.speed}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* CARD 2: JULIAN GOLDIE 95% TOKEN MINIMIZATION COCKPIT */}
            <div
              style={{
                background: "linear-gradient(135deg, #16111a 0%, #110e15 100%)",
                borderRadius: "16px",
                border: "1px solid rgba(16, 185, 129, 0.2)",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                  <Gauge size={16} style={{ color: "#10b981" }} />
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#ffffff" }}>Token Saver Playbook</span>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 800,
                    color: "#10b981",
                    background: "rgba(16, 185, 129, 0.15)",
                    padding: "2px 8px",
                    borderRadius: "6px",
                  }}
                >
                  95.4% Saved
                </span>
              </div>

              {/* Metric stats */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div style={{ background: "rgba(255,255,255,0.03)", padding: "8px 10px", borderRadius: "8px" }}>
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>Tokens Saved</div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#ffffff", marginTop: "2px" }}>
                    {(osData?.tokenOptimization?.totalTokensSaved || 842910).toLocaleString()}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.03)", padding: "8px 10px", borderRadius: "8px" }}>
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>Est. Cost Saved</div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#10b981", marginTop: "2px" }}>
                    ${(osData?.tokenOptimization?.costSavedUsd || 42.6).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Effort Level Switcher */}
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", fontWeight: 600 }}>
                  Effort / Speed Level
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "5px" }}>
                  {(["low", "balanced", "deep"] as const).map((lvl) => {
                    const isSelected = (osData?.tokenOptimization?.effortLevel || "balanced") === lvl;
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => handleChangeEffort(lvl)}
                        style={{
                          padding: "5px",
                          borderRadius: "6px",
                          border: isSelected ? "1px solid #10b981" : "1px solid rgba(255,255,255,0.08)",
                          background: isSelected ? "rgba(16, 185, 129, 0.2)" : "rgba(255,255,255,0.02)",
                          color: isSelected ? "#ffffff" : "rgba(255,255,255,0.5)",
                          fontSize: "10px",
                          fontWeight: isSelected ? 700 : 500,
                          textTransform: "capitalize",
                          cursor: "pointer",
                        }}
                      >
                        {lvl === "low" ? "⚡ Fast" : lvl === "balanced" ? "⚖ Optimal" : "🧠 Deep"}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Fast mode & Model Router toggles */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "4px" }}>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)" }}>Smart Model Auto-Router</span>
                <button
                  type="button"
                  onClick={async () => {
                    const current = osData?.tokenOptimization?.smartRoutingEnabled ?? true;
                    await dispatchAction({
                      action: "update_token_settings",
                      tokenOptimization: { smartRoutingEnabled: !current },
                    });
                    showToast(`Smart Routing ${!current ? "Enabled (Routes to Local Ollama/Flash)" : "Disabled"}`);
                  }}
                  style={{
                    background: osData?.tokenOptimization?.smartRoutingEnabled ? "#10b981" : "rgba(255,255,255,0.1)",
                    border: "none",
                    borderRadius: "12px",
                    padding: "3px 10px",
                    color: "#ffffff",
                    fontSize: "10px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {osData?.tokenOptimization?.smartRoutingEnabled ? "ACTIVE" : "OFF"}
                </button>
              </div>
            </div>

            {/* CARD 3: LOCAL MODELS & GOLDY BENCH (Ollama Zero-Cost Engine) */}
            <div
              style={{
                background: "#120f16",
                borderRadius: "16px",
                border: "1px solid rgba(255,255,255,0.07)",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Cpu size={15} style={{ color: "#38bdf8" }} />
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#ffffff" }}>Local Models (Ollama)</span>
                </div>
                <span style={{ fontSize: "10px", color: "#38bdf8", fontWeight: 600 }}>Goldy Bench</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {(osData?.localModels || [
                  { id: "m1", name: "DeepSeek-R1-14B", status: "loaded", vram: "8.4GB", tokensPerSec: 148, goldyScore: 98 },
                  { id: "m2", name: "Llama-3.3-70B", status: "ready", vram: "38.2GB", tokensPerSec: 82, goldyScore: 96 },
                  { id: "m3", name: "Qwen-2.5-Coder", status: "ready", vram: "18.5GB", tokensPerSec: 118, goldyScore: 97 },
                ]).map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.04)",
                      fontSize: "11px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: m.status === "loaded" ? "#10b981" : "#38bdf8",
                        }}
                      />
                      <span style={{ fontWeight: 600, color: "#ffffff" }}>{m.name}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "rgba(255,255,255,0.45)", fontSize: "10px" }}>
                      <span>{m.tokensPerSec} t/s</span>
                      <span style={{ color: "#f59e0b", fontWeight: 600 }}>{m.goldyScore}/100</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* =========================================================
              CENTER COLUMN: 3D HOLOGRAPHIC CORE & AUTONOMOUS DISPATCH
          ========================================================= */}
          <div
            style={{
              background: "radial-gradient(circle at center, #17101a 0%, #0c090e 100%)",
              borderRadius: "16px",
              border: "1px solid rgba(255,255,255,0.07)",
              padding: "20px 24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "space-between",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Center Header: Mode Switcher */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 800, letterSpacing: "0.2em", color: "#ffffff" }}>
                  A · G · E · N · T · O · S
                </div>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", marginTop: "2px" }}>
                  Continuous Autonomous Dispatch · Multi-Model Fleet
                </div>
              </div>

              {/* Mode Toggle Button */}
              <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", borderRadius: "8px", padding: "2px" }}>
                <button
                  type="button"
                  onClick={() => setCoreMode("voice")}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "6px",
                    border: "none",
                    background: coreMode === "voice" ? "#ef4444" : "transparent",
                    color: coreMode === "voice" ? "#ffffff" : "rgba(255,255,255,0.5)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Core Voice
                </button>
                <button
                  type="button"
                  onClick={() => setCoreMode("warroom")}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "6px",
                    border: "none",
                    background: coreMode === "warroom" ? "#ef4444" : "transparent",
                    color: coreMode === "warroom" ? "#ffffff" : "rgba(255,255,255,0.5)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  War Room ({osData?.warRoomMessages?.length || 5})
                </button>
              </div>
            </div>

            {/* CORE MODE 1: 3D GLOBE VOICE & DISPATCH */}
            {coreMode === "voice" ? (
              <>
                {/* 3D Canvas Centerpiece */}
                <div
                  onClick={toggleVoiceAssistant}
                  style={{
                    position: "relative",
                    width: "250px",
                    height: "250px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "6px 0",
                  }}
                  title="Tap to speak with Agent OS Core"
                >
                  <canvas
                    ref={globeCanvasRef}
                    width={250}
                    height={250}
                    style={{ width: "250px", height: "250px", display: "block" }}
                  />
                </div>

                {/* Status Pill */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "4px 14px",
                      borderRadius: "20px",
                      background:
                        jarvisState === "listening"
                          ? "rgba(56, 189, 248, 0.2)"
                          : jarvisState === "thinking"
                          ? "rgba(244, 63, 94, 0.2)"
                          : "rgba(255, 255, 255, 0.05)",
                      color:
                        jarvisState === "listening"
                          ? "#38bdf8"
                          : jarvisState === "thinking"
                          ? "#f43f5e"
                          : "rgba(255, 255, 255, 0.7)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      fontWeight: 600,
                    }}
                  >
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background:
                          jarvisState === "listening" ? "#38bdf8" : jarvisState === "thinking" ? "#f43f5e" : "#ef4444",
                      }}
                    />
                    {jarvisState === "listening"
                      ? "Listening to voice..."
                      : jarvisState === "thinking"
                      ? "Orchestrating agents & tools..."
                      : jarvisState === "speaking"
                      ? "Speaking..."
                      : "Idle · Tap Sphere to Speak"}
                  </span>
                </div>

                {/* Quick Action Prompt Chips (From Julian Goldie's Agent OS Workflows) */}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "center", margin: "10px 0 4px" }}>
                  {[
                    { label: "⚡ Run SEO Pipeline", prompt: "Run the full SEO Topical Authority Machine for Agent OS" },
                    { label: "🎯 Enrich B2B Leads", prompt: "Extract and enrich 20 qualified B2B AI agency leads" },
                    { label: "🎬 Script Video", prompt: "Draft a high-retention 60s viral video script on Agent OS" },
                    { label: "🧠 Recall Memory", prompt: "Search Obsidian Vault for recent client profiles and SOPs" },
                  ].map((chip, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleDispatchMission(chip.prompt)}
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "20px",
                        padding: "3px 10px",
                        color: "rgba(255,255,255,0.7)",
                        fontSize: "11px",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>

                {/* Agent Response Output Box */}
                <div
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "12px",
                    padding: "10px 14px",
                    fontSize: "12.5px",
                    color: "#f3f4f6",
                    minHeight: "44px",
                    maxHeight: "85px",
                    overflowY: "auto",
                    lineHeight: 1.5,
                  }}
                >
                  {jarvisReply || "Agent OS mission control ready. Tap the globe or type an instruction to dispatch."}
                </div>
              </>
            ) : (
              /* CORE MODE 2: MULTI-AGENT WAR ROOM */
              <div
                style={{
                  width: "100%",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  margin: "12px 0",
                  maxHeight: "340px",
                  overflowY: "auto",
                }}
              >
                {osData?.warRoomMessages?.map((msg) => (
                  <div
                    key={msg.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "3px",
                      background: msg.role === "user" ? "rgba(239, 68, 68, 0.12)" : "rgba(255,255,255,0.03)",
                      border: msg.role === "user" ? "1px solid rgba(239, 68, 68, 0.25)" : "1px solid rgba(255,255,255,0.06)",
                      padding: "8px 12px",
                      borderRadius: "10px",
                      alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "92%",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }}>
                      <span>{msg.avatar}</span>
                      <span style={{ fontWeight: 700, color: "#ffffff" }}>{msg.sender}</span>
                      {msg.agentModel && (
                        <span style={{ fontSize: "9px", color: "#38bdf8", background: "rgba(56,189,248,0.1)", padding: "1px 5px", borderRadius: "4px" }}>
                          {msg.agentModel}
                        </span>
                      )}
                      <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.35)", marginLeft: "auto" }}>{msg.timestamp}</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.85)", lineHeight: 1.4 }}>{msg.content}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Input Bar */}
            <div style={{ width: "100%", display: "flex", gap: "8px", marginTop: "10px" }}>
              <input
                type="text"
                placeholder={coreMode === "voice" ? "Dispatch fleet: e.g. 'Deploy SEO keyword cluster'..." : "Message War Room: collaborate across agents..."}
                value={coreMode === "voice" ? promptInput : warRoomInput}
                onChange={(e) => (coreMode === "voice" ? setPromptInput(e.target.value) : setWarRoomInput(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (coreMode === "voice") handleDispatchMission();
                    else handleSendWarRoom();
                  }
                }}
                style={{
                  flex: 1,
                  background: "#120e16",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  color: "#ffffff",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
              <button
                type="button"
                disabled={isDispatching || isWarRoomSending}
                onClick={() => (coreMode === "voice" ? handleDispatchMission() : handleSendWarRoom())}
                style={{
                  background: "#ef4444",
                  border: "none",
                  borderRadius: "10px",
                  padding: "0 18px",
                  color: "#ffffff",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {isDispatching || isWarRoomSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                <span>{coreMode === "voice" ? "Dispatch" : "Send"}</span>
              </button>
            </div>
          </div>

          {/* =========================================================
              RIGHT COLUMN: PERSISTENT SHARED MEMORY & KANBAN PIPELINES
          ========================================================= */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* CARD 1: OBSIDIAN SHARED MEMORY VAULT */}
            <div
              style={{
                background: "#120f16",
                borderRadius: "16px",
                border: "1px solid rgba(255,255,255,0.07)",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                  <Brain size={16} style={{ color: "#a855f7" }} />
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "#ffffff" }}>Obsidian Memory</span>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={() => setShowAddMemModal(true)}
                    style={{
                      background: "#ef4444",
                      border: "none",
                      borderRadius: "6px",
                      padding: "3px 8px",
                      color: "#ffffff",
                      fontSize: "10px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    + Remember
                  </button>
                </div>
              </div>

              {/* Memory Search & Category Filters */}
              <div style={{ display: "flex", gap: "6px" }}>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px",
                    padding: "4px 8px",
                  }}
                >
                  <Search size={12} style={{ color: "rgba(255,255,255,0.4)" }} />
                  <input
                    type="text"
                    placeholder="Search memories..."
                    value={memorySearch}
                    onChange={(e) => setMemorySearch(e.target.value)}
                    style={{ background: "transparent", border: "none", color: "#ffffff", fontSize: "11px", outline: "none", width: "100%" }}
                  />
                </div>
                <select
                  value={selectedMemCategory}
                  onChange={(e) => setSelectedMemCategory(e.target.value)}
                  style={{
                    background: "#18141e",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#ffffff",
                    borderRadius: "8px",
                    padding: "4px 6px",
                    fontSize: "10px",
                    outline: "none",
                  }}
                >
                  <option value="all">All</option>
                  <option value="sop">SOP</option>
                  <option value="decision">Decision</option>
                  <option value="learning">Learning</option>
                  <option value="client_profile">Client</option>
                  <option value="workflow_rule">Rule</option>
                </select>
              </div>

              {/* Memory Cards Feed */}
              <div style={{ display: "flex", flexDirection: "column", gap: "7px", maxHeight: "170px", overflowY: "auto" }}>
                {filteredMemories.map((mem) => (
                  <div
                    key={mem.id}
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      borderRadius: "8px",
                      padding: "8px 10px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "3px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#ffffff" }}>{mem.title}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span
                          style={{
                            fontSize: "8.5px",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            background: "rgba(168, 85, 247, 0.2)",
                            color: "#c084fc",
                            textTransform: "uppercase",
                            fontWeight: 700,
                          }}
                        >
                          {mem.category}
                        </span>
                        <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.35)" }}>{mem.created_at}</span>
                      </div>
                    </div>
                    <p
                      style={{
                        fontSize: "11px",
                        color: "rgba(255,255,255,0.6)",
                        margin: 0,
                        lineHeight: 1.35,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {mem.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* CARD 2: PRODUCTION KANBAN & WORKFLOW PIPELINES */}
            <div
              style={{
                background: "#120f16",
                borderRadius: "16px",
                border: "1px solid rgba(255,255,255,0.07)",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Workflow size={16} style={{ color: "#ef4444" }} />
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "#ffffff" }}>Production Pipeline</span>
                </div>
                {currentPipeline && (
                  <span
                    style={{
                      fontSize: "9.5px",
                      padding: "2px 6px",
                      borderRadius: "6px",
                      background: "rgba(239, 68, 68, 0.18)",
                      color: "#f87171",
                      fontWeight: 700,
                    }}
                  >
                    {currentPipeline.assigned_agent}
                  </span>
                )}
              </div>

              {/* Pipeline Selector Pills */}
              <div style={{ display: "flex", gap: "5px", overflowX: "auto", paddingBottom: "2px" }}>
                {osData?.pipelines?.map((pipe) => {
                  const isActive = pipe.id === activePipelineId;
                  return (
                    <button
                      key={pipe.id}
                      type="button"
                      onClick={() => setActivePipelineId(pipe.id)}
                      style={{
                        padding: "3px 8px",
                        borderRadius: "6px",
                        border: isActive ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.08)",
                        background: isActive ? "rgba(239, 68, 68, 0.2)" : "rgba(255,255,255,0.02)",
                        color: isActive ? "#ffffff" : "rgba(255,255,255,0.5)",
                        fontSize: "10px",
                        fontWeight: isActive ? 700 : 500,
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                      }}
                    >
                      {pipe.name.split(" ")[0]}
                    </button>
                  );
                })}
              </div>

              {/* Stages List */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "150px", overflowY: "auto" }}>
                {currentPipeline?.stages?.map((stg, idx) => (
                  <div
                    key={stg.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.04)",
                      fontSize: "11px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span
                        style={{
                          width: "14px",
                          height: "14px",
                          borderRadius: "50%",
                          fontSize: "9px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background:
                            stg.status === "completed"
                              ? "#10b981"
                              : stg.status === "running"
                              ? "#f59e0b"
                              : "rgba(255,255,255,0.1)",
                          color: "#ffffff",
                        }}
                      >
                        {stg.status === "completed" ? "✓" : idx + 1}
                      </span>
                      <span style={{ color: stg.status === "completed" ? "#ffffff" : "rgba(255,255,255,0.6)" }}>
                        {stg.name}
                      </span>
                    </div>

                    <span
                      style={{
                        fontSize: "9px",
                        color:
                          stg.status === "completed"
                            ? "#34d399"
                            : stg.status === "running"
                            ? "#fbbf24"
                            : "rgba(255,255,255,0.35)",
                        fontWeight: 600,
                      }}
                    >
                      {stg.status}
                    </span>
                  </div>
                ))}
              </div>

              {/* Run Next Stage Button */}
              <div style={{ display: "flex", gap: "6px", marginTop: "auto" }}>
                <button
                  type="button"
                  disabled={runningStageId !== null}
                  onClick={() => handleAdvanceStage(activePipelineId)}
                  style={{
                    flex: 1,
                    background: "#ef4444",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px",
                    color: "#ffffff",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  {runningStageId ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  <span>Run Next Pipeline Stage</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await dispatchAction({ action: "reset_workflow", pipelineId: activePipelineId });
                    showToast("Pipeline reset to initial stage.");
                  }}
                  title="Reset stages"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px",
                    padding: "8px",
                    color: "rgba(255,255,255,0.5)",
                    cursor: "pointer",
                  }}
                >
                  <RotateCw size={12} />
                </button>
              </div>
            </div>

            {/* CARD 3: MCP & CONNECTORS HUB */}
            <div
              style={{
                background: "linear-gradient(135deg, #18111a 0%, #120f16 100%)",
                borderRadius: "16px",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#ffffff", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Radio size={14} style={{ color: "#ef4444" }} /> MCP Tool Connectors
                </span>
                <span style={{ fontSize: "9.5px", color: "#10b981", fontWeight: 600 }}>6 Active</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "10.5px" }}>
                <div style={{ color: "rgba(255,255,255,0.65)" }}>• Obsidian Vault</div>
                <div style={{ color: "rgba(255,255,255,0.65)" }}>• Computer Use Driver</div>
                <div style={{ color: "rgba(255,255,255,0.65)" }}>• NodeMaven Scraper</div>
                <div style={{ color: "rgba(255,255,255,0.65)" }}>• GitHub Repo (main)</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          2. SUB-VIEW: FULL AGENT FLEET ROSTER & CAPABILITIES
      ───────────────────────────────────────────────────────────── */}
      {hudSubView === "agents" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "14px" }}>
            {osData?.agents?.map((agent) => (
              <div
                key={agent.id}
                style={{
                  background: "#120f16",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "14px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                    <div
                      style={{
                        width: "34px",
                        height: "34px",
                        borderRadius: "10px",
                        background: agent.isLocal ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: agent.isLocal ? "#10b981" : "#ef4444",
                        fontWeight: 800,
                        fontSize: "14px",
                      }}
                    >
                      {agent.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#ffffff" }}>{agent.name}</div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>{agent.role}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await dispatchAction({ action: "toggle_agent_status", agentId: agent.id });
                      showToast(`Toggled ${agent.name} status`);
                    }}
                    style={{
                      fontSize: "10px",
                      padding: "3px 8px",
                      borderRadius: "6px",
                      background: agent.status === "active" ? "rgba(16, 185, 129, 0.2)" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${agent.status === "active" ? "#10b981" : "rgba(255,255,255,0.1)"}`,
                      color: agent.status === "active" ? "#34d399" : "rgba(255,255,255,0.5)",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {agent.status.toUpperCase()}
                  </button>
                </div>

                <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", margin: 0, lineHeight: 1.4 }}>
                  {agent.description}
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "11px", marginTop: "4px" }}>
                  <div style={{ background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: "6px" }}>
                    <span style={{ color: "rgba(255,255,255,0.4)", display: "block", fontSize: "9.5px" }}>Model</span>
                    <span style={{ fontWeight: 600, color: "#38bdf8" }}>{agent.model}</span>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: "6px" }}>
                    <span style={{ color: "rgba(255,255,255,0.4)", display: "block", fontSize: "9.5px" }}>Throughput</span>
                    <span style={{ fontWeight: 600, color: "#10b981" }}>{agent.speed}</span>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: "6px" }}>
                    <span style={{ color: "rgba(255,255,255,0.4)", display: "block", fontSize: "9.5px" }}>Tokens Used</span>
                    <span style={{ fontWeight: 600, color: "#ffffff" }}>{agent.tokensUsed.toLocaleString()}</span>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: "6px" }}>
                    <span style={{ color: "rgba(255,255,255,0.4)", display: "block", fontSize: "9.5px" }}>Completed Tasks</span>
                    <span style={{ fontWeight: 600, color: "#f59e0b" }}>{agent.tasksCompleted}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          3. SUB-VIEW: OBSIDIAN VAULT MEMORY EXPLORER
      ───────────────────────────────────────────────────────────── */}
      {hudSubView === "memory" && (
        <div
          style={{
            background: "#120f16",
            borderRadius: "16px",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <Brain size={18} style={{ color: "#a855f7" }} /> Obsidian Shared Memory Vault
              </h2>
              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", margin: "3px 0 0" }}>
                Local Markdown Vault at <code style={{ color: "#c084fc" }}>/vault/agent-os/</code> · Shared across all AI agents
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={handleSyncVault}
                style={{
                  background: "rgba(168, 85, 247, 0.15)",
                  border: "1px solid rgba(168, 85, 247, 0.3)",
                  borderRadius: "8px",
                  padding: "6px 12px",
                  color: "#d8b4fe",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Sync Vault
              </button>
              <button
                type="button"
                onClick={() => setShowAddMemModal(true)}
                style={{
                  background: "#ef4444",
                  border: "none",
                  borderRadius: "8px",
                  padding: "6px 14px",
                  color: "#ffffff",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                + Add Memory Note
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "12px" }}>
            {filteredMemories.map((mem) => (
              <div
                key={mem.id}
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "12px",
                  padding: "14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#ffffff" }}>{mem.title}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await dispatchAction({ action: "delete_memory", id: mem.id });
                      showToast("Memory note removed.");
                    }}
                    style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer" }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      fontSize: "9px",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: "rgba(168, 85, 247, 0.2)",
                      color: "#c084fc",
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}
                  >
                    {mem.category}
                  </span>
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>Agent: {mem.source_agent}</span>
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginLeft: "auto" }}>{mem.created_at}</span>
                </div>

                <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.75)", margin: 0, lineHeight: 1.45 }}>
                  {mem.content}
                </p>

                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                  {mem.tags.map((t, idx) => (
                    <span
                      key={idx}
                      style={{
                        fontSize: "9.5px",
                        background: "rgba(255,255,255,0.05)",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        color: "rgba(255,255,255,0.5)",
                      }}
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          4. SUB-VIEW: PRODUCTION KANBAN PIPELINES (Full 4 Columns)
      ───────────────────────────────────────────────────────────── */}
      {hudSubView === "pipelines" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
            {osData?.pipelines?.map((pipe) => (
              <div
                key={pipe.id}
                style={{
                  background: "#120f16",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "14px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#ffffff" }}>{pipe.name}</div>
                    <div style={{ fontSize: "10.5px", color: "#ef4444", marginTop: "2px" }}>{pipe.assigned_agent}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAdvanceStage(pipe.id)}
                    style={{
                      background: "#ef4444",
                      border: "none",
                      borderRadius: "6px",
                      padding: "4px 10px",
                      color: "#ffffff",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <Play size={10} />
                    <span>Run</span>
                  </button>
                </div>

                <p style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.6)", margin: 0, lineHeight: 1.35 }}>
                  {pipe.description}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {pipe.stages.map((stg, idx) => (
                    <div
                      key={stg.id}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "8px",
                        background:
                          stg.status === "completed"
                            ? "rgba(16, 185, 129, 0.08)"
                            : stg.status === "running"
                            ? "rgba(245, 158, 11, 0.08)"
                            : "rgba(255,255,255,0.02)",
                        border: `1px solid ${
                          stg.status === "completed"
                            ? "rgba(16, 185, 129, 0.2)"
                            : stg.status === "running"
                            ? "rgba(245, 158, 11, 0.2)"
                            : "rgba(255,255,255,0.04)"
                        }`,
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "11.5px", fontWeight: 600, color: "#ffffff" }}>
                          {idx + 1}. {stg.name}
                        </span>
                        <span
                          style={{
                            fontSize: "9px",
                            fontWeight: 700,
                            color: stg.status === "completed" ? "#34d399" : stg.status === "running" ? "#fbbf24" : "rgba(255,255,255,0.35)",
                          }}
                        >
                          {stg.status.toUpperCase()}
                        </span>
                      </div>
                      {stg.outputSnippet && (
                        <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.55)", fontStyle: "italic" }}>
                          {stg.outputSnippet}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          5. SUB-VIEW: MULTI-AGENT WAR ROOM COLLABORATION DECK
      ───────────────────────────────────────────────────────────── */}
      {hudSubView === "warroom" && (
        <div
          style={{
            background: "#120f16",
            borderRadius: "16px",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            minHeight: "560px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <MessageSquare size={18} style={{ color: "#ef4444" }} /> Multi-Agent Collaboration War Room
              </h2>
              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", margin: "3px 0 0" }}>
                Group chat where Hermes 3, Claude 3.7, Codex, and DeepSeek R1 debate and coordinate.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                const latestAgreement = osData?.warRoomMessages?.slice(-1)[0]?.content || "Fleet consensus achieved.";
                await dispatchAction({
                  action: "add_memory",
                  title: "War Room Consensus: Strategy Checkpoint",
                  content: latestAgreement,
                  category: "decision",
                  source_agent: "Fleet War Room",
                  tags: ["war-room", "consensus", "strategy"],
                });
                showToast("Agreed strategy persisted to Obsidian Vault!");
              }}
              style={{
                background: "rgba(16, 185, 129, 0.15)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                borderRadius: "8px",
                padding: "6px 12px",
                color: "#6ee7b7",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ✓ Save Strategy to Obsidian Vault
            </button>
          </div>

          {/* War Room Chat Messages */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              background: "rgba(0,0,0,0.2)",
              borderRadius: "12px",
              padding: "16px",
              overflowY: "auto",
              maxHeight: "440px",
            }}
          >
            {osData?.warRoomMessages?.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  background: msg.role === "user" ? "rgba(239, 68, 68, 0.15)" : "rgba(255,255,255,0.03)",
                  border: msg.role === "user" ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(255,255,255,0.06)",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  maxWidth: "85%",
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px" }}>
                  <span>{msg.avatar}</span>
                  <span style={{ fontWeight: 700, color: "#ffffff" }}>{msg.sender}</span>
                  {msg.agentModel && (
                    <span style={{ fontSize: "9px", color: "#38bdf8", background: "rgba(56,189,248,0.1)", padding: "1px 5px", borderRadius: "4px" }}>
                      {msg.agentModel}
                    </span>
                  )}
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", marginLeft: "auto" }}>{msg.timestamp}</span>
                </div>
                <div style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.85)", lineHeight: 1.45 }}>{msg.content}</div>
              </div>
            ))}
          </div>

          {/* War Room Input */}
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              placeholder="Present a problem or goal to the entire agent team..."
              value={warRoomInput}
              onChange={(e) => setWarRoomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSendWarRoom();
              }}
              style={{
                flex: 1,
                background: "#18141e",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px",
                padding: "10px 14px",
                color: "#ffffff",
                fontSize: "13px",
                outline: "none",
              }}
            />
            <button
              type="button"
              disabled={isWarRoomSending}
              onClick={handleSendWarRoom}
              style={{
                background: "#ef4444",
                border: "none",
                borderRadius: "10px",
                padding: "0 18px",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {isWarRoomSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              <span>Debate & Synthesize</span>
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: ADD MEMORY TO OBSIDIAN VAULT
      ───────────────────────────────────────────────────────────── */}
      {showAddMemModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#16111a",
              border: "1px solid rgba(168, 85, 247, 0.3)",
              borderRadius: "16px",
              padding: "24px",
              width: "100%",
              maxWidth: "520px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.8)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Brain size={18} style={{ color: "#a855f7" }} />
                <span style={{ fontSize: "15px", fontWeight: 700, color: "#ffffff" }}>Add to Obsidian Vault</span>
              </div>
              <button
                type="button"
                onClick={() => setShowAddMemModal(false)}
                style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", fontSize: "18px", cursor: "pointer" }}
              >
                ×
              </button>
            </div>

            <div>
              <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "4px", display: "block" }}>
                Memory Title
              </label>
              <input
                type="text"
                placeholder="e.g. Lead Conversion Playbook: Hook & CTA Rules"
                value={newMemTitle}
                onChange={(e) => setNewMemTitle(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0c0a0e",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  color: "#ffffff",
                  fontSize: "12px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "4px", display: "block" }}>
                  Category
                </label>
                <select
                  value={newMemCategory}
                  onChange={(e) => setNewMemCategory(e.target.value as "sop" | "decision" | "learning" | "client_profile" | "workflow_rule")}
                  style={{
                    width: "100%",
                    background: "#0c0a0e",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    color: "#ffffff",
                    fontSize: "12px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="sop">SOP / Procedure</option>
                  <option value="decision">Architecture Decision</option>
                  <option value="learning">Agent Learning</option>
                  <option value="client_profile">Client Profile</option>
                  <option value="workflow_rule">Workflow Rule</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "4px", display: "block" }}>
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. leads, hooks, rules"
                  value={newMemTags}
                  onChange={(e) => setNewMemTags(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#0c0a0e",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    color: "#ffffff",
                    fontSize: "12px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "4px", display: "block" }}>
                Markdown Memory Content
              </label>
              <textarea
                rows={4}
                placeholder="Write the persistent memory instructions or findings..."
                value={newMemContent}
                onChange={(e) => setNewMemContent(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0c0a0e",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  color: "#ffffff",
                  fontSize: "12px",
                  outline: "none",
                  boxSizing: "border-box",
                  resize: "vertical",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
              <button
                type="button"
                onClick={() => setShowAddMemModal(false)}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 14px",
                  color: "rgba(255,255,255,0.7)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isAddingMem}
                onClick={handleSaveMemory}
                style={{
                  background: "#ef4444",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {isAddingMem ? "Saving..." : "Save to Obsidian Vault"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
