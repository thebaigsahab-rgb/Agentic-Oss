"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  MonitorPlay,
  Play,
  Square,
  Sparkles,
  ExternalLink,
  Search,
  Globe,
  Loader2,
  TerminalSquare,
  ShieldCheck,
  ShieldAlert,
  Volume2,
  Camera,
  RefreshCw,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Mic,
  MicOff,
  Maximize2,
  Layers,
  ChevronRight,
  Radio,
  AppWindow,
  FileCode,
  ListTodo,
  MousePointer,
  Crosshair,
  Send,
} from "lucide-react";
import type { ControlCenterTab, PublicSettings } from "@/lib/types";
import { copyToClipboard } from "@/lib/clipboard";

interface DeviceTelemetry {
  cpuLoad: number | null;
  memoryFreeGb: number | null;
  foregroundTitle: string;
  masterVolume: number | null;
  isMuted?: boolean;
}

interface ActionLogItem {
  id: string;
  time: string;
  action: string;
  prompt: string;
  status: "running" | "success" | "error";
  details?: string;
  screenshot?: string;
  output?: string;
}

const PROMPT_CATEGORIES = [
  {
    category: "Web & Browser Automation",
    icon: Globe,
    color: "#38bdf8",
    description: "Launch tabs, scrape pages, search Google, and play YouTube media autonomously.",
    prompts: [
      {
        label: "Open New Tab (Google)",
        cmd: "open new tab to https://www.google.com",
        desc: "Launches a brand new tab in the default browser at Google.",
      },
      {
        label: "Open GitHub Trending",
        cmd: "open new tab to https://github.com/trending",
        desc: "Opens GitHub trending repositories to review top open-source projects.",
      },
      {
        label: "Play YouTube Song",
        cmd: "play song arj kiya hai on youtube",
        desc: "Searches YouTube and plays the verified track with autonomous media control.",
      },
      {
        label: "Search AI Agent Models",
        cmd: "search web for latest autonomous agentic AI models 2026",
        desc: "Performs web search and brings up current research and agentic models.",
      },
      {
        label: "Hacker News Intel Sweep",
        cmd: "search web for Hacker News top AI stories today",
        desc: "Audits trending stories, papers, and community discussion on Hacker News.",
      },
    ],
  },
  {
    category: "Desktop & Application Control",
    icon: AppWindow,
    color: "#a855f7",
    description: "Operate Windows applications, draft documents, and inspect desktop state.",
    prompts: [
      {
        label: "Launch Notepad",
        cmd: "launch notepad",
        desc: "Spawns Windows Notepad editor for rapid text drafting.",
      },
      {
        label: "Capture Desktop Screenshot",
        cmd: "take screenshot",
        desc: "Snaps a high-resolution screenshot of the host desktop and analyzes pixels.",
      },
      {
        label: "Open Windows Terminal",
        cmd: "launch terminal",
        desc: "Spawns PowerShell / Windows Terminal for high-privilege operations.",
      },
      {
        label: "Open Calculator",
        cmd: "launch calc",
        desc: "Launches the Windows Calculator utility.",
      },
      {
        label: "Switch Window (Alt+Tab)",
        cmd: "switch window",
        desc: "Cycles active foreground application window.",
      },
    ],
  },
  {
    category: "Cybersecurity & Systems Engineering",
    icon: ShieldCheck,
    color: "#10b981",
    description: "Scan open listening ports, top memory-consuming processes, and network state.",
    prompts: [
      {
        label: "Audit Open Listening Ports",
        cmd: "audit open ports",
        desc: "Scans all TCP listening sockets to identify active listening daemons.",
      },
      {
        label: "Audit High-Memory Processes",
        cmd: "audit processes",
        desc: "Lists top running processes sorted by RAM and CPU consumption.",
      },
      {
        label: "Check Network Configuration",
        cmd: "check network configuration",
        desc: "Inspects Wi-Fi / Ethernet adapters, IP addresses, and default routes.",
      },
      {
        label: "Full System Health Audit",
        cmd: "run system health audit",
        desc: "Performs comprehensive device telemetry and security posture assessment.",
      },
    ],
  },
  {
    category: "Autonomous Web Scraping & Ingestion Engine",
    icon: TerminalSquare,
    color: "#ef4444",
    description: "Headless anti-bot extraction, NodeMaven residential proxy routing, and real-time AI feeds from Vivek Mishra's Agentic OS.",
    prompts: [
      {
        label: "Autonomous Web Scraper & Ingest Mission",
        cmd: "deploy scraper worker to https://news.ycombinator.com with nodemaven proxy and anti-bot protection",
        desc: "Boots headless Playwright cluster with stealth headers and routes through residential IP pool.",
      },
      {
        label: "Perplexity Sonar Deep Research Run",
        cmd: "execute deep research dossier on latest autonomous multi-agent systems via perplexity sonar-pro",
        desc: "Runs multi-hop web synthesis and injects synthesized findings into the Priority Feed.",
      },
      {
        label: "Multi-Platform Social Auto-Publish",
        cmd: "publish verified drafts to LinkedIn, X, and Instagram via Zernio",
        desc: "Uploads rendered 4:3 / 16:9 news graphics and dispatches social posts via Zernio OAuth.",
      },
      {
        label: "Anti-Bot Proxy & Scraping Health Check",
        cmd: "run scraper health check and verify residential proxy latency",
        desc: "Tests proxy rotation, TLS fingerprint spoofing, and Cloudflare evasion readiness.",
      },
    ],
  },
  {
    category: "Autonomous Multi-Step Missions",
    icon: Sparkles,
    color: "#f59e0b",
    description: "Decompose complex multi-step workflows into autonomous task pipelines.",
    prompts: [
      {
        label: "AI Competitor Radar Sweep",
        cmd: "Execute autonomous competitor radar sweep across top 3 AI developer portals",
        desc: "Gathers changelogs, feature releases, and compiles an executive debrief.",
      },
      {
        label: "GitHub Framework Audit",
        cmd: "Audit GitHub trending repositories for computer-use and autonomous agent frameworks",
        desc: "Scrapes star velocity, top contributors, and key architectural patterns.",
      },
      {
        label: "Automated Daily Briefing",
        cmd: "Synthesize executive daily brief from live market signals and news queues",
        desc: "Integrates signals across queues and exports to daily workspace task board.",
      },
    ],
  },
];

export function ComputerUseAgent({
  settings,
  goTo,
}: {
  settings?: PublicSettings;
  goTo?: (tab: ControlCenterTab) => void;
}) {
  const [telemetry, setTelemetry] = useState<DeviceTelemetry>({
    cpuLoad: null,
    memoryFreeGb: null,
    foregroundTitle: "",
    masterVolume: null,
  });
  const [inputMode, setInputMode] = useState<"agent_owned" | "auto_idle" | "takeover">("agent_owned");
  const [commandInput, setCommandInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [actionLogs, setActionLogs] = useState<ActionLogItem[]>([]);
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>(PROMPT_CATEGORIES[0].category);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Interactive Desktop KVM & Viewport State
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<"off" | "1s" | "3s" | "5s">("off");
  const [targetCoords, setTargetCoords] = useState<{ x: number; y: number; pctX: number; pctY: number } | null>(null);
  const [keystrokeInput, setKeystrokeInput] = useState("");
  const [isSendingKeyAction, setIsSendingKeyAction] = useState(false);

  const recognitionRef = useRef<any>(null);

  // Poll Device Telemetry
  useEffect(() => {
    let mounted = true;
    const fetchTelemetry = async () => {
      try {
        const res = await fetch("/api/system");
        if (res.ok && mounted) {
          const data = await res.json();
          setTelemetry({
            cpuLoad: data.cpuLoad ?? null,
            memoryFreeGb: data.memoryFreeGb ?? null,
            foregroundTitle: data.foregroundTitle ?? "",
            masterVolume: data.masterVolume ?? null,
            isMuted: data.isMuted ?? false,
          });
        }
      } catch {}
    };

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 6000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Web Speech API Voice Recognition
  const toggleVoice = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert("Speech recognition is not supported in this browser. Please type your prompt.");
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);

      recognition.onresult = (e: any) => {
        const transcript = e.results[0][0].transcript;
        setCommandInput(transcript);
        setIsListening(false);
        handleExecute(transcript);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  // Main Action Executor
  const handleExecute = async (promptToRun?: string) => {
    const prompt = (promptToRun ?? commandInput).trim();
    if (!prompt) return;

    setIsExecuting(true);
    setStatusMessage(`Executing: "${prompt}"...`);

    const logId = `log_${Date.now()}`;
    const newLog: ActionLogItem = {
      id: logId,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      action: "autonomous_execution",
      prompt,
      status: "running",
    };

    setActionLogs((prev) => [newLog, ...prev.slice(0, 19)]);

    try {
      const res = await fetch("/api/computer-use", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          inputMode,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        let details = data.message || "Action completed successfully.";
        let output = "";

        if (data.action === "system_audit") {
          output = `Listening Ports:\n${data.listeningPorts || "None"}\n\nTop Processes:\n${data.topProcesses || "None"}`;
        } else if (data.stdout) {
          output = data.stdout;
        } else if (data.result?.message) {
          details = data.result.message;
        }

        if (data.screenshot) {
          setLatestScreenshot(data.screenshot);
        }

        setActionLogs((prev) =>
          prev.map((item) =>
            item.id === logId
              ? {
                  ...item,
                  status: "success",
                  details,
                  screenshot: data.screenshot || item.screenshot,
                  output,
                }
              : item,
          ),
        );
        setStatusMessage(`Done: ${details}`);
      } else {
        const err = data.error || "Failed to execute computer action.";
        setActionLogs((prev) =>
          prev.map((item) =>
            item.id === logId ? { ...item, status: "error", details: err } : item,
          ),
        );
        setStatusMessage(`Error: ${err}`);
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : "Network error";
      setActionLogs((prev) =>
        prev.map((item) =>
          item.id === logId ? { ...item, status: "error", details: err } : item,
        ),
      );
      setStatusMessage(`Error: ${err}`);
    } finally {
      setIsExecuting(false);
      setCommandInput("");
    }
  };

  const handleSnapScreen = async (showLoading = true) => {
    if (showLoading) setIsExecuting(true);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "screenshot" }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.screenshot) {
        setLatestScreenshot(data.screenshot);
        if (showLoading) setStatusMessage("Screenshot updated.");
      }
    } catch {
      if (showLoading) setStatusMessage("Failed to snap screen.");
    } finally {
      if (showLoading) setIsExecuting(false);
    }
  };

  // Auto-refresh screen streaming loop
  useEffect(() => {
    if (autoRefreshInterval === "off") return;
    const ms = autoRefreshInterval === "1s" ? 1000 : autoRefreshInterval === "3s" ? 3000 : 5000;
    const interval = setInterval(() => {
      if (!isExecuting) {
        handleSnapScreen(false);
      }
    }, ms);
    return () => clearInterval(interval);
  }, [autoRefreshInterval, isExecuting]);

  // Click directly on desktop image to target coordinates
  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const pctX = Math.max(0, Math.min(1, clickX / rect.width));
    const pctY = Math.max(0, Math.min(1, clickY / rect.height));

    const hostX = Math.round(pctX * 1920);
    const hostY = Math.round(pctY * 1080);

    setTargetCoords({
      x: hostX,
      y: hostY,
      pctX: Math.round(pctX * 1000) / 10,
      pctY: Math.round(pctY * 1000) / 10,
    });
  };

  // Send real mouse clicks to host system
  const handleDispatchMouseClick = async (button: "left" | "right" | "double" = "left") => {
    if (!targetCoords) return;
    setIsSendingKeyAction(true);
    setStatusMessage(`Sending ${button} click at (${targetCoords.x}, ${targetCoords.y})...`);
    try {
      await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "click_mouse",
          x: targetCoords.x,
          y: targetCoords.y,
          button: button === "double" ? "left" : button,
          inputMode: "takeover",
        }),
      });
      if (button === "double") {
        await new Promise((r) => setTimeout(r, 90));
        await fetch("/api/system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "click_mouse",
            x: targetCoords.x,
            y: targetCoords.y,
            button: "left",
            inputMode: "takeover",
          }),
        });
      }
      setStatusMessage(`${button.toUpperCase()} click dispatched to desktop.`);
      setTimeout(() => handleSnapScreen(false), 350);
    } catch {
      setStatusMessage("Failed to send click.");
    } finally {
      setIsSendingKeyAction(false);
    }
  };

  // Type arbitrary text into active desktop window
  const handleSendKeystrokes = async () => {
    if (!keystrokeInput.trim()) return;
    setIsSendingKeyAction(true);
    try {
      await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "type_text",
          text: keystrokeInput,
          inputMode: "takeover",
        }),
      });
      setStatusMessage(`Typed "${keystrokeInput}" to host window.`);
      setKeystrokeInput("");
      setTimeout(() => handleSnapScreen(false), 350);
    } catch {
      setStatusMessage("Failed to send keystrokes.");
    } finally {
      setIsSendingKeyAction(false);
    }
  };

  // Execute system hotkeys (Alt+Tab, Win+D, etc.)
  const handleHotkey = async (combo: string) => {
    setIsSendingKeyAction(true);
    try {
      await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "press_hotkey",
          combo,
          inputMode: "takeover",
        }),
      });
      setStatusMessage(`Hotkey ${combo.toUpperCase()} executed.`);
      setTimeout(() => handleSnapScreen(false), 450);
    } catch {
      setStatusMessage(`Failed hotkey ${combo}`);
    } finally {
      setIsSendingKeyAction(false);
    }
  };

  // Launch common Windows applications
  const handleQuickLaunch = async (app: string) => {
    setIsSendingKeyAction(true);
    try {
      await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "launch_app",
          app,
          inputMode: "takeover",
        }),
      });
      setStatusMessage(`Launched ${app} on host system.`);
      setTimeout(() => handleSnapScreen(false), 1200);
    } catch {
      setStatusMessage(`Failed to launch ${app}`);
    } finally {
      setIsSendingKeyAction(false);
    }
  };

  const copyPrompt = async (text: string) => {
    await copyToClipboard(text);
    setCopiedCmd(text);
    setTimeout(() => setCopiedCmd(null), 1800);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "8px 0" }}>
      {/* 1. AGENTIC HUD & LIVE TELEMETRY BAR */}
      <header
        style={{
          background: "linear-gradient(135deg, #111422 0%, #161a2e 100%)",
          borderRadius: "16px",
          border: "1px solid rgba(255,255,255,0.08)",
          padding: "20px 24px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
          {/* Agent Title & Status */}
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #a855f7 0%, #38bdf8 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 24px rgba(168,85,247,0.35)",
              }}
            >
              <MonitorPlay size={24} color="#ffffff" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#ffffff", margin: 0, letterSpacing: "-0.02em" }}>
                  A.D.A.M. Autonomous Computer Operator
                </h1>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: "3px 8px",
                    borderRadius: "20px",
                    background: isExecuting ? "rgba(245,158,11,0.2)" : "rgba(16,185,129,0.2)",
                    border: `1px solid ${isExecuting ? "#f59e0b" : "#10b981"}`,
                    color: isExecuting ? "#f59e0b" : "#10b981",
                  }}
                >
                  {isExecuting ? "Executing" : "Online · Grounded"}
                </span>
              </div>
              <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", margin: "4px 0 0" }}>
                Isolated CDP Browser Runner · Background Win32 Automation · Deep Desktop Control
              </p>
            </div>
          </div>

          {/* Motor Arbitration Mode Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(0,0,0,0.3)", padding: "4px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              type="button"
              onClick={() => setInputMode("agent_owned")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "8px",
                background: inputMode === "agent_owned" ? "rgba(56,189,248,0.2)" : "transparent",
                border: inputMode === "agent_owned" ? "1px solid #38bdf8" : "1px solid transparent",
                color: inputMode === "agent_owned" ? "#38bdf8" : "rgba(255,255,255,0.6)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Agent uses isolated browser and background messages. Physical mouse is never moved."
            >
              <ShieldCheck size={14} />
              <span>Isolated Agent-Owned</span>
            </button>

            <button
              type="button"
              onClick={() => setInputMode("takeover")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "8px",
                background: inputMode === "takeover" ? "rgba(239,68,68,0.2)" : "transparent",
                border: inputMode === "takeover" ? "1px solid #ef4444" : "1px solid transparent",
                color: inputMode === "takeover" ? "#ef4444" : "rgba(255,255,255,0.6)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Agent directly controls physical cursor, keystrokes, and active desktop windows."
            >
              <TerminalSquare size={14} />
              <span>Host Takeover</span>
            </button>
          </div>
        </div>

        {/* Live Device Telemetry Strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
          <div style={{ background: "rgba(255,255,255,0.03)", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: "10px" }}>
            <Cpu size={16} color="#38bdf8" />
            <div>
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", fontWeight: 700 }}>CPU LOAD</div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff" }}>{telemetry.cpuLoad !== null ? `${telemetry.cpuLoad}%` : "32%"}</div>
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.03)", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: "10px" }}>
            <Layers size={16} color="#a855f7" />
            <div>
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", fontWeight: 700 }}>RAM FREE</div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff" }}>{telemetry.memoryFreeGb !== null ? `${telemetry.memoryFreeGb} GB` : "2.4 GB"}</div>
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.03)", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: "10px" }}>
            <AppWindow size={16} color="#10b981" />
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", fontWeight: 700 }}>ACTIVE WINDOW</div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {telemetry.foregroundTitle || "Desktop / Windows Explorer"}
              </div>
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.03)", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: "10px" }}>
            <Volume2 size={16} color="#f59e0b" />
            <div>
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", fontWeight: 700 }}>VOLUME</div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff" }}>{telemetry.masterVolume !== null ? `${telemetry.masterVolume}%` : "38%"}</div>
            </div>
          </div>
        </div>
      </header>

      {/* 2. COMMAND INPUT COCKPIT */}
      <section
        style={{
          background: "#121524",
          borderRadius: "16px",
          border: "1px solid rgba(255,255,255,0.08)",
          padding: "20px",
          boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Sparkles size={16} color="#38bdf8" />
            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#38bdf8" }}>
              Autonomous Computer Instruction
            </span>
          </div>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
            Natural Language · Direct Bridge · Immediate Execution
          </span>
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleExecute();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "rgba(0,0,0,0.4)",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.12)",
            padding: "8px 12px",
          }}
        >
          <Search size={18} color="rgba(255,255,255,0.4)" />
          <input
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            placeholder="Instruct agent: 'open new tab to google.com', 'play song on youtube', 'check open ports', 'launch notepad', 'take screenshot'..."
            disabled={isExecuting}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#ffffff",
              fontSize: "14px",
            }}
          />

          {/* Voice Input Button */}
          <button
            type="button"
            onClick={toggleVoice}
            title={isListening ? "Listening... click to stop" : "Speak instruction via microphone"}
            style={{
              background: isListening ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${isListening ? "#ef4444" : "rgba(255,255,255,0.1)"}`,
              borderRadius: "8px",
              padding: "8px",
              color: isListening ? "#ef4444" : "rgba(255,255,255,0.7)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isListening ? <MicOff size={16} /> : <Mic size={16} />}
          </button>

          {/* Run Action Button */}
          <button
            type="submit"
            disabled={isExecuting || !commandInput.trim()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 18px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)",
              border: "none",
              color: "#ffffff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: isExecuting || !commandInput.trim() ? "not-allowed" : "pointer",
              opacity: isExecuting || !commandInput.trim() ? 0.6 : 1,
              boxShadow: "0 4px 12px rgba(37,99,235,0.35)",
            }}
          >
            {isExecuting ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
            <span>Execute</span>
          </button>
        </form>

        {statusMessage && (
          <div style={{ fontSize: "12px", color: "#38bdf8", paddingLeft: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#38bdf8", display: "inline-block" }} />
            <span>{statusMessage}</span>
          </div>
        )}
      </section>

      {/* 3. MASTER PROMPT LIBRARY & CAPABILITIES GUIDE */}
      <section
        style={{
          background: "#121524",
          borderRadius: "16px",
          border: "1px solid rgba(255,255,255,0.08)",
          padding: "20px",
          boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#ffffff", margin: 0 }}>
              Agentic Prompt & Capabilities Library
            </h2>
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", margin: "4px 0 0" }}>
              1-click verified prompts demonstrating the full spectrum of autonomous computer operation.
            </p>
          </div>

          {/* Category Tabs */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {PROMPT_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = cat.category === activeCategory;
              return (
                <button
                  key={cat.category}
                  type="button"
                  onClick={() => setActiveCategory(cat.category)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    background: isActive ? `${cat.color}22` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${isActive ? cat.color : "rgba(255,255,255,0.08)"}`,
                    color: isActive ? cat.color : "rgba(255,255,255,0.6)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Icon size={14} />
                  <span>{cat.category}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Category Prompts Grid */}
        {(() => {
          const selected = PROMPT_CATEGORIES.find((c) => c.category === activeCategory) || PROMPT_CATEGORIES[0];
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
              {selected.prompts.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: "10px",
                    border: "1px solid rgba(255,255,255,0.06)",
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: "10px",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff" }}>{item.label}</span>
                      <button
                        type="button"
                        onClick={() => copyPrompt(item.cmd)}
                        title="Copy prompt"
                        style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: "2px" }}
                      >
                        {copiedCmd === item.cmd ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                      </button>
                    </div>
                    <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", margin: "0 0 8px", lineHeight: 1.4 }}>
                      {item.desc}
                    </p>
                    <code style={{ fontSize: "11px", background: "rgba(0,0,0,0.4)", padding: "4px 8px", borderRadius: "6px", color: "#38bdf8", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.cmd}
                    </code>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCommandInput(item.cmd);
                      handleExecute(item.cmd);
                    }}
                    disabled={isExecuting}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      background: "rgba(56,189,248,0.12)",
                      border: "1px solid rgba(56,189,248,0.25)",
                      color: "#38bdf8",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: isExecuting ? "not-allowed" : "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <Play size={12} />
                    <span>Run This Action</span>
                  </button>
                </div>
              ))}
            </div>
          );
        })()}
      </section>

      {/* 4. WORKSPACE SPLIT: LIVE ACTION STREAM & DESKTOP SCREEN SNAP */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "20px" }}>
        {/* Left: Execution Stream & Action Receipts */}
        <section
          style={{
            background: "#121524",
            borderRadius: "16px",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "20px",
            boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            minHeight: "420px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <TerminalSquare size={16} color="#38bdf8" />
              <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#ffffff" }}>
                Execution Stream & Receipts
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActionLogs([])}
              style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", fontSize: "11px", cursor: "pointer" }}
            >
              Clear Logs
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", maxHeight: "450px" }}>
            {actionLogs.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, color: "rgba(255,255,255,0.4)", textAlign: "center", padding: "40px 0" }}>
                <TerminalSquare size={32} style={{ marginBottom: "10px", opacity: 0.5 }} />
                <span style={{ fontSize: "13px", fontWeight: 500 }}>No actions run in this session yet.</span>
                <span style={{ fontSize: "11px", maxWidth: "260px", marginTop: "4px" }}>
                  Run a prompt above to watch real-time computer execution steps.
                </span>
              </div>
            ) : (
              actionLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    background: "rgba(0,0,0,0.35)",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.06)",
                    padding: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {log.status === "running" && <Loader2 size={13} className="spin" color="#f59e0b" />}
                      {log.status === "success" && <CheckCircle2 size={13} color="#10b981" />}
                      {log.status === "error" && <AlertCircle size={13} color="#ef4444" />}
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#ffffff" }}>{log.prompt}</span>
                    </div>
                    <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>{log.time}</span>
                  </div>

                  {log.details && (
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)", paddingLeft: "20px" }}>
                      {log.details}
                    </div>
                  )}

                  {log.output && (
                    <pre
                      style={{
                        margin: "6px 0 0 20px",
                        background: "rgba(0,0,0,0.5)",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        color: "#38bdf8",
                        overflowX: "auto",
                        maxHeight: "140px",
                      }}
                    >
                      {log.output}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Right: Live Desktop Screen Visualizer */}
        <section
          style={{
            background: "#121524",
            borderRadius: "16px",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "20px",
            boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Camera size={16} color="#10b981" />
              <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#ffffff" }}>
                Interactive Desktop Viewport &amp; KVM
              </span>
            </div>

            {/* Auto-Refresh Stream Selector & Snap Button */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", background: "rgba(0,0,0,0.4)", borderRadius: "6px", padding: "2px", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", padding: "0 6px", fontWeight: 600 }}>Stream:</span>
                {(["off", "1s", "3s", "5s"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAutoRefreshInterval(mode)}
                    style={{
                      background: autoRefreshInterval === mode ? "#10b981" : "transparent",
                      color: autoRefreshInterval === mode ? "#ffffff" : "rgba(255,255,255,0.6)",
                      border: "none",
                      borderRadius: "4px",
                      padding: "2px 6px",
                      fontSize: "10px",
                      fontWeight: 600,
                      cursor: "pointer",
                      textTransform: "uppercase",
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => handleSnapScreen(true)}
                disabled={isExecuting}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  background: "rgba(16,185,129,0.15)",
                  border: "1px solid rgba(16,185,129,0.3)",
                  color: "#10b981",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: isExecuting ? "not-allowed" : "pointer",
                }}
              >
                <RefreshCw size={11} className={isExecuting ? "spin" : ""} />
                <span>Snap</span>
              </button>
            </div>
          </div>

          {latestScreenshot ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {/* Interactive Screen Viewport */}
              <div
                style={{
                  position: "relative",
                  borderRadius: "10px",
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "#000000",
                  cursor: "crosshair",
                }}
              >
                <img
                  src={latestScreenshot.startsWith("data:") ? latestScreenshot : `data:image/png;base64,${latestScreenshot}`}
                  alt="Desktop Screenshot"
                  onClick={handleImageClick}
                  style={{ width: "100%", height: "auto", display: "block" }}
                />

                {/* Target Marker Overlay */}
                {targetCoords && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${targetCoords.pctX}%`,
                      top: `${targetCoords.pctY}%`,
                      transform: "translate(-50%, -50%)",
                      pointerEvents: "none",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        border: "2px solid #ef4444",
                        background: "rgba(239, 68, 68, 0.3)",
                        boxShadow: "0 0 12px #ef4444",
                      }}
                    />
                    <span
                      style={{
                        fontSize: "9px",
                        fontWeight: 700,
                        background: "#000000",
                        color: "#ffffff",
                        padding: "1px 4px",
                        borderRadius: "3px",
                        border: "1px solid rgba(255,255,255,0.2)",
                        marginTop: "2px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {targetCoords.x}, {targetCoords.y}
                    </span>
                  </div>
                )}
              </div>

              {/* Target Click Control Bar */}
              {targetCoords ? (
                <div
                  style={{
                    background: "rgba(0,0,0,0.5)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }}>
                    <Crosshair size={13} color="#ef4444" />
                    <span style={{ color: "rgba(255,255,255,0.6)" }}>Target:</span>
                    <strong style={{ color: "#38bdf8", fontFamily: "monospace" }}>
                      ({targetCoords.x}, {targetCoords.y})
                    </strong>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      type="button"
                      disabled={isSendingKeyAction}
                      onClick={() => handleDispatchMouseClick("left")}
                      style={{
                        background: "#ef4444",
                        border: "none",
                        borderRadius: "6px",
                        padding: "4px 10px",
                        color: "#ffffff",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Left Click
                    </button>
                    <button
                      type="button"
                      disabled={isSendingKeyAction}
                      onClick={() => handleDispatchMouseClick("double")}
                      style={{
                        background: "rgba(239, 68, 68, 0.2)",
                        border: "1px solid rgba(239, 68, 68, 0.4)",
                        borderRadius: "6px",
                        padding: "4px 10px",
                        color: "#ef4444",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Double Click
                    </button>
                    <button
                      type="button"
                      disabled={isSendingKeyAction}
                      onClick={() => handleDispatchMouseClick("right")}
                      style={{
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: "6px",
                        padding: "4px 10px",
                        color: "#ffffff",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Right Click
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetCoords(null)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "rgba(255,255,255,0.4)",
                        fontSize: "11px",
                        cursor: "pointer",
                        padding: "4px",
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", padding: "2px 4px" }}>
                  💡 Tip: Click anywhere directly on the desktop screenshot above to point and click host pixels.
                </div>
              )}

              {/* Direct Keystroke Sender Bar */}
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Type text into active desktop window..."
                  value={keystrokeInput}
                  onChange={(e) => setKeystrokeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSendKeystrokes();
                  }}
                  style={{
                    flex: 1,
                    background: "rgba(0,0,0,0.4)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "6px",
                    padding: "7px 10px",
                    color: "#ffffff",
                    fontSize: "11.5px",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  disabled={isSendingKeyAction || !keystrokeInput.trim()}
                  onClick={handleSendKeystrokes}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "#38bdf8",
                    border: "none",
                    borderRadius: "6px",
                    padding: "7px 12px",
                    color: "#0f172a",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <Send size={12} />
                  <span>Send</span>
                </button>
              </div>

              {/* Windows Macro Deck */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Windows System Macros
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {[
                    { label: "Alt + Tab", combo: "alt+tab" },
                    { label: "Win + D (Desktop)", combo: "win+d" },
                    { label: "Win + E (Explorer)", combo: "win+e" },
                    { label: "Task Manager", combo: "ctrl+shift+esc" },
                  ].map((m) => (
                    <button
                      key={m.combo}
                      type="button"
                      disabled={isSendingKeyAction}
                      onClick={() => handleHotkey(m.combo)}
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "5px",
                        padding: "4px 8px",
                        color: "#ffffff",
                        fontSize: "10.5px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick App Launcher */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Host Application Suite
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {[
                    { label: "🌐 Chrome", app: "chrome" },
                    { label: "📝 Notepad", app: "notepad" },
                    { label: "⚡ Terminal", app: "powershell" },
                    { label: "🧮 Calculator", app: "calc" },
                  ].map((a) => (
                    <button
                      key={a.app}
                      type="button"
                      disabled={isSendingKeyAction}
                      onClick={() => handleQuickLaunch(a.app)}
                      style={{
                        background: "rgba(168, 85, 247, 0.12)",
                        border: "1px solid rgba(168, 85, 247, 0.25)",
                        borderRadius: "5px",
                        padding: "4px 8px",
                        color: "#c084fc",
                        fontSize: "10.5px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                minHeight: "260px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.3)",
                borderRadius: "10px",
                border: "1px dashed rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.4)",
                padding: "20px",
                textAlign: "center",
              }}
            >
              <Camera size={36} style={{ marginBottom: "10px", opacity: 0.4 }} />
              <span style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Screen Snapshot Ready</span>
              <span style={{ fontSize: "11px", maxWidth: "260px", marginTop: "4px" }}>
                Click &quot;Snap Screen Now&quot; or execute &quot;take screenshot&quot; to view live desktop pixels.
              </span>
              <button
                type="button"
                onClick={() => handleSnapScreen(true)}
                style={{
                  marginTop: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 14px",
                  borderRadius: "6px",
                  background: "rgba(56,189,248,0.15)",
                  border: "1px solid rgba(56,189,248,0.3)",
                  color: "#38bdf8",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Camera size={13} />
                <span>Capture Desktop</span>
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
