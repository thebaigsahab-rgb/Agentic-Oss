"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Loader2,
  Bot,
  User,
  Sparkles,
  Camera,
  Play,
  RotateCcw,
  Sliders,
  TerminalSquare,
  Shield,
  BookOpen,
  Mic,
  MicOff,
  Cpu,
  MonitorPlay,
  CheckCircle2,
  Volume2,
} from "lucide-react";
import type { AgentInputMode, DeviceSnapshot } from "@/lib/computer-use-types";
import type { JarvisChatMessage, JarvisEvent, ToolResult } from "@/lib/jarvis-types";
import styles from "./computer-chatboard.module.css";

export interface ComputerChatboardProps {
  device: DeviceSnapshot | null;
  inputMode: AgentInputMode;
  onInputModeChange?: (mode: AgentInputMode) => void;
  onTriggerTeach?: () => void;
  onSwitchVirtualTab?: (direction: "next" | "prev") => void;
  onRefreshArtifacts?: () => void;
  onLaunchMission?: (goal: string) => void;
}

let chatSeq = 0;
function nextId(prefix: string) {
  chatSeq += 1;
  return `${prefix}_${Date.now()}_${chatSeq}`;
}

function renderSafeMarkdown(content: string) {
  const sanitized = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const formatted = sanitized
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="link">$1</a>',
    )
    .replace(/\n/g, "<br />");

  return <span dangerouslySetInnerHTML={{ __html: formatted }} />;
}

export function ComputerChatboard({
  device,
  inputMode,
  onInputModeChange,
  onTriggerTeach,
  onSwitchVirtualTab,
  onRefreshArtifacts,
  onLaunchMission,
}: ComputerChatboardProps) {
  const [messages, setMessages] = useState<JarvisChatMessage[]>([
    {
      id: "init_msg",
      role: "assistant",
      content:
        "**Agentic OS Motor Kernel online.** I control the entire workstation in real time — streaming YouTube playback, launching desktop applications, capturing live screenshots, cycling tabs, and executing multi-agent workflows.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeTool]);

  const handleSend = async (textOverride?: string) => {
    const promptText = (textOverride !== undefined ? textOverride : input).trim();
    if (!promptText || isStreaming) return;

    // Check for teach trigger
    if (/^(?:teach|record)\s+(?:task|skill)/i.test(promptText) || promptText.toLowerCase() === "/teach") {
      setInput("");
      onTriggerTeach?.();
      return;
    }

    // Check for direct mission delegation
    if (promptText.toLowerCase().startsWith("mission:") || promptText.toLowerCase().startsWith("away mission:")) {
      const goal = promptText.replace(/^(?:mission|away\s+mission):\s*/i, "");
      setInput("");
      onLaunchMission?.(goal);
      return;
    }

    const userMessage: JarvisChatMessage = {
      id: nextId("usr"),
      role: "user",
      content: promptText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    if (!textOverride) setInput("");
    setIsStreaming(true);

    const assistantMsgId = nextId("asst");
    const placeholderAssistant: JarvisChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, placeholderAssistant]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          mode: "operator",
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Execution error (${res.status})`);
      }

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
            const event: JarvisEvent = JSON.parse(jsonStr);
            if (event.type === "text_delta") {
              accumulated += event.text;
              setMessages((prev) =>
                prev.map((msg) => (msg.id === assistantMsgId ? { ...msg, content: accumulated } : msg)),
              );
            } else if (event.type === "tool_start") {
              setActiveTool(event.label);
            } else if (event.type === "tool_result") {
              // Trigger tab/screen side-effects if needed
              if (event.tool === "take_screenshot") {
                onRefreshArtifacts?.();
              }
              if (event.tool === "real_keyboard_type" && promptText.toLowerCase().includes("tab")) {
                onSwitchVirtualTab?.("next");
              }
              if (event.tool === "open_url" || event.tool === "play_media") {
                const targetUrl = (event.result?.data as any)?.url;
                if (targetUrl && typeof window !== "undefined") {
                  window.open(targetUrl, "_blank", "noopener,noreferrer");
                }
              }
            } else if (event.type === "done") {
              setActiveTool(null);
            } else if (event.type === "error") {
              setActiveTool(null);
              accumulated += `\n\n*(Error: ${event.message})*`;
              setMessages((prev) =>
                prev.map((msg) => (msg.id === assistantMsgId ? { ...msg, content: accumulated } : msg)),
              );
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : "Request failed";
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId ? { ...msg, content: `Operational command failed: ${errStr}` } : msg,
        ),
      );
    } finally {
      setIsStreaming(false);
      setActiveTool(null);
    }
  };

  const handleMicToggle = () => {
    if (typeof window === "undefined") return;
    type SpeechWindow = Window & {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const win = window as unknown as SpeechWindow;
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (e: any) => {
        const transcript = e.results?.[0]?.[0]?.transcript || "";
        if (transcript) {
          setInput(transcript);
          handleSend(transcript);
        }
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  return (
    <div className={styles.chatboardContainer}>
      {/* Top Header: Identity + Host Telemetry */}
      <div className={styles.topBar}>
        <div className={styles.identityArea}>
          <div className={`${styles.coreOrb} ${isStreaming ? styles.orbPulsing : ""}`}>
            <Bot size={20} />
          </div>
          <div className={styles.titleArea}>
            <h2>
              Agentic OS Real-Time Motor Cockpit
              <span className={styles.statusPill}>
                {isStreaming ? "Actuating" : "Online · Direct Control"}
              </span>
            </h2>
            <p>Full workstation actuation: YouTube playback, desktop apps, screen captures, and sub-agents.</p>
          </div>
        </div>

        {/* Live Device Telemetry Chips */}
        <div className={styles.telemetryChips}>
          <div className={styles.chip} title="Host OS Platform">
            <Cpu size={12} style={{ color: "#38bdf8" }} />
            <span>{device?.hostReady ? `${device.machine} (Win32)` : "Windows Bridge Ready"}</span>
          </div>
          {device?.cpuLoad !== null && device?.cpuLoad !== undefined && (
            <div className={styles.chip} title="Workstation CPU Load">
              <span>CPU: <strong>{device.cpuLoad}%</strong></span>
            </div>
          )}
          {device?.memoryFreeGb !== null && device?.memoryFreeGb !== undefined && (
            <div className={styles.chip} title="Free RAM">
              <span>RAM: <strong>{device.memoryFreeGb}GB free</strong></span>
            </div>
          )}
          {device?.volume !== undefined && (
            <div className={styles.chip} title="System Audio Volume">
              <Volume2 size={12} style={{ color: "#34d399" }} />
              <span>{device.volume}%{device.muted ? " (muted)" : ""}</span>
            </div>
          )}
          {device?.foregroundTitle && (
            <div className={styles.chip} title={`Active Window: ${device.foregroundTitle}`}>
              <span>Active: <strong>{device.foregroundTitle.slice(0, 20)}…</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* Sub-Agent Guild Layer Selector */}
      <div className={styles.subagentsBar}>
        <span className={styles.subagentLabel}>Specialist Guild:</span>
        <button
          type="button"
          className={styles.subagentChip}
          onClick={() => handleSend("@forge-1: Architect and verify a high-throughput systems topology")}
          title="FORGE-1: Principal Software Architect & Refactor Engine"
        >
          🛠️ <strong>FORGE-1</strong> (Architect)
        </button>
        <button
          type="button"
          className={styles.subagentChip}
          onClick={() => handleSend("@cipher-9: Run statistical telemetry analytics on CPU, memory, and task queues")}
          title="CIPHER-9: Quantitative Analyst & Data Scientist"
        >
          📊 <strong>CIPHER-9</strong> (Data/Quant)
        </button>
        <button
          type="button"
          className={styles.subagentChip}
          onClick={() => handleSend("@aegis-7: Perform zero-trust security scan on active ports, processes, and memory")}
          title="AEGIS-7: Cybersecurity Specialist & Threat Hunter"
        >
          🛡️ <strong>AEGIS-7</strong> (Security)
        </button>
        <button
          type="button"
          className={styles.subagentChip}
          onClick={() => handleSend("@nexus-4: Verify input latency, display bounds, and mouse motor coordinates")}
          title="NEXUS-4: OS & Motor Automation Engineer"
        >
          ⚡ <strong>NEXUS-4</strong> (Motor/OS)
        </button>
        <button
          type="button"
          className={`${styles.subagentChip} ${styles.subagentCouncil}`}
          onClick={() => handleSend("Council: Synthesize unified 4-agent architectural, data, and security audit")}
          title="Unified Council: Concurrently executes all 4 sub-agents and synthesizes results"
        >
          👑 <strong>COUNCIL</strong> (Unified Brain)
        </button>
      </div>

      {/* Real-Time Quick Actuation Tiles */}
      <div className={styles.quickActionsGrid}>
        <button
          type="button"
          className={styles.actionTile}
          onClick={() => handleSend("Play song arj kiya hai in YouTube right now")}
        >
          <div className={styles.actionTileIcon}><Play size={14} /></div>
          <div className={styles.actionTileMeta}>
            <b>Play Arj Kiya Hai</b>
            <small>Instant YouTube playback</small>
          </div>
        </button>

        <button
          type="button"
          className={styles.actionTile}
          onClick={() => handleSend("Take a desktop screenshot and verify active windows")}
        >
          <div className={styles.actionTileIcon}><Camera size={14} /></div>
          <div className={styles.actionTileMeta}>
            <b>Capture Screen</b>
            <small>Desktop screenshot to vault</small>
          </div>
        </button>

        <button
          type="button"
          className={styles.actionTile}
          onClick={() => handleSend("move from one tab to another")}
        >
          <div className={styles.actionTileIcon}><RotateCcw size={14} /></div>
          <div className={styles.actionTileMeta}>
            <b>Next Tab</b>
            <small>Ctrl+Tab browser switch</small>
          </div>
        </button>

        <button
          type="button"
          className={styles.actionTile}
          onClick={() => handleSend("cycle windows")}
        >
          <div className={styles.actionTileIcon}><MonitorPlay size={14} /></div>
          <div className={styles.actionTileMeta}>
            <b>Cycle Window</b>
            <small>Alt+Tab desktop window</small>
          </div>
        </button>

        <button
          type="button"
          className={styles.actionTile}
          onClick={() => handleSend("Open Steam and launch Forza 5")}
        >
          <div className={styles.actionTileIcon}><TerminalSquare size={14} /></div>
          <div className={styles.actionTileMeta}>
            <b>Steam & Forza 5</b>
            <small>Direct app launch</small>
          </div>
        </button>

        <button
          type="button"
          className={styles.actionTile}
          onClick={() => onTriggerTeach?.()}
        >
          <div className={styles.actionTileIcon}><BookOpen size={14} /></div>
          <div className={styles.actionTileMeta}>
            <b>/teach Demonstration</b>
            <small>Record custom skill</small>
          </div>
        </button>
      </div>

      {/* Interactive Messages Stream */}
      <div className={styles.messagesContainer}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.messageRow} ${msg.role === "user" ? styles.userRow : ""}`}
          >
            <div
              className={`${styles.msgAvatar} ${
                msg.role === "user" ? styles.userAvatar : styles.assistantAvatar
              }`}
            >
              {msg.role === "user" ? <User size={13} /> : <Bot size={14} />}
            </div>
            <div
              className={`${styles.msgBubble} ${
                msg.role === "user" ? styles.userBubble : styles.assistantBubble
              }`}
            >
              {msg.content ? renderSafeMarkdown(msg.content) : <Loader2 size={13} className={styles.spin} />}
            </div>
          </div>
        ))}

        {activeTool && (
          <div className={styles.activeToolBanner}>
            <Loader2 size={13} className={styles.spin} />
            <span>{activeTool}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Deck */}
      <form
        className={styles.inputForm}
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <button
          type="button"
          className={`${styles.micBtn} ${isListening ? styles.micBtnActive : ""}`}
          onClick={handleMicToggle}
          title={isListening ? "Listening… click to stop" : "Voice dictation"}
        >
          {isListening ? <MicOff size={15} /> : <Mic size={15} />}
        </button>

        <input
          type="text"
          className={styles.inputField}
          placeholder='Ask J.A.R.V.I.S. to control the computer, play YouTube, click, type, launch apps, or run sub-agents…'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isStreaming}
        />

        <button
          type="submit"
          className={styles.sendBtn}
          disabled={isStreaming || !input.trim()}
          title="Send command"
        >
          {isStreaming ? <Loader2 size={15} className={styles.spin} /> : <Send size={15} />}
        </button>
      </form>
    </div>
  );
}
