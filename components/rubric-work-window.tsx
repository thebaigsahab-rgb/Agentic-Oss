"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { generateQrSvg } from "@/lib/qr-code";
import { copyToClipboard } from "@/lib/clipboard";
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
  DollarSign,
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
} from "lucide-react";
import { WorkRepoExplorer } from "@/components/work-repo-explorer";
import type { PublicSettings } from "@/lib/types";
import type {
  ContentOsState,
  Source,
  Article,
  Draft,
  ScheduledPost,
  ExpenseItem,
  ContentTodayTask,
  ContentMail,
  ScraperJob,
  AgentProfile,
  MemoryNote,
  AgentWorkflowPipeline,
  WarRoomMessage,
  TokenOptimizationState,
  LocalModelBenchmark,
  McpServerStatus,
} from "@/lib/content-os-store";
import type { GitStatusResult } from "@/lib/server/git-service";
import { AgentOsMissionHud } from "@/components/agent-os-mission-hud";

export interface RubricWorkProps {
  settings?: PublicSettings;
  isStandalone?: boolean;
  onSwitchToDailyBrief?: () => void;
  onNavigateTab?: (tab: string) => void;
}

type WorkTabId = "hud" | "sources" | "feed" | "studio" | "schedule" | "scraper" | "repo" | "settings" | "mobile";

export function RubricWorkWindow({
  settings,
  isStandalone = false,
  onSwitchToDailyBrief,
  onNavigateTab,
}: RubricWorkProps) {
  // Navigation View
  const [activeView, setActiveView] = useState<WorkTabId>("hud");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [brandDropdownOpen, setBrandDropdownOpen] = useState(false);

  // Mobile pairing state
  const [localIp, setLocalIp] = useState("192.168.0.36");
  const [port, setPort] = useState("3000");
  const [copiedLink, setCopiedLink] = useState(false);
  const [qrMode, setQrMode] = useState<"desktop" | "work">("desktop");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPort(window.location.port || "3000");
      if (window.location.hostname && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        setLocalIp(window.location.hostname);
      }
    }
    fetch("/api/system")
      .then((r) => r.json())
      .then((d) => {
        if (d?.lanIp) setLocalIp(d.lanIp);
      })
      .catch(() => {});
  }, []);

  const fullDesktopUrl = `http://${localIp}:${port}/`;
  const remoteWorkUrl = `http://${localIp}:${port}/work`;
  const activePairUrl = qrMode === "desktop" ? fullDesktopUrl : remoteWorkUrl;
  const qrSvg = useMemo(() => generateQrSvg(activePairUrl, 5), [activePairUrl]);

  // State loaded from /api/work
  const [osData, setOsData] = useState<ContentOsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // HUD Task Input
  const [newTaskTitle, setNewTaskTitle] = useState("");

  // HUD Jarvis Assistant
  const [jarvisInput, setJarvisInput] = useState("");
  const [jarvisReply, setJarvisReply] = useState<string>("Greetings. I am J.A.R.V.I.S. Tap the globe to speak, or type an instruction.");
  const [jarvisState, setJarvisState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [chatLog, setChatLog] = useState<Array<{ role: "user" | "assistant"; content: string; time: string }>>([
    { role: "assistant", content: "Agentic OS online. Monitoring content feeds, task boards, and background scraper workers.", time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
  ]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // 3D Canvas ref
  const globeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Sources View State
  const [researchQuery, setResearchQuery] = useState("");
  const [researchDepth, setResearchDepth] = useState<"sonar" | "sonar-pro">("sonar");
  const [showAdvSource, setShowAdvSource] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [sourceType, setSourceType] = useState<Source["type"]>("research");
  const [sourceInterval, setSourceInterval] = useState(6);
  const [sourceUnit, setSourceUnit] = useState<"hours" | "days" | "months">("hours");
  const [sourceTags, setSourceTags] = useState("");
  const [sourceFreshness, setSourceFreshness] = useState<string>("");

  // Feed View State
  const [bypassFreshness, setBypassFreshness] = useState(false);
  const [feedFilter, setFeedFilter] = useState<string>("active");
  const [rankingInProgress, setRankingInProgress] = useState(false);

  // Studio View State
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  const [researchCardToggle, setResearchCardToggle] = useState(true);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refineBusy, setRefineBusy] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);

  // Schedule Modal
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledPlatforms, setScheduledPlatforms] = useState<Array<"instagram" | "linkedin" | "twitter">>(["linkedin", "twitter"]);
  const [scheduleDatetime, setScheduleDatetime] = useState<string>("");

  // Scraper View State
  const [scrapeUrlInput, setScrapeUrlInput] = useState("https://news.ycombinator.com/best");
  const [proxyMode, setProxyMode] = useState<"direct" | "nodemaven">("nodemaven");
  const [antiBotMode, setAntiBotMode] = useState(true);
  const [runningScraper, setRunningScraper] = useState(false);

  // Agent OS Sub-views & Features State
  const [hudSubView, setHudSubView] = useState<"mission" | "agents" | "memory" | "pipelines" | "warroom">("mission");
  const [memorySearch, setMemorySearch] = useState("");
  const [selectedMemoryCategory, setSelectedMemoryCategory] = useState<string>("all");
  const [showAddMemoryModal, setShowAddMemoryModal] = useState(false);
  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemContent, setNewMemContent] = useState("");
  const [newMemCat, setNewMemCat] = useState<"sop" | "decision" | "learning" | "client_profile" | "workflow_rule">("learning");
  const [newMemTags, setNewMemTags] = useState("agent-os, routing");
  const [warRoomInput, setWarRoomInput] = useState("");
  const [sendingWarRoom, setSendingWarRoom] = useState(false);
  const [activePipelineId, setActivePipelineId] = useState<string>("pipe_seo");
  const [coreMode, setCoreMode] = useState<"voice" | "warroom">("voice");
  const [runningStageId, setRunningStageId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("hermes");
  const [expandedMemoryId, setExpandedMemoryId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Fetch full state from backend
  const fetchState = async () => {
    try {
      const res = await fetch("/api/work");
      const json = await res.json();
      if (json.ok && json.data) {
        setOsData(json.data);
        if (json.git) setGitStatus(json.git);
        setQueueCount(json.queue || 0);
        if (!activeDraftId && json.data.drafts?.length > 0) {
          setActiveDraftId(json.data.drafts[0].id);
          setDraftCaption(json.data.drafts[0].caption || "");
        }
      }
    } catch (err) {
      console.error("Failed to load Agentic OS state", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 15000);
    return () => clearInterval(interval);
  }, []);

  // Sync draft caption when active draft changes
  useEffect(() => {
    if (osData?.drafts && activeDraftId) {
      const d = osData.drafts.find((item) => item.id === activeDraftId);
      if (d) setDraftCaption(d.caption || "");
    }
  }, [activeDraftId, osData]);

  // Dispatch work actions
  const dispatchAction = async (payload: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchState();
        return data;
      } else {
        showToast(data.error || "Action failed");
      }
    } catch (err) {
      showToast("Network request failed");
    }
    return null;
  };

  // -------------------------------------------------------------
  // 3D Canvas Globe & Audio-Reactive Visualizer
  // -------------------------------------------------------------
  useEffect(() => {
    const canvas = globeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let angleY = 0;
    const radius = 105;
    const nodeCount = 55;
    const nodes: Array<{ x: number; y: number; z: number; origY: number }> = [];

    // Generate spherical points
    for (let i = 0; i < nodeCount; i++) {
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = 2 * Math.PI * Math.random();
      nodes.push({
        x: radius * Math.sin(theta) * Math.cos(phi),
        y: radius * Math.sin(theta) * Math.sin(phi),
        z: radius * Math.cos(theta),
        origY: radius * Math.sin(theta) * Math.sin(phi),
      });
    }

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      // Rotate angle speed depends on state
      const speed = jarvisState === "thinking" ? 0.045 : jarvisState === "speaking" ? 0.025 : 0.008;
      angleY += speed;

      // Draw concentric audio pulse rings (from Vivek Mishra's HUD)
      const pulseMultiplier = 1 + micLevel * 0.45;
      for (let r = 1; r <= 3; r++) {
        const ringRadius = radius * 1.18 + r * 14 * pulseMultiplier;
        ctx.beginPath();
        ctx.ellipse(cx, cy, ringRadius, ringRadius * 0.38, Math.PI / 10, 0, Math.PI * 2);
        ctx.strokeStyle = jarvisState === "listening"
          ? `rgba(56, 189, 248, ${0.45 - r * 0.12})`
          : jarvisState === "thinking"
          ? `rgba(244, 63, 94, ${0.6 - r * 0.15})`
          : `rgba(239, 68, 68, ${0.35 - r * 0.1})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Draw dark core sphere
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.95, 0, Math.PI * 2);
      ctx.fillStyle = "#0c0a0c";
      ctx.fill();

      // Draw wireframe latitude rings
      for (let lat = -3; lat <= 3; lat++) {
        const latY = (lat / 3.5) * radius * 0.85;
        const latRadius = Math.sqrt(Math.max(0, radius * radius - latY * latY));
        ctx.beginPath();
        ctx.ellipse(cx, cy + latY, latRadius, latRadius * 0.28, Math.PI / 14, 0, Math.PI * 2);
        ctx.strokeStyle = jarvisState === "listening" ? "rgba(255, 255, 255, 0.4)" : "rgba(239, 68, 68, 0.32)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw wireframe longitude ellipses
      for (let lon = 0; lon < 6; lon++) {
        const rad = (lon * Math.PI) / 6 + angleY;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(Math.cos(rad)) * radius, radius, Math.PI / 16, 0, Math.PI * 2);
        ctx.strokeStyle = jarvisState === "listening" ? "rgba(255, 255, 255, 0.35)" : "rgba(239, 68, 68, 0.28)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw glowing 3D nodes
      for (const n of nodes) {
        // Rotate around Y
        const cosA = Math.cos(angleY);
        const sinA = Math.sin(angleY);
        const rotX = n.x * cosA - n.z * sinA;
        const rotZ = n.x * sinA + n.z * cosA;

        // Perspective scale
        const scale = 320 / (320 + rotZ);
        const projX = cx + rotX * scale;
        const projY = cy + n.y * scale;

        if (rotZ > -radius * 0.7) {
          ctx.beginPath();
          const pSize = Math.max(1.2, 2.5 * scale * (1 + micLevel * 0.3));
          ctx.arc(projX, projY, pSize, 0, Math.PI * 2);
          ctx.fillStyle = rotZ > 20 ? "#ffffff" : "rgba(239, 68, 68, 0.85)";
          ctx.shadowBlur = rotZ > 20 ? 8 : 0;
          ctx.shadowColor = "#ef4444";
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [jarvisState, micLevel]);

  // Voice recognition & speech
  const toggleVoiceAssistant = () => {
    if (isListening) {
      setIsListening(false);
      setJarvisState("idle");
      return;
    }

    const win = typeof window !== "undefined" ? (window as unknown as Record<string, any>) : {};
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      showToast("Speech recognition not supported in this browser. Type below!");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
        setJarvisState("listening");
        setMicLevel(0.8);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setMicLevel(0.2);
        setIsListening(false);
        handleSendJarvis(transcript);
      };

      recognition.onerror = () => {
        setIsListening(false);
        setJarvisState("idle");
        setMicLevel(0);
      };

      recognition.onend = () => {
        setIsListening(false);
        setMicLevel(0);
      };

      recognition.start();
    } catch {
      setIsListening(false);
      setJarvisState("idle");
    }
  };

  const handleSendJarvis = async (customPrompt?: string) => {
    const text = (customPrompt || jarvisInput).trim();
    if (!text) return;
    setJarvisInput("");
    setJarvisState("thinking");

    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setChatLog((prev) => [...prev, { role: "user", content: text, time }]);

    try {
      // Check if command relates to Work OS actions
      const lower = text.toLowerCase();
      let responseText = "";

      if (lower.includes("research") || lower.includes("find latest")) {
        const query = text.replace(/research|find latest|look up/gi, "").trim() || "latest AI systems";
        await dispatchAction({ action: "research_now", query, depth: "sonar-pro" });
        responseText = `Executed deep Perplexity Sonar research for '${query}'. 2 high-priority dossiers synthesized and injected into your Priority Feed.`;
      } else if (lower.includes("rank") || lower.includes("score")) {
        await dispatchAction({ action: "rank_feed" });
        responseText = "AI priority ranker executed across all active feed sources. Articles re-scored 0–100 by signal-to-noise ratio.";
      } else if (lower.includes("task") && (lower.includes("add") || lower.includes("new"))) {
        const title = text.replace(/add task|new task|add a task for today/gi, "").trim() || "Review agentic pipeline";
        await dispatchAction({ action: "add_task", title });
        responseText = `Task added to Today's Board: "${title}".`;
      } else if (lower.includes("post") || lower.includes("draft") || lower.includes("generate post")) {
        if (osData?.articles && osData.articles.length > 0) {
          const draft = await dispatchAction({ action: "make_post", articleId: osData.articles[0].id });
          responseText = `Created new Content Studio draft: "${draft.draft.title}". You can refine or schedule it immediately in the Studio tab.`;
        } else {
          responseText = "No un-drafted articles found in the feed. Run a research query first!";
        }
      } else {
        // General conversational call with streaming SSE support
        const res = await fetch("/api/jarvis/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: text }],
            mode: "chat",
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          }),
        });

        if (!res.ok) {
          throw new Error(`Chat API responded with status ${res.status}`);
        }

        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("text/event-stream") && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let accumulated = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data: ")) continue;
              const jsonStr = trimmed.slice(6).trim();
              if (!jsonStr) continue;

              try {
                const ev = JSON.parse(jsonStr);
                if (ev.type === "text_delta" && ev.text) {
                  accumulated += ev.text;
                  setJarvisReply(accumulated);
                } else if (ev.type === "error" && ev.message) {
                  accumulated = ev.message;
                  setJarvisReply(accumulated);
                }
              } catch {
                // Ignore SSE chunk parse anomalies
              }
            }
          }
          responseText = accumulated.trim() || "Command executed autonomously, Sir.";
        } else {
          const d = await res.json().catch(() => ({}));
          responseText = d.reply || d.message || "Command executed autonomously, Sir.";
        }
      }

      setJarvisReply(responseText);
      setChatLog((prev) => [...prev, { role: "assistant", content: responseText, time }]);
      setJarvisState("speaking");

      // Speak response if browser TTS is available
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(responseText.slice(0, 200));
        u.onend = () => setJarvisState("idle");
        u.onerror = () => setJarvisState("idle");
        window.speechSynthesis.speak(u);
      } else {
        setTimeout(() => setJarvisState("idle"), 2500);
      }
    } catch {
      setJarvisReply("I encountered an error executing that request.");
      setJarvisState("idle");
    }
  };

  return (
    <div
      style={{
        display: "flex",
        minHeight: isStandalone ? "100vh" : "860px",
        background: "#030305",
        color: "#f3f4f6",
        fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* ── WORK OS DEDICATED DARK OBSIDIAN SLIDE BAR ── */}
      <aside
        style={{
          width: sidebarCollapsed ? "0px" : "250px",
          minWidth: sidebarCollapsed ? "0px" : "250px",
          maxWidth: sidebarCollapsed ? "0px" : "250px",
          overflow: "hidden",
          background: "linear-gradient(180deg, #050407 0%, #07060b 100%)",
          borderRight: sidebarCollapsed ? "none" : "1px solid rgba(255, 255, 255, 0.06)",
          display: "flex",
          flexDirection: "column",
          transition: "width 0.22s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.22s cubic-bezier(0.16, 1, 0.3, 1), max-width 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
          zIndex: 45,
          userSelect: "none",
        }}
      >
        {/* Slide Bar Header Lockup */}
        <div
          style={{
            padding: "16px 14px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: sidebarCollapsed ? "center" : "space-between",
            gap: "10px",
          }}
        >
          <div style={{ position: "relative" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                cursor: "pointer",
                overflow: "hidden",
              }}
              onClick={() => setBrandDropdownOpen((p) => !p)}
              title="Click to switch between Work OS and Daily Brief"
            >
              <div
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "9px",
                  background: "linear-gradient(135deg, #ef4444 0%, #991b1b 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "17px",
                  fontWeight: 800,
                  color: "#ffffff",
                  boxShadow: "0 0 16px rgba(239, 68, 68, 0.4)",
                  flexShrink: 0,
                }}
              >
                ◎
              </div>
              {!sidebarCollapsed && (
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, letterSpacing: "-0.02em", color: "#ffffff", whiteSpace: "nowrap" }}>
                      WORK OS
                    </span>
                    <ChevronDown size={13} style={{ color: "rgba(255, 255, 255, 0.6)", transform: brandDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
                  </div>
                  <span style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.4)", whiteSpace: "nowrap" }}>
                    Content &amp; Git Studio
                  </span>
                </div>
              )}
            </div>

            {brandDropdownOpen && !sidebarCollapsed && (
              <div
                style={{
                  position: "absolute",
                  top: "48px",
                  left: 0,
                  width: "220px",
                  background: "#14101b",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  borderRadius: "10px",
                  padding: "6px",
                  zIndex: 100,
                  boxShadow: "0 16px 36px rgba(0, 0, 0, 0.8)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setBrandDropdownOpen(false);
                    if (onSwitchToDailyBrief) onSwitchToDailyBrief();
                    else window.location.href = "/";
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "none",
                    background: "transparent",
                    color: "rgba(255, 255, 255, 0.8)",
                    fontSize: "12px",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <LayoutDashboard size={14} style={{ color: "#ef4444" }} />
                  <div>
                    <div style={{ fontWeight: 600, color: "#ffffff" }}>Daily Brief</div>
                    <div style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.45)" }}>Main Control Center</div>
                  </div>
                </button>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#ffffff",
                    fontSize: "12px",
                  }}
                >
                  <Briefcase size={14} style={{ color: "#f97316" }} />
                  <div>
                    <div style={{ fontWeight: 700 }}>Work OS (Active)</div>
                    <div style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.5)" }}>Obsidian Content &amp; Repo</div>
                  </div>
                  <Check size={14} style={{ color: "#ef4444", marginLeft: "auto" }} />
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? "Expand Slide Bar" : "Collapse Slide Bar"}
            style={{
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "6px",
              color: "rgba(255, 255, 255, 0.6)",
              cursor: "pointer",
              padding: "5px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Slide Bar Nav: Only Dashboard Tab */}
        <nav
          style={{
            flex: 1,
            padding: "14px 10px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            overflowY: "auto",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveView("hud")}
            title={sidebarCollapsed ? "Dashboard" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: sidebarCollapsed ? "center" : "space-between",
              gap: "10px",
              padding: sidebarCollapsed ? "10px 0" : "10px 12px",
              borderRadius: "8px",
              border: activeView === "hud" ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid transparent",
              background: activeView === "hud" ? "linear-gradient(135deg, rgba(239, 68, 68, 0.22) 0%, rgba(185, 28, 28, 0.16) 100%)" : "rgba(255, 255, 255, 0.03)",
              color: activeView === "hud" ? "#ffffff" : "rgba(255, 255, 255, 0.75)",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              transition: "all 0.15s ease",
              textAlign: "left",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <LayoutDashboard size={17} style={{ color: "#ef4444", flexShrink: 0 }} />
              {!sidebarCollapsed && <span>Dashboard</span>}
            </div>
            {!sidebarCollapsed && (
              <span
                style={{
                  fontSize: "10.5px",
                  padding: "2px 7px",
                  borderRadius: "10px",
                  background: "rgba(239, 68, 68, 0.25)",
                  color: "#ef4444",
                  fontWeight: 700,
                }}
              >
                HUD
              </span>
            )}
          </button>

          {/* Compact Git & Runtime Info in Slide Bar */}
          {!sidebarCollapsed && gitStatus && (
            <div
              style={{
                marginTop: "auto",
                marginBottom: "8px",
                padding: "10px",
                background: "rgba(0, 0, 0, 0.35)",
                border: "1px solid rgba(255, 255, 255, 0.06)",
                borderRadius: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                fontSize: "11px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "rgba(255, 255, 255, 0.5)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <GitBranch size={12} style={{ color: "#f97316" }} />
                  <span style={{ color: "#ffffff", fontWeight: 600 }}>{gitStatus.branch || "main"}</span>
                </div>
                <span style={{ color: "rgba(255, 255, 255, 0.4)" }}>{gitStatus.totalCommits || 0} commits</span>
              </div>
              {gitStatus.latestCommit && (
                <div style={{ color: "rgba(255, 255, 255, 0.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={gitStatus.latestCommit.message}>
                  {gitStatus.latestCommit.shortHash}: {gitStatus.latestCommit.message}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Slide Bar Footer */}
        <div
          style={{
            padding: "14px",
            borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {!sidebarCollapsed && (
            <div
              style={{
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid rgba(255, 255, 255, 0.06)",
                borderRadius: "8px",
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: "11px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "rgba(255, 255, 255, 0.6)" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981" }} />
                <span>Engine Active</span>
              </div>
              <span style={{ color: "#ef4444", fontWeight: 700 }}>Q: {queueCount}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (onSwitchToDailyBrief) onSwitchToDailyBrief();
              else window.location.href = "/";
            }}
            title="Switch back to Daily Brief & Control Center (Same Tab)"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: sidebarCollapsed ? "center" : "flex-start",
              gap: "8px",
              padding: sidebarCollapsed ? "8px 0" : "8px 10px",
              borderRadius: "8px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              color: "#fca5a5",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              width: "100%",
              textAlign: "left",
            }}
          >
            <ArrowRight size={13} style={{ transform: "rotate(180deg)", flexShrink: 0, color: "#ef4444" }} />
            {!sidebarCollapsed && <span>⮌ Daily Brief</span>}
          </button>
        </div>
      </aside>

      {/* ── WORK OS MAIN WORKSPACE CONTENT ── */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          height: isStandalone ? "100vh" : "860px",
          overflowY: "auto",
          background: "#030305",
        }}
      >
        {/* Sleek Top Ambient Status Bar */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 24px",
            background: "rgba(6, 5, 10, 0.8)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            position: "sticky",
            top: 0,
            zIndex: 40,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
              Work Workspace
            </span>
            <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>/</span>
            <span style={{ fontSize: "12px", color: "#ffffff", fontWeight: 600, textTransform: "capitalize" }}>
              {activeView === "hud" ? "Command HUD Dashboard" : activeView}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={fetchState}
              disabled={loading}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 10px",
                borderRadius: "6px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                color: "rgba(255, 255, 255, 0.7)",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              <RefreshCw size={12} className={loading ? "spin" : ""} />
              <span>Sync State</span>
            </button>
            <span
              style={{
                fontSize: "11px",
                padding: "4px 10px",
                borderRadius: "6px",
                background: "rgba(16, 185, 129, 0.12)",
                color: "#10b981",
                border: "1px solid rgba(16, 185, 129, 0.25)",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981" }} />
              Local-First Synced
            </span>
          </div>
        </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            background: "#1f1d24",
            color: "#ffffff",
            padding: "10px 18px",
            borderRadius: "10px",
            border: "1px solid rgba(239,68,68,0.4)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.8)",
            zIndex: 100,
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          {toastMessage}
        </div>
      )}

        {/* ── UNIFIED TOP DASHBOARD FEATURE SWITCHER ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 20px",
            background: "linear-gradient(90deg, rgba(12, 10, 16, 0.98) 0%, rgba(18, 14, 24, 0.98) 100%)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            gap: "10px",
            position: "sticky",
            top: "49px",
            zIndex: 35,
            backdropFilter: "blur(12px)",
            flexWrap: "wrap",
          }}
        >
          {/* Left: View Tabs / Dashboard Feature Switcher */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? "Open OS Slide Bar" : "Collapse OS Slide Bar"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "6px 10px",
                borderRadius: "8px",
                background: sidebarCollapsed ? "rgba(239, 68, 68, 0.12)" : "rgba(255, 255, 255, 0.04)",
                border: sidebarCollapsed ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(255, 255, 255, 0.08)",
                color: sidebarCollapsed ? "#fca5a5" : "rgba(255, 255, 255, 0.7)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                marginRight: "4px",
                transition: "all 0.15s ease",
              }}
            >
              {sidebarCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
              <span>{sidebarCollapsed ? "OS Apps" : "Collapse"}</span>
            </button>

            {[
              { id: "hud" as const, label: "Dashboard", icon: GlobeIcon, badge: "HUD" },
              { id: "sources" as const, label: "Sources", icon: Sliders, badge: `${osData?.sources?.length || 0}` },
              { id: "feed" as const, label: "Priority Feed", icon: TrendingUp, badge: `${osData?.articles?.length || 0}` },
              { id: "studio" as const, label: "Studio", icon: Layers, badge: `${osData?.drafts?.length || 0}` },
              { id: "schedule" as const, label: "Schedule", icon: Calendar, badge: `${osData?.scheduled?.length || 0}` },
              { id: "scraper" as const, label: "Scraper", icon: Terminal, badge: `${osData?.scraperJobs?.length || 0}` },
              { id: "repo" as const, label: "GitHub Repo", icon: FolderGit2, badge: gitStatus?.branch || "main" },
              { id: "settings" as const, label: "Settings", icon: SettingsIcon, badge: undefined },
              { id: "mobile" as const, label: "Mobile Sync", icon: Smartphone, badge: "QR" },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveView(tab.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    background: isActive ? "linear-gradient(135deg, rgba(239, 68, 68, 0.28) 0%, rgba(185, 28, 28, 0.22) 100%)" : "rgba(255, 255, 255, 0.04)",
                    border: isActive ? "1px solid rgba(239, 68, 68, 0.45)" : "1px solid rgba(255, 255, 255, 0.06)",
                    color: isActive ? "#ffffff" : "rgba(255, 255, 255, 0.65)",
                    fontSize: "12px",
                    fontWeight: isActive ? 600 : 500,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Icon size={14} style={{ color: isActive ? "#ef4444" : "rgba(255, 255, 255, 0.5)" }} />
                  <span>{tab.label}</span>
                  {tab.badge && (
                    <span
                      style={{
                        fontSize: "9.5px",
                        padding: "1px 5px",
                        borderRadius: "10px",
                        background: isActive ? "rgba(239, 68, 68, 0.3)" : "rgba(255, 255, 255, 0.08)",
                        color: isActive ? "#ffffff" : "rgba(255, 255, 255, 0.5)",
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

          {/* Right: Quick Jump Back to Daily Brief in Same Window */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              onClick={() => {
                if (onSwitchToDailyBrief) onSwitchToDailyBrief();
                else window.location.href = "/";
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 13px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, rgba(239, 68, 68, 0.18) 0%, rgba(220, 38, 38, 0.18) 100%)",
                border: "1px solid rgba(239, 68, 68, 0.35)",
                color: "#fca5a5",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
              title="Return to Daily Brief & Control Center (Same Tab)"
            >
              <LayoutDashboard size={14} style={{ color: "#ef4444" }} />
              <span>⮌ Daily Brief</span>
            </button>
          </div>
        </div>

      {/* ─────────────────────────────────────────────────────────────
          1. DASHBOARD / HUD VIEW (Agent OS Mission Control Cockpit)
      ───────────────────────────────────────────────────────────── */}
      {activeView === "hud" && (
        <AgentOsMissionHud
          osData={osData}
          dispatchAction={dispatchAction}
          showToast={showToast}
          globeCanvasRef={globeCanvasRef}
          jarvisState={jarvisState}
          jarvisReply={jarvisReply}
          toggleVoiceAssistant={toggleVoiceAssistant}
          setActiveView={(v) => setActiveView(v as WorkTabId)}
          gitStatus={gitStatus}
        />
      )}

      {/* ─────────────────────────────────────────────────────────────
          2. SOURCES VIEW (Perplexity + Firecrawl + RSS)
      ───────────────────────────────────────────────────────────── */}
      {activeView === "sources" && (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "380px 1fr", gap: "20px", padding: "24px", maxWidth: "1600px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          {/* Left: Add / Research Source */}
          <div style={{ background: "#120f16", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.08)", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Research a topic</h2>
            <div>
              <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "6px", display: "block" }}>What should I research?</label>
              <input
                type="text"
                placeholder="e.g. latest AI agent launches 2026"
                value={researchQuery}
                onChange={(e) => setResearchQuery(e.target.value)}
                style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "10px", color: "#ffffff", fontSize: "13px", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={async () => {
                  if (!researchQuery) return showToast("Please enter a research topic.");
                  showToast("Researching web with Perplexity Sonar...");
                  await dispatchAction({ action: "research_now", query: researchQuery, depth: researchDepth });
                  setResearchQuery("");
                  showToast("Research complete. Added to priority feed!");
                  setActiveView("feed");
                }}
                style={{ flex: 1, background: "#ef4444", border: "none", borderRadius: "8px", padding: "10px", color: "#ffffff", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
              >
                Research now
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!researchQuery) return showToast("Enter topic or URL.");
                  await dispatchAction({
                    action: "add_source",
                    source: {
                      name: sourceName || researchQuery,
                      url: researchQuery,
                      type: sourceType,
                      interval_value: sourceInterval,
                      interval_unit: sourceUnit,
                      topic_tags: sourceTags.split(",").map((t) => t.trim()).filter(Boolean),
                      freshness_override_hours: sourceFreshness ? Number(sourceFreshness) : null,
                      enabled: true,
                      cron_expression: null,
                      research_depth: researchDepth,
                      last_run_at: null,
                      next_run_at: new Date(Date.now() + 3600000 * sourceInterval).toISOString(),
                      last_status: null,
                    },
                  });
                  setResearchQuery("");
                  showToast("Source saved & scheduled.");
                }}
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "10px 14px", color: "#ffffff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
              >
                Save &amp; schedule
              </button>
            </div>

            {/* Advanced Toggle */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: "14px" }}>
              <button
                type="button"
                onClick={() => setShowAdvSource(!showAdvSource)}
                style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
              >
                {showAdvSource ? "▲ Hide Advanced Options" : "▼ Advanced Scheduling & Depth"}
              </button>

              {showAdvSource && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "14px" }}>
                  <div>
                    <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Display Name (optional)</label>
                    <input
                      type="text"
                      placeholder="Custom source title"
                      value={sourceName}
                      onChange={(e) => setSourceName(e.target.value)}
                      style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px", color: "#ffffff", fontSize: "12px", boxSizing: "border-box" }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Source Type</label>
                    <select
                      value={sourceType}
                      onChange={(e) => setSourceType(e.target.value as Source["type"])}
                      style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px", color: "#ffffff", fontSize: "12px" }}
                    >
                      <option value="research">Auto-research (Perplexity Sonar)</option>
                      <option value="auto">Auto-detect (RSS, else Firecrawl)</option>
                      <option value="rss">RSS / Atom feed</option>
                      <option value="url">Single page (Firecrawl)</option>
                      <option value="search">Web search (Firecrawl)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Research Depth</label>
                    <select
                      value={researchDepth}
                      onChange={(e) => setResearchDepth(e.target.value as "sonar" | "sonar-pro")}
                      style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px", color: "#ffffff", fontSize: "12px" }}
                    >
                      <option value="sonar">Sonar — Fast &amp; cheap</option>
                      <option value="sonar-pro">Sonar Pro — Deep synthesis</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Interval</label>
                      <input
                        type="number"
                        min="1"
                        value={sourceInterval}
                        onChange={(e) => setSourceInterval(Number(e.target.value))}
                        style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px", color: "#ffffff", fontSize: "12px", boxSizing: "border-box" }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Unit</label>
                      <select
                        value={sourceUnit}
                        onChange={(e) => setSourceUnit(e.target.value as "hours" | "days" | "months")}
                        style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px", color: "#ffffff", fontSize: "12px" }}
                      >
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                        <option value="months">Months</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Topic Tags (comma-separated)</label>
                    <input
                      type="text"
                      placeholder="AI, Autonomous Agents, LLM"
                      value={sourceTags}
                      onChange={(e) => setSourceTags(e.target.value)}
                      style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px", color: "#ffffff", fontSize: "12px", boxSizing: "border-box" }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Active Sources List */}
          <div style={{ background: "#120f16", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.08)", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Active Sources</h2>
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)" }}>
                {osData?.sources?.length || 0} source(s) monitored
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {osData?.sources?.map((s) => (
                <div
                  key={s.id}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    padding: "14px 16px",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "#ffffff", display: "flex", alignItems: "center", gap: "8px" }}>
                        {s.name}
                        {s.last_status && (
                          <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: s.last_status === "success" ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)", color: s.last_status === "success" ? "#10b981" : "#ef4444" }}>
                            {s.last_status}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", marginTop: "2px" }}>{s.url}</div>
                    </div>

                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        onClick={async () => {
                          showToast(`Running source '${s.name}'...`);
                          await dispatchAction({ action: "research_now", query: s.url, depth: s.research_depth });
                          showToast("Scrape & research complete.");
                        }}
                        style={{ background: "#ef4444", border: "none", borderRadius: "6px", color: "#ffffff", padding: "5px 10px", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}
                      >
                        Run
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatchAction({ action: "toggle_source", id: s.id, enabled: !s.enabled })}
                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#ffffff", padding: "5px 10px", fontSize: "11px", cursor: "pointer" }}
                      >
                        {s.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatchAction({ action: "delete_source", id: s.id })}
                        style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", padding: "4px" }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    <span style={{ fontSize: "10px", background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: "4px" }}>
                      type: {s.type}
                    </span>
                    <span style={{ fontSize: "10px", background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: "4px" }}>
                      every {s.interval_value} {s.interval_unit}
                    </span>
                    {s.topic_tags.map((t, tidx) => (
                      <span key={tidx} style={{ fontSize: "10px", background: "rgba(239,68,68,0.15)", color: "#ef4444", padding: "2px 8px", borderRadius: "4px" }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          3. PRIORITY FEED VIEW (0-100 AI Score & Make Post)
      ───────────────────────────────────────────────────────────── */}
      {activeView === "feed" && (
        <div style={{ flex: 1, padding: "24px", maxWidth: "1600px", margin: "0 auto", width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Controls Bar */}
          <div style={{ background: "#120f16", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Priority Feed</h2>
              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", margin: "2px 0 0" }}>
                AI-ranked 0–100 matching your niche keywords.
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={bypassFreshness}
                  onChange={(e) => setBypassFreshness(e.target.checked)}
                />
                <span>Bypass freshness</span>
              </label>

              <select
                value={feedFilter}
                onChange={(e) => setFeedFilter(e.target.value)}
                style={{ background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 10px", color: "#ffffff", fontSize: "12px" }}
              >
                <option value="active">Active</option>
                <option value="new">New only</option>
                <option value="shortlisted">Shortlisted</option>
                <option value="used">Used</option>
                <option value="dismissed">Dismissed</option>
              </select>

              <button
                type="button"
                onClick={async () => {
                  setRankingInProgress(true);
                  showToast("AI scoring pending articles 0–100...");
                  await dispatchAction({ action: "rank_feed" });
                  setRankingInProgress(false);
                  showToast("Priority scoring updated.");
                }}
                style={{ background: "#ef4444", border: "none", borderRadius: "8px", padding: "8px 14px", color: "#ffffff", fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
              >
                {rankingInProgress ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                Rank now
              </button>

              <button
                type="button"
                onClick={fetchState}
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px 12px", color: "#ffffff", fontSize: "12px", cursor: "pointer" }}
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Feed List */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {osData?.articles?.map((art) => (
              <div
                key={art.id}
                style={{
                  background: "#120f16",
                  borderRadius: "14px",
                  border: "1px solid rgba(255,255,255,0.07)",
                  padding: "18px 20px",
                  display: "grid",
                  gridTemplateColumns: "64px 1fr 180px",
                  gap: "18px",
                  alignItems: "center",
                }}
              >
                {/* 0-100 Score Badge */}
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "12px",
                    background: art.priority_score >= 80 ? "rgba(16,185,129,0.15)" : art.priority_score < 50 ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
                    border: `1px solid ${art.priority_score >= 80 ? "#10b981" : art.priority_score < 50 ? "#ef4444" : "#f59e0b"}`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span style={{ fontSize: "18px", fontWeight: 800, color: art.priority_score >= 80 ? "#10b981" : art.priority_score < 50 ? "#ef4444" : "#f59e0b" }}>
                    {art.priority_score}
                  </span>
                  <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.5)" }}>SCORE</span>
                </div>

                {/* Body */}
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <a
                    href={art.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "15px", fontWeight: 600, color: "#ffffff", textDecoration: "none" }}
                  >
                    {art.title} ↗
                  </a>
                  <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.65)", lineHeight: 1.4 }}>
                    {art.summary}
                  </div>
                  {art.priority_reason && (
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>
                      Reason: {art.priority_reason}
                    </div>
                  )}
                  {art.suggested_angle && (
                    <div style={{ fontSize: "11px", color: "#38bdf8" }}>
                      ↳ Angle: {art.suggested_angle}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                    {art.topic_tags.map((t, idx) => (
                      <span key={idx} style={{ fontSize: "10px", background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: "4px", color: "rgba(255,255,255,0.6)" }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={async () => {
                      showToast("Generating caption & sending to Studio...");
                      const d = await dispatchAction({ action: "make_post", articleId: art.id });
                      if (d?.draft) {
                        setActiveDraftId(d.draft.id);
                        setActiveView("studio");
                      }
                    }}
                    style={{ background: "#ef4444", border: "none", borderRadius: "8px", padding: "8px", color: "#ffffff", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
                  >
                    Make post →
                  </button>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      type="button"
                      onClick={() => dispatchAction({ action: "set_article_status", id: art.id, status: "shortlisted" })}
                      style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", color: "#ffffff", padding: "6px", fontSize: "10px", cursor: "pointer" }}
                    >
                      Shortlist
                    </button>
                    <button
                      type="button"
                      onClick={() => dispatchAction({ action: "set_article_status", id: art.id, status: "dismissed" })}
                      style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", color: "rgba(255,255,255,0.4)", padding: "6px", fontSize: "10px", cursor: "pointer" }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          4. STUDIO VIEW (Caption, 4:3 Image Gen, AI Refine)
      ───────────────────────────────────────────────────────────── */}
      {activeView === "studio" && (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "300px 1fr", gap: "20px", padding: "24px", maxWidth: "1600px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          {/* Left Drafts Sidebar */}
          <div style={{ background: "#120f16", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.08)", padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, margin: 0 }}>Drafts ({osData?.drafts?.length || 0})</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto" }}>
              {osData?.drafts?.map((d) => (
                <div
                  key={d.id}
                  onClick={() => setActiveDraftId(d.id)}
                  style={{
                    background: activeDraftId === d.id ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${activeDraftId === d.id ? "#ef4444" : "rgba(255,255,255,0.06)"}`,
                    padding: "12px",
                    borderRadius: "10px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {d.title}
                  </div>
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.45)" }}>
                    {d.status} · {new Date(d.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Studio Workspace */}
          {activeDraftId ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "20px" }}>
              {/* Editor Column */}
              <div style={{ background: "#120f16", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.08)", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: "6px", display: "block" }}>
                    Post Caption
                  </label>
                  <textarea
                    rows={9}
                    value={draftCaption}
                    onChange={(e) => setDraftCaption(e.target.value)}
                    style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "12px", color: "#ffffff", fontSize: "13px", lineHeight: 1.5, resize: "vertical", boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
                    <button
                      type="button"
                      onClick={async () => {
                        await dispatchAction({ action: "save_caption", id: activeDraftId, caption: draftCaption });
                        showToast("Caption saved.");
                      }}
                      style={{ background: "#ef4444", border: "none", borderRadius: "6px", padding: "6px 14px", color: "#ffffff", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}
                    >
                      Save Caption
                    </button>
                  </div>
                </div>

                {/* Image Generation Controls */}
                <div style={{ background: "#18141e", padding: "16px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700 }}>Editorial Image Generator</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <select
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value)}
                        style={{ background: "#0c0a0c", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "4px 8px", color: "#ffffff", fontSize: "11px" }}
                      >
                        <option value="1:1">Square 1:1</option>
                        <option value="4:5">Portrait 4:5</option>
                        <option value="3:4">Portrait 3:4</option>
                        <option value="9:16">Story 9:16</option>
                        <option value="4:3">Landscape 4:3</option>
                        <option value="16:9">Wide 16:9</option>
                      </select>
                      <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={researchCardToggle}
                          onChange={(e) => setResearchCardToggle(e.target.checked)}
                        />
                        <span>Research card</span>
                      </label>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      setGeneratingImage(true);
                      showToast(`Generating editorial ${aspectRatio} card with headline & facts...`);
                      await dispatchAction({ action: "generate_image", id: activeDraftId, aspectRatio });
                      setGeneratingImage(false);
                      showToast("Image ready!");
                    }}
                    style={{ background: "#ef4444", border: "none", borderRadius: "8px", padding: "10px", color: "#ffffff", fontSize: "12px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                  >
                    {generatingImage ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                    Generate {aspectRatio} News Card
                  </button>
                </div>

                {/* AI Refine Box */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Ask the agent to edit caption</label>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {["Shorten and add a CTA", "Add viral hook", "Bullet breakdown", "Make it punchy"].map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setRefinePrompt(preset)}
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "4px 8px", fontSize: "11px", color: "rgba(255,255,255,0.8)", cursor: "pointer" }}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      placeholder="e.g. shorten and add a CTA..."
                      value={refinePrompt}
                      onChange={(e) => setRefinePrompt(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === "Enter" && refinePrompt.trim()) {
                          setRefineBusy(true);
                          const d = await dispatchAction({ action: "refine_caption", id: activeDraftId, instruction: refinePrompt });
                          if (d?.caption) setDraftCaption(d.caption);
                          setRefinePrompt("");
                          setRefineBusy(false);
                          showToast("Caption updated by AI.");
                        }
                      }}
                      style={{ flex: 1, background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px 12px", color: "#ffffff", fontSize: "12px" }}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!refinePrompt.trim()) return;
                        setRefineBusy(true);
                        const d = await dispatchAction({ action: "refine_caption", id: activeDraftId, instruction: refinePrompt });
                        if (d?.caption) setDraftCaption(d.caption);
                        setRefinePrompt("");
                        setRefineBusy(false);
                        showToast("Caption updated by AI.");
                      }}
                      style={{ background: "#ef4444", border: "none", borderRadius: "8px", padding: "0 16px", color: "#ffffff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                    >
                      {refineBusy ? <Loader2 size={14} className="spin" /> : "Refine"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Preview & Schedule Column */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ background: "#120f16", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.08)", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700 }}>Live Social Card Preview</span>

                  {/* Card graphic preview */}
                  <div
                    style={{
                      width: "100%",
                      height: "220px",
                      borderRadius: "12px",
                      background: "linear-gradient(135deg, #1f121d 0%, #0d0a11 100%)",
                      border: "1px solid rgba(239,68,68,0.3)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      padding: "16px",
                      boxSizing: "border-box",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "10px", fontWeight: 800, color: "#ef4444", letterSpacing: "0.1em" }}>AGENTIC OS · NEWS</span>
                      <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>4K EDITORIAL</span>
                    </div>

                    <div>
                      <div style={{ fontSize: "15px", fontWeight: 800, color: "#ffffff", lineHeight: 1.3 }}>
                        {osData?.drafts?.find((d) => d.id === activeDraftId)?.title || "Headline Rendering"}
                      </div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginTop: "6px" }}>
                        Autonomous Content Systems · OpenRouter &amp; Sonar Pro
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "8px" }}>
                      <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>Ratio: {aspectRatio}</span>
                      <span style={{ fontSize: "10px", color: "#10b981", fontWeight: 600 }}>● READY TO PUBLISH</span>
                    </div>
                  </div>

                  {/* Caption preview snippet */}
                  <div style={{ background: "rgba(255,255,255,0.03)", padding: "10px", borderRadius: "8px", fontSize: "11px", color: "rgba(255,255,255,0.7)", maxHeight: "90px", overflowY: "auto", whiteSpace: "pre-wrap" }}>
                    {draftCaption}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowScheduleModal(true)}
                    style={{ background: "#ef4444", border: "none", borderRadius: "10px", padding: "12px", color: "#ffffff", fontSize: "13px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                  >
                    Schedule this post →
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ background: "#120f16", borderRadius: "16px", padding: "40px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
              Select a draft on the left or create one from Priority Feed.
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          5. SCHEDULE VIEW (Zernio Multi-Platform Queue)
      ───────────────────────────────────────────────────────────── */}
      {activeView === "schedule" && (
        <div style={{ flex: 1, padding: "24px", maxWidth: "1600px", margin: "0 auto", width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ background: "#120f16", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Scheduled Posts</h2>
              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", margin: "2px 0 0" }}>
                Multi-platform distribution via Zernio (Instagram, LinkedIn, X).
              </p>
            </div>
            <button
              type="button"
              onClick={fetchState}
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 12px", color: "#ffffff", fontSize: "12px", cursor: "pointer" }}
            >
              Refresh
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {osData?.scheduled?.map((post) => (
              <div
                key={post.id}
                style={{
                  background: "#120f16",
                  borderRadius: "14px",
                  border: "1px solid rgba(255,255,255,0.07)",
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#ffffff" }}>{post.title}</div>
                  <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                    {post.platforms.map((p, idx) => (
                      <span key={idx} style={{ fontSize: "10px", background: "rgba(56,189,248,0.15)", color: "#38bdf8", padding: "2px 8px", borderRadius: "4px", textTransform: "capitalize" }}>
                        {p}
                      </span>
                    ))}
                    <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.45)", padding: "2px 4px" }}>
                      Scheduled for: {new Date(post.scheduled_for).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "11px", background: "rgba(16,185,129,0.15)", color: "#10b981", padding: "4px 10px", borderRadius: "6px", fontWeight: 700 }}>
                    {post.status.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          6. AUTONOMOUS SCRAPER QUEUE (Vivek Mishra Scraper Skill)
      ───────────────────────────────────────────────────────────── */}
      {activeView === "scraper" && (
        <div style={{ flex: 1, padding: "24px", maxWidth: "1600px", margin: "0 auto", width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Metrics Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px" }}>
            <div style={{ background: "#120f16", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)", padding: "14px" }}>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Total Scraped</div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#ffffff", marginTop: "4px" }}>3,842 items</div>
            </div>
            <div style={{ background: "#120f16", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)", padding: "14px" }}>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Active Jobs</div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#38bdf8", marginTop: "4px" }}>{queueCount} Running</div>
            </div>
            <div style={{ background: "#120f16", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)", padding: "14px" }}>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Success Rate</div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#10b981", marginTop: "4px" }}>99.4%</div>
            </div>
            <div style={{ background: "#120f16", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)", padding: "14px" }}>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Proxy Pool Latency</div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#f59e0b", marginTop: "4px" }}>182ms</div>
            </div>
          </div>

          {/* Launch Job Bar */}
          <div style={{ background: "#120f16", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)", padding: "16px 20px", display: "flex", gap: "12px", alignItems: "center" }}>
            <input
              type="text"
              value={scrapeUrlInput}
              onChange={(e) => setScrapeUrlInput(e.target.value)}
              placeholder="Target URL e.g. https://news.ycombinator.com"
              style={{ flex: 1, background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "10px 14px", color: "#ffffff", fontSize: "13px" }}
            />
            <button
              type="button"
              onClick={() => setProxyMode(proxyMode === "nodemaven" ? "direct" : "nodemaven")}
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.1)",
                background: proxyMode === "nodemaven" ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.05)",
                color: proxyMode === "nodemaven" ? "#38bdf8" : "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Proxy: {proxyMode === "nodemaven" ? "NodeMaven Res." : "Direct"}
            </button>
            <button
              type="button"
              onClick={() => setAntiBotMode(!antiBotMode)}
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.1)",
                background: antiBotMode ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
                color: antiBotMode ? "#10b981" : "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Anti-Bot: {antiBotMode ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              onClick={async () => {
                setRunningScraper(true);
                showToast(`Deploying scraper worker to ${scrapeUrlInput}...`);
                await dispatchAction({ action: "run_scraper", url: scrapeUrlInput, proxyMode, antiBot: antiBotMode });
                setRunningScraper(false);
                showToast("Scraper completed with 0 blocks.");
              }}
              style={{ background: "#ef4444", border: "none", borderRadius: "8px", padding: "10px 20px", color: "#ffffff", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
            >
              {runningScraper ? <Loader2 size={14} className="spin" /> : "Deploy Worker"}
            </button>
          </div>

          {/* Scraper Jobs Table & Activity Log */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div style={{ background: "#120f16", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)", padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700 }}>Scrape Queue</span>
              {osData?.scraperJobs?.map((job) => (
                <div key={job.id} style={{ background: "rgba(255,255,255,0.03)", padding: "10px 14px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#ffffff" }}>{job.target_url}</div>
                    <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>
                      Proxy: {job.proxy_mode} · Found {job.records_found} records
                    </div>
                  </div>
                  <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", background: "rgba(16,185,129,0.2)", color: "#10b981", fontWeight: 700 }}>
                    {job.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>

            {/* Terminal activity */}
            <div style={{ background: "#0c0a0e", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)", padding: "18px", fontFamily: "monospace", fontSize: "11px", color: "#34d399", display: "flex", flexDirection: "column", gap: "6px", maxHeight: "280px", overflowY: "auto" }}>
              <div style={{ color: "rgba(255,255,255,0.4)", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "4px" }}>
                $ scraper-worker --stream logs
              </div>
              {osData?.scraperJobs?.[0]?.logs?.map((l, i) => (
                <div key={i}>{l}</div>
              )) || <div>[IDLE] Waiting for worker dispatch...</div>}
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          7. SETTINGS VIEW
      ───────────────────────────────────────────────────────────── */}
      {activeView === "settings" && (
        <div style={{ flex: 1, padding: "24px", maxWidth: "1100px", margin: "0 auto", width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ background: "#120f16", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Agentic OS &amp; Content Engine Settings</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginBottom: "4px", display: "block" }}>Brand Voice</label>
                <textarea
                  rows={3}
                  value={osData?.settings?.brand_voice || ""}
                  onChange={(e) => {
                    if (osData) {
                      setOsData({ ...osData, settings: { ...osData.settings, brand_voice: e.target.value } });
                    }
                  }}
                  style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px", color: "#ffffff", fontSize: "12px", boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginBottom: "4px", display: "block" }}>Timezone</label>
                <input
                  type="text"
                  value={osData?.settings?.timezone || "Asia/Kolkata"}
                  onChange={(e) => {
                    if (osData) {
                      setOsData({ ...osData, settings: { ...osData.settings, timezone: e.target.value } });
                    }
                  }}
                  style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px", color: "#ffffff", fontSize: "12px", boxSizing: "border-box" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Research Model</label>
                <input
                  type="text"
                  value={osData?.settings?.research_model || "perplexity/sonar-pro"}
                  readOnly
                  style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px", color: "rgba(255,255,255,0.7)", fontSize: "12px", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Assistant Fast Model</label>
                <input
                  type="text"
                  value={osData?.settings?.assistant_fast_model || "google/gemini-2.5-flash"}
                  readOnly
                  style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px", color: "rgba(255,255,255,0.7)", fontSize: "12px", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Image Generation Model</label>
                <input
                  type="text"
                  value={osData?.settings?.image_model || "openai/gpt-image-2"}
                  readOnly
                  style={{ width: "100%", background: "#18141e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px", color: "rgba(255,255,255,0.7)", fontSize: "12px", boxSizing: "border-box" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={async () => {
                  if (osData) {
                    await dispatchAction({ action: "update_settings", settings: osData.settings });
                    showToast("Settings saved.");
                  }
                }}
                style={{ background: "#ef4444", border: "none", borderRadius: "8px", padding: "10px 20px", color: "#ffffff", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          8. GITHUB REPOSITORY EXPLORER VIEW
      ───────────────────────────────────────────────────────────── */}
      {activeView === "repo" && (
        <WorkRepoExplorer initialStatus={gitStatus} onRefreshParent={fetchState} />
      )}

      {/* ─────────────────────────────────────────────────────────────
          SCHEDULE MODAL
      ───────────────────────────────────────────────────────────── */}
      {showScheduleModal && (
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
          }}
        >
          <div style={{ background: "#141118", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.1)", padding: "24px", width: "420px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>Schedule Post</h3>
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                style={{ background: "transparent", border: "none", color: "#ffffff", fontSize: "18px", cursor: "pointer" }}
              >
                ×
              </button>
            </div>

            <div>
              <label style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", marginBottom: "6px", display: "block" }}>Select Platforms (Zernio)</label>
              <div style={{ display: "flex", gap: "10px" }}>
                {(["linkedin", "twitter", "instagram"] as const).map((p) => {
                  const active = scheduledPlatforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setScheduledPlatforms(active ? scheduledPlatforms.filter((x) => x !== p) : [...scheduledPlatforms, p]);
                      }}
                      style={{
                        flex: 1,
                        padding: "8px",
                        borderRadius: "8px",
                        border: `1px solid ${active ? "#ef4444" : "rgba(255,255,255,0.1)"}`,
                        background: active ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.03)",
                        color: active ? "#ffffff" : "rgba(255,255,255,0.6)",
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "capitalize",
                        cursor: "pointer",
                      }}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", marginBottom: "6px", display: "block" }}>Schedule Time</label>
              <input
                type="datetime-local"
                value={scheduleDatetime}
                onChange={(e) => setScheduleDatetime(e.target.value)}
                style={{ width: "100%", background: "#1c1822", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "10px", color: "#ffffff", fontSize: "12px", boxSizing: "border-box" }}
              />
            </div>

            <button
              type="button"
              onClick={async () => {
                if (!activeDraftId) return;
                await dispatchAction({
                  action: "schedule_post",
                  draftId: activeDraftId,
                  platforms: scheduledPlatforms,
                  scheduledFor: scheduleDatetime ? new Date(scheduleDatetime).toISOString() : new Date(Date.now() + 3600000).toISOString(),
                });
                setShowScheduleModal(false);
                showToast("Post scheduled across selected platforms.");
                setActiveView("schedule");
              }}
              style={{ background: "#ef4444", border: "none", borderRadius: "10px", padding: "12px", color: "#ffffff", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
            >
              Confirm Schedule
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          8. MOBILE PHONE SYNC & ACCESS VIEW
      ───────────────────────────────────────────────────────────── */}
      {activeView === "mobile" && (
        <div style={{ padding: "32px 24px", maxWidth: "800px", margin: "0 auto", width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "24px" }}>
          <div>
            <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 6px", color: "#ffffff" }}>
              Mobile Phone Access &amp; Remote Pairing
            </h2>
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", margin: 0 }}>
              Scan the QR code with your iPhone or Android camera to open and operate Work OS and the entire Agentic OS right from your phone.
            </p>
          </div>

          <div
            style={{
              background: "#08070d",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "16px",
              padding: "28px",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "28px",
              alignItems: "center",
              boxShadow: "0 12px 36px rgba(0,0,0,0.7)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "linear-gradient(135deg, #ef4444 0%, #a855f7 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Smartphone size={20} color="#ffffff" />
                </div>
                <div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#ffffff" }}>Direct Mobile URL</div>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>
                    {qrMode === "desktop"
                      ? "Scan with your phone to open the entire Agentic OS desktop (Daily Brief, Work, Jarvis, Computer Use)"
                      : "Scan with your phone to open Work & Content OS standalone"}
                  </div>
                </div>
              </div>

              {/* Mode Switcher */}
              <div style={{ display: "flex", gap: "6px", background: "#06060c", padding: "4px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", width: "fit-content" }}>
                <button
                  type="button"
                  onClick={() => setQrMode("desktop")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "none",
                    background: qrMode === "desktop" ? "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)" : "transparent",
                    color: "#ffffff",
                    fontSize: "11.5px",
                    fontWeight: qrMode === "desktop" ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  <LayoutDashboard size={13} />
                  <span>Whole Desktop OS</span>
                  <span style={{ fontSize: "9.5px", background: "rgba(255,255,255,0.2)", padding: "1px 5px", borderRadius: "3px" }}>Recommended</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQrMode("work")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "none",
                    background: qrMode === "work" ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)" : "transparent",
                    color: "#ffffff",
                    fontSize: "11.5px",
                    fontWeight: qrMode === "work" ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  <Briefcase size={13} />
                  <span>Work OS Only</span>
                </button>
              </div>

              <div style={{ background: "#040407", border: "1px solid rgba(56,189,248,0.3)", borderRadius: "8px", padding: "10px 14px", color: "#38bdf8", fontFamily: "monospace", fontSize: "13px" }}>
                {activePairUrl}
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={async () => {
                    await copyToClipboard(activePairUrl);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 16px",
                    background: copiedLink ? "#10b981" : "#38bdf8",
                    border: "none",
                    borderRadius: "8px",
                    color: copiedLink ? "#ffffff" : "#000000",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedLink ? "Copied!" : "Copy Link"}</span>
                </button>

                <a
                  href={activePairUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 16px",
                    background: "rgba(56, 189, 248, 0.15)",
                    border: "1px solid rgba(56, 189, 248, 0.35)",
                    borderRadius: "8px",
                    color: "#38bdf8",
                    fontSize: "12px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  <span>Open URL</span>
                  <ExternalLink size={12} />
                </a>

                <a
                  href="/remote"
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 16px",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "8px",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  <span>Open Remote Trackpad</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "160px",
                  height: "160px",
                  background: "#ffffff",
                  padding: "10px",
                  borderRadius: "14px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <span style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 700 }}>
                Scan with Phone Camera
              </span>
              <span style={{ fontSize: "9.5px", color: "rgba(255,255,255,0.5)" }}>
                {qrMode === "desktop" ? "Opens Full Desktop OS" : "Opens Work Window"}
              </span>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// Named alias for backwards compatibility
export { RubricWorkWindow as AgenticWorkOs };
