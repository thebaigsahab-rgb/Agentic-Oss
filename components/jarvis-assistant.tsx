"use client";

import React, { useEffect, useRef, useState, useId } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  Bot,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileText,
  HelpCircle,
  ListTodo,
  Loader2,
  Mic,
  MicOff,
  Radio,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
  BookOpen,
  Globe,
  Play,
  Plus,
  Trash,
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  History,
  MonitorPlay,
  TerminalSquare,
} from "lucide-react";
import type { ControlCenterTab, PublicSettings } from "@/lib/types";
import type {
  JarvisChatMessage,
  JarvisEvent,
  ProposedAction,
  TaughtTaskRun,
  ToolResult,
} from "@/lib/jarvis-types";
import type { AgenticJob, ResearchDossier, TaughtTask } from "@/lib/agentic-store";
import type { AutonomousMission } from "@/lib/computer-use-types";
import styles from "./jarvis-assistant.module.css";

interface JarvisAssistantProps {
  settings: PublicSettings;
  goTo: (tab: ControlCenterTab) => void;
  addReminder?: (title: string, note: string, url?: string) => void;
}

const EXAMPLE_PROMPTS = [
  "Play song arj kiya hai in YouTube right now",
  "Check git repository status and inspect latest commits",
  "Open Steam and launch Forza 5",
  "Switch to Work OS and inspect priority intelligence feed",
  "Council: Architect a high-throughput real-time event pipeline",
  "Take a desktop screenshot and verify active windows",
  "Teach task: Morning Sync Routine",
  "Run autonomous computer use mission on Hacker News",
  "Get system status, CPU load, and active ports",
  "Research recent papers on autonomous multi-agent systems",
];

let jarvisMessageSeq = 0;
function nextJarvisMessageId(suffix: string): string {
  jarvisMessageSeq += 1;
  return `msg_${jarvisMessageSeq}_${suffix}`;
}

type JarvisStreamHandlers = {
  onDelta: (fullText: string) => void;
  onToolStart: (label: string) => void;
  onToolResult: (tool: string, result: ToolResult) => void;
  onConfirmation: (action: ProposedAction) => void;
  onError: (message: string) => void;
  onDone: (fullText: string) => void;
};

// Reads the J.A.R.V.I.S. event stream to completion and returns the full
// assistant text. Module-level on purpose: it owns all mutable accumulation.
async function consumeJarvisStream(
  body: ReadableStream<Uint8Array>,
  handlers: JarvisStreamHandlers,
): Promise<string> {
  const reader = body.getReader();
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
          handlers.onDelta(accumulated);
        } else if (event.type === "tool_start") {
          handlers.onToolStart(event.label);
        } else if (event.type === "tool_result") {
          handlers.onToolResult(event.tool, event.result);
        } else if (event.type === "confirmation_required") {
          handlers.onConfirmation(event.action);
        } else if (event.type === "error") {
          handlers.onError(event.message);
        } else if (event.type === "done") {
          handlers.onDone(accumulated);
        }
      } catch (e) {
        console.error("Error parsing event line", e);
      }
    }
  }

  return accumulated;
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

export type JarvisPersona = "executive" | "research" | "operator" | "tactical";

type SpeechRecognitionLike = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: { length: number } & Record<number, { isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionWindow = {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

function toolData(msg: JarvisChatMessage): Record<string, unknown> | undefined {
  const result = msg.toolResult as { data?: Record<string, unknown> } | undefined;
  return result?.data;
}

export function JarvisAssistant({ settings, goTo, addReminder }: JarvisAssistantProps) {
  const id = useId();
  const [mode, setMode] = useState<"chat" | "voice">("chat");
  const [persona, setPersona] = useState<JarvisPersona>("executive");
  const [messages, setMessages] = useState<JarvisChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolActivity, setActiveToolActivity] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<ProposedAction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Background Agentic Jobs State
  const [backgroundJobs, setBackgroundJobs] = useState<AgenticJob[]>([]);
  const [selectedDossier, setSelectedDossier] = useState<ResearchDossier | null>(null);
  const [newJobQuery, setNewJobQuery] = useState("");
  const [isStartingJob, setIsStartingJob] = useState(false);

  // Taught Tasks State (Workflow Teacher)
  const [taughtTasks, setTaughtTasks] = useState<TaughtTask[]>([]);
  const [showTeachModal, setShowTeachModal] = useState(false);
  const [newTeachName, setNewTeachName] = useState("");
  const [newTeachTrigger, setNewTeachTrigger] = useState("");
  const [newTeachDesc, setNewTeachDesc] = useState("");
  const [newTeachSteps, setNewTeachSteps] = useState<string[]>([""]);
  const [isSavingTeachTask, setIsSavingTeachTask] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

  // Scheduled Routines & Run History State
  const [taskRuns, setTaskRuns] = useState<TaughtTaskRun[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [schedulingTask, setSchedulingTask] = useState<TaughtTask | null>(null);
  const [scheduleMinutes, setScheduleMinutes] = useState<number>(15);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Wall-clock tick for countdown badges (kept out of render for purity)
  const [nowMs, setNowMs] = useState<number | null>(null);

  // Voice Mode State
  const [isListening, setIsListening] = useState(false);
  const [continuousListening, setContinuousListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(true);
  const [speechRate, setSpeechRate] = useState<1.0 | 1.25>(1.0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState<string>("");
  const [speechSupported] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    Boolean((window as SpeechRecognitionWindow).SpeechRecognition || (window as unknown as SpeechRecognitionWindow).webkitSpeechRecognition),
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sendRef = useRef<(text: string) => void>(() => {});
  const pulseCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeToolActivity, pendingConfirmation]);

  // Reactive 3D Audio & Processing Pulse Canvas Animation
  useEffect(() => {
    const canvas = pulseCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let frame = 0;

    const render = () => {
      frame += 0.05;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Status color
      const baseColor = isStreaming
        ? "245, 158, 11"
        : isListening
        ? "239, 68, 68"
        : isSpeaking
        ? "16, 185, 129"
        : "56, 189, 248";

      // Concentric pulsing rings
      for (let i = 1; i <= 3; i++) {
        const radius = ((frame * 5 + i * 6) % 15) + 3;
        const alpha = Math.max(0, 1 - radius / 18);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${baseColor}, ${alpha.toFixed(2)})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Core energetic orb
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${baseColor}, 0.95)`;
      ctx.shadowColor = `rgba(${baseColor}, 0.8)`;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [isStreaming, isListening, isSpeaking]);

  // Load Background Jobs
  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/jarvis/jobs?limit=10");
      if (res.ok) {
        const data = await res.json();
        if (data.jobs) setBackgroundJobs(data.jobs);
      }
    } catch (err) {
      console.error("Failed to load background jobs", err);
    }
  };

  // Load Taught Tasks
  const fetchTaughtTasks = async () => {
    try {
      const res = await fetch("/api/jarvis/taught-tasks?limit=25");
      if (res.ok) {
        const data = await res.json();
        if (data.tasks) setTaughtTasks(data.tasks);
      }
    } catch (err) {
      console.error("Failed to load taught tasks", err);
    }
  };

  // Load Task Runs History
  const fetchTaskRuns = async () => {
    try {
      const res = await fetch("/api/jarvis/taught-tasks/runs?limit=30");
      if (res.ok) {
        const data = await res.json();
        if (data.runs) setTaskRuns(data.runs);
      }
    } catch (err) {
      console.error("Failed to load task runs", err);
    }
  };

  // Computer Use Agent Status
  const [activeComputerMission, setActiveComputerMission] = useState<AutonomousMission | null>(null);
  const [computerSkillsCount, setComputerSkillsCount] = useState<number>(0);

  const fetchComputerStatus = async () => {
    try {
      const res = await fetch("/api/computer-use");
      if (res.ok) {
        const data = await res.json();
        setActiveComputerMission(data.activeMission || null);
        setComputerSkillsCount(data.totalSkills || 0);
      }
    } catch {}
  };

  const handleScheduleTask = async (
    scheduleType: "manual" | "one_time" | "recurring",
    inMins?: number,
    intervalMins?: number,
  ) => {
    if (!schedulingTask) return;
    setIsSavingSchedule(true);
    try {
      const res = await fetch(`/api/jarvis/taught-tasks/${schedulingTask.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scheduleType,
          inMinutes: inMins,
          intervalMinutes: intervalMins,
        }),
      });
      if (res.ok) {
        setShowScheduleModal(false);
        setSchedulingTask(null);
        fetchTaughtTasks();
      }
    } catch (err) {
      console.error("Failed to schedule task", err);
    } finally {
      setIsSavingSchedule(false);
    }
  };

  useEffect(() => {
    const kickoff = setTimeout(() => {
      fetchJobs();
      fetchTaughtTasks();
      fetchTaskRuns();
      fetchComputerStatus();
    }, 0);
    const interval = setInterval(() => {
      setNowMs(Date.now());
      fetchJobs();
      fetchTaughtTasks();
      fetchComputerStatus();
    }, 6000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleteTask = async (id: string) => {
    try {
      const res = await fetch(`/api/jarvis/taught-tasks/${id}`, { method: "DELETE" });
      if (res.ok) fetchTaughtTasks();
    } catch (err) {
      console.error("Failed to delete taught task", err);
    }
  };

  const saveTeachTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeachName.trim() || !newTeachTrigger.trim()) return;
    const validSteps = newTeachSteps.map((s) => s.trim()).filter(Boolean);
    if (validSteps.length === 0) return;

    setIsSavingTeachTask(true);
    try {
      const res = await fetch("/api/jarvis/taught-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTeachName.trim(),
          triggerPhrase: newTeachTrigger.trim(),
          description: newTeachDesc.trim() || undefined,
          steps: validSteps.map((instruction, idx) => ({
            id: `step_${idx + 1}`,
            instruction,
          })),
        }),
      });
      if (res.ok) {
        setShowTeachModal(false);
        setNewTeachName("");
        setNewTeachTrigger("");
        setNewTeachDesc("");
        setNewTeachSteps([""]);
        fetchTaughtTasks();
      }
    } catch (err) {
      console.error("Failed to save taught task", err);
    } finally {
      setIsSavingTeachTask(false);
    }
  };

  // Load available speech synthesis voices
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const updateVoices = () => {
        const available = window.speechSynthesis.getVoices();
        setVoices(available);
        const british = available.find(
          (v) => v.lang === "en-GB" || v.name.includes("UK") || v.name.includes("British"),
        );
        const fallback = available.find((v) => v.lang.startsWith("en"));
        if (british) {
          setSelectedVoiceUri(british.voiceURI);
        } else if (fallback) {
          setSelectedVoiceUri(fallback.voiceURI);
        }
      };

      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window === "undefined") return;

    const speechWindow = window as SpeechRecognitionWindow;
    const RecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (!RecognitionCtor) {
      return;
    }

    const recognition: SpeechRecognitionLike = new RecognitionCtor();
    recognition.continuous = continuousListening;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
      setErrorMessage(null);
    };

    recognition.onresult = (event: SpeechRecognitionResultEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      setVoiceTranscript(interim || final);

      if (final && final.trim()) {
        const spoken = final.trim();
        setVoiceTranscript(spoken);
        sendRef.current(spoken);
        if (!continuousListening) {
          recognition.stop();
        }
      }
    };

    recognition.onerror = (event: { error: string }) => {
      if (event.error === "no-speech") return;
      if (event.error === "not-allowed" || event.error === "permission-denied") {
        setErrorMessage("Microphone permission was denied. Please allow microphone access or use Chat mode.");
      } else {
        setErrorMessage(`Voice recognition error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (continuousListening && mode === "voice") {
        try {
          recognition.start();
        } catch {}
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.abort();
      } catch {}
    };
  }, [continuousListening, mode]);

  const speakResponse = (text: string) => {
    if (!voiceOutputEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const cleanText = text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/[*_#`[\]()]/g, "")
      .trim();

    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = speechRate;

    if (selectedVoiceUri) {
      const v = voices.find((item) => item.voiceURI === selectedVoiceUri);
      if (v) utterance.voice = v;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  const handleSend = async (
    messageText?: string,
    confirmationOption?: { actionId: string; confirmed: boolean },
  ) => {
    const textToSend = (messageText !== undefined ? messageText : input).trim();
    if (!textToSend && !confirmationOption) return;

    // Fast slash commands
    if (textToSend.toLowerCase() === "/computer-use" || textToSend.toLowerCase() === "/computer") {
      setInput("");
      goTo("computer-use");
      return;
    }
    if (textToSend.toLowerCase().startsWith("/teach skill") || textToSend.toLowerCase() === "/teach") {
      setInput("");
      goTo("computer-use");
      return;
    }

    stopSpeaking();
    setErrorMessage(null);

    const userMessage: JarvisChatMessage = {
      id: nextJarvisMessageId("u"),
      role: "user",
      content: confirmationOption
        ? confirmationOption.confirmed ? "Confirm action" : "Cancel action"
        : textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    if (!messageText && !confirmationOption) setInput("");
    setIsStreaming(true);

    const assistantMessageId = nextJarvisMessageId("a");
    const initialAssistantMessage: JarvisChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, initialAssistantMessage]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
            toolCallId: m.toolCallId,
          })),
          mode,
          confirmation: confirmationOption,
          clientTimeZone,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server returned status ${res.status}`);
      }

      await consumeJarvisStream(res.body, {
        onDelta: (fullText) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId ? { ...msg, content: fullText } : msg,
            ),
          );
        },
        onToolStart: (label) => setActiveToolActivity(label),
        onToolResult: (tool, result) => {
          setActiveToolActivity(null);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, toolName: tool, toolResult: result }
                : msg,
            ),
          );
          // Refresh side panels for tools that mutate their data.
          if (tool === "start_background_job" || tool === "research_papers") {
            fetchJobs();
          }
          if (tool === "teach_task" || tool === "run_taught_task") {
            fetchTaughtTasks();
          }
          if (tool === "open_url" || tool === "play_media") {
            const data = result.data as { url?: string; openedOnDevice?: boolean } | undefined;
            const targetUrl = data?.url;
            if (targetUrl) {
              try {
                window.open(targetUrl, "_blank", "noopener,noreferrer");
              } catch {}
            }
          }
        },
        onConfirmation: (action) => setPendingConfirmation(action),
        onError: (message) => setErrorMessage(message),
        onDone: (fullText) => {
          setIsStreaming(false);
          setActiveToolActivity(null);
          if (mode === "voice" && fullText) {
            speakResponse(fullText);
          }
        },
      });
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to communicate with J.A.R.V.I.S.");
      }
    } finally {
      setIsStreaming(false);
      setActiveToolActivity(null);
      abortControllerRef.current = null;
    }
  };

  const runTask = (task: TaughtTask) => {
    setRunningTaskId(task.id);
    handleSend(`Run taught task: ${task.name}`);
    setTimeout(() => setRunningTaskId(null), 1500);
  };

  useEffect(() => {
    sendRef.current = (text: string) => {
      void handleSend(text);
    };
  });

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      setActiveToolActivity(null);
    }
  };

  const togglePushToTalk = () => {
    if (!speechSupported) {
      setErrorMessage("Speech recognition is not supported in this browser. Please use Chat mode.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      stopSpeaking();
      try {
        recognitionRef.current?.start();
      } catch (err) {
        console.error("Speech recognition start error", err);
      }
    }
  };

  const triggerNewBackgroundJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJobQuery.trim() || isStartingJob) return;

    setIsStartingJob(true);
    try {
      const res = await fetch("/api/jarvis/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: newJobQuery.trim(), type: "paper_research" }),
      });
      if (res.ok) {
        setNewJobQuery("");
        fetchJobs();
      }
    } catch (err) {
      console.error("Failed to start job", err);
    } finally {
      setIsStartingJob(false);
    }
  };

  const clearConversation = () => {
    stopSpeaking();
    setMessages([]);
    setPendingConfirmation(null);
    setErrorMessage(null);
  };

  const activeProvider = settings.ai.provider !== "none" ? settings.ai.provider : "Offline";
  const activeModel = settings.ai.model || "Default";

  return (
    <div className={styles.layout}>
      {/* Top Heading */}
      <div className="page-heading reveal">
        <div>
          <p className="eyebrow">Operational Intelligence</p>
          <h1>J.A.R.V.I.S.</h1>
          <p className="page-description">
            Autonomous operational assistant, literature research agent, and hands-free control center.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <span className="stat-chip">
            <Cpu size={14} style={{ marginRight: 5, color: "var(--coral)" }} />
            Provider: <strong>{activeProvider}</strong>
          </span>
          <span className="stat-chip">
            <Sparkles size={14} style={{ marginRight: 5, color: "#34d399" }} />
            Mode: <strong>{persona.toUpperCase()}</strong>
          </span>
          <button className="text-button" onClick={clearConversation} disabled={messages.length === 0}>
            <Trash2 size={14} /> Clear Chat
          </button>
        </div>
      </div>

      {/* Two-Column Responsive Grid */}
      <div className={styles.twoColumnGrid}>
        {/* Left Column: Console Panel */}
        <section className={styles.consolePanel}>
          {/* Header */}
          <header className={styles.header}>
            <div className={styles.identity}>
              <canvas
                ref={pulseCanvasRef}
                width={36}
                height={36}
                style={{
                  borderRadius: "50%",
                  background: "#080914",
                  border: "1px solid rgba(56, 189, 248, 0.35)",
                  boxShadow: "0 0 12px rgba(56, 189, 248, 0.25)",
                  flexShrink: 0,
                  cursor: "pointer",
                }}
                title="J.A.R.V.I.S. Core Neural Pulse"
              />
              <div className={styles.titleArea}>
                <h2>
                  Operational Console
                  <span className={styles.statusTag}>
                    {isStreaming ? "Processing" : isListening ? "Listening" : isSpeaking ? "Speaking" : "Active"}
                  </span>
                </h2>
              </div>
            </div>

            <div className={styles.headerActions}>
              {/* Mode Switcher */}
              <div className={styles.modeSwitcher} role="tablist" aria-label="Interaction mode">
                <button
                  id={`${id}-tab-chat`}
                  role="tab"
                  aria-selected={mode === "chat"}
                  aria-controls={`${id}-panel-chat`}
                  className={`${styles.modeButton} ${mode === "chat" ? styles.active : ""}`}
                  onClick={() => {
                    stopSpeaking();
                    setMode("chat");
                  }}
                >
                  Chat
                </button>
                <button
                  id={`${id}-tab-voice`}
                  role="tab"
                  aria-selected={mode === "voice"}
                  aria-controls={`${id}-panel-voice`}
                  className={`${styles.modeButton} ${mode === "voice" ? styles.active : ""}`}
                  onClick={() => setMode("voice")}
                >
                  <Mic size={13} /> Voice HUD
                </button>
              </div>
            </div>
          </header>

          {/* Persona Intelligence Selector */}
          <div className={styles.personaBar} role="tablist" aria-label="Operational Mode">
            <button
              type="button"
              className={`${styles.personaBtn} ${persona === "executive" ? styles.personaActive : ""}`}
              onClick={() => setPersona("executive")}
              title="Executive: Morning briefings, cross-service synthesis, and prioritized action dispatch"
            >
              <Sparkles size={12} />
              <span>Executive</span>
            </button>
            <button
              type="button"
              className={`${styles.personaBtn} ${persona === "research" ? styles.personaActive : ""}`}
              onClick={() => setPersona("research")}
              title="Deep Research: Academic arXiv literature mining, citation parsing, and research dossiers"
            >
              <BookOpen size={12} />
              <span>Deep Research</span>
            </button>
            <button
              type="button"
              className={`${styles.personaBtn} ${persona === "operator" ? styles.personaActive : ""}`}
              onClick={() => setPersona("operator")}
              title="Autonomous Operator: Computer use, UI workflow automation, and background away missions"
            >
              <MonitorPlay size={12} />
              <span>Operator</span>
            </button>
            <button
              type="button"
              className={`${styles.personaBtn} ${persona === "tactical" ? styles.personaActive : ""}`}
              onClick={() => setPersona("tactical")}
              title="Tactical: Rapid task execution, reminders, and direct commands"
            >
              <TerminalSquare size={12} />
              <span>Tactical</span>
            </button>
          </div>

          {/* Sub-Agent Guild Specialists Layer */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", padding: "6px 2px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", color: "#38bdf8", textTransform: "uppercase", paddingRight: "4px" }}>
              Sub-Agents:
            </span>
            <button
              type="button"
              className="stat-chip"
              style={{ cursor: "pointer", fontSize: "11px", padding: "3px 8px", background: "rgba(37,99,235,0.15)", borderColor: "rgba(56,189,248,0.3)" }}
              onClick={() => {
                const prompt = "@forge-1: Architect a fault-tolerant real-time event pipeline and systems topology.";
                setInput(prompt);
                handleSend(prompt);
              }}
              title="Dispatch to FORGE-1 (Principal Software Architect)"
            >
              🛠️ <strong>FORGE-1</strong> (Architect)
            </button>
            <button
              type="button"
              className="stat-chip"
              style={{ cursor: "pointer", fontSize: "11px", padding: "3px 8px", background: "rgba(16,185,129,0.15)", borderColor: "rgba(52,211,153,0.3)" }}
              onClick={() => {
                const prompt = "@cipher-9: Perform algorithmic data analysis on workstation metrics and telemetry trends.";
                setInput(prompt);
                handleSend(prompt);
              }}
              title="Dispatch to CIPHER-9 (Chief Data Scientist & Quant)"
            >
              📊 <strong>CIPHER-9</strong> (Data/Quant)
            </button>
            <button
              type="button"
              className="stat-chip"
              style={{ cursor: "pointer", fontSize: "11px", padding: "3px 8px", background: "rgba(244,63,94,0.15)", borderColor: "rgba(251,113,133,0.3)" }}
              onClick={() => {
                const prompt = "@aegis-7: Perform zero-trust security audit on active ports, processes, and environment secrets.";
                setInput(prompt);
                handleSend(prompt);
              }}
              title="Dispatch to AEGIS-7 (Cybersecurity & Zero-Trust Lead)"
            >
              🛡️ <strong>AEGIS-7</strong> (Security)
            </button>
            <button
              type="button"
              className="stat-chip"
              style={{ cursor: "pointer", fontSize: "11px", padding: "3px 8px", background: "rgba(245,158,11,0.15)", borderColor: "rgba(251,191,36,0.3)" }}
              onClick={() => {
                const prompt = "@nexus-4: Verify Windows input latency, display bounds, and active foreground window.";
                setInput(prompt);
                handleSend(prompt);
              }}
              title="Dispatch to NEXUS-4 (OS & Motor Automation Engineer)"
            >
              ⚡ <strong>NEXUS-4</strong> (Motor/OS)
            </button>
            <button
              type="button"
              className="stat-chip"
              style={{ cursor: "pointer", fontSize: "11px", padding: "3px 8px", background: "linear-gradient(135deg, rgba(168,85,247,0.25), rgba(59,130,246,0.25))", borderColor: "rgba(192,132,252,0.4)" }}
              onClick={() => {
                const prompt = "Council: Conduct an end-to-end multi-agent architectural, data, and security assessment of the workstation.";
                setInput(prompt);
                handleSend(prompt);
              }}
              title="Convene Unified Sub-Agent Council"
            >
              👑 <strong>COUNCIL</strong> (Unified Brain)
            </button>
          </div>

          {/* Autonomous Executive Cockpit Quick Actions */}
          <div className={styles.executiveCockpit}>
            <div className={styles.cockpitGrid}>
              <button
                type="button"
                className={styles.cockpitCard}
                onClick={() => {
                  const prompt = "Play song arj kiya hai in YouTube right now";
                  setInput(prompt);
                  handleSend(prompt);
                }}
              >
                <div className={styles.cockpitIcon}><Sparkles size={13} /></div>
                <div className={styles.cockpitMeta}>
                  <b>Play Arj Kiya Hai</b>
                  <small>Real-time YouTube stream</small>
                </div>
              </button>

              <button
                type="button"
                className={styles.cockpitCard}
                onClick={() => {
                  const prompt = "Open Steam and launch Forza 5";
                  setInput(prompt);
                  handleSend(prompt);
                }}
              >
                <div className={styles.cockpitIcon}><MonitorPlay size={13} /></div>
                <div className={styles.cockpitMeta}>
                  <b>Steam & Forza 5</b>
                  <small>Real application launch</small>
                </div>
              </button>

              <button
                type="button"
                className={styles.cockpitCard}
                onClick={() => {
                  const prompt = "Take a desktop screenshot and verify active windows";
                  setInput(prompt);
                  handleSend(prompt);
                }}
              >
                <div className={styles.cockpitIcon}><TerminalSquare size={13} /></div>
                <div className={styles.cockpitMeta}>
                  <b>Workstation Capture</b>
                  <small>Desktop screen & windows</small>
                </div>
              </button>

              <button
                type="button"
                className={styles.cockpitCard}
                onClick={() => {
                  const prompt = "Council: Synthesize a full multi-agent architectural, data, and security audit of the platform";
                  setInput(prompt);
                  handleSend(prompt);
                }}
              >
                <div className={styles.cockpitIcon}><BookOpen size={13} /></div>
                <div className={styles.cockpitMeta}>
                  <b>Sub-Agent Council</b>
                  <small>Forge + Cipher + Aegis + Nexus</small>
                </div>
              </button>
            </div>
          </div>

          {/* Main Console View */}
          {mode === "chat" ? (
            <>
              <div className={styles.messagesStream} role="log" aria-live="polite">
                {messages.length === 0 ? (
                  <div className={styles.emptyState}>
                    <div className={styles.emptyOrb}>
                      <Sparkles size={28} />
                    </div>
                    <h3>At your service.</h3>
                    <p>
                      I am J.A.R.V.I.S., your autonomous operational agent. Ask me to research academic papers,
                      execute background tasks while you are away, manage tasks, or report dashboard intelligence.
                    </p>
                    <div className={styles.examplePrompts}>
                      {EXAMPLE_PROMPTS.map((prompt, idx) => (
                        <button
                          key={idx}
                          className={styles.promptCard}
                          onClick={() => {
                            setInput(prompt);
                            handleSend(prompt);
                          }}
                        >
                          <span>{prompt}</span>
                          <ArrowRight size={13} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className={`${styles.messageRow} ${styles[msg.role]}`}>
                      <div className={`${styles.avatar} ${styles[msg.role]}`}>
                        {msg.role === "user" ? "You" : <Bot size={15} />}
                      </div>
                      <div>
                        {msg.role === "assistant" && (msg.toolName || (msg.content && msg.content.length > 180)) && (
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                              fontSize: "10.5px",
                              color: "#38bdf8",
                              background: "rgba(56, 189, 248, 0.1)",
                              border: "1px solid rgba(56, 189, 248, 0.22)",
                              borderRadius: "6px",
                              padding: "2px 8px",
                              marginBottom: "5px",
                              fontWeight: 600,
                            }}
                          >
                            <Sparkles size={11} />
                            <span>Autonomous Strategy &amp; Execution Trace</span>
                          </div>
                        )}
                        <div className={styles.bubble}>
                          {msg.content ? (
                            renderSafeMarkdown(msg.content)
                          ) : (
                            <Loader2 size={15} className={styles.spin} />
                          )}
                        </div>

                        {/* Open Action Card for open_url */}
                        {msg.toolName === "open_url" && Boolean(msg.toolResult) && (
                          <div className={styles.openActionCard}>
                            <div className={styles.openActionHeader}>
                              <span className={styles.destinationBadge}>
                                {String(toolData(msg)?.destination || "Browser").toUpperCase()}
                              </span>
                              <span className={styles.openActionUrl}>
                                {String(toolData(msg)?.url || "")}
                              </span>
                            </div>
                            <div className={styles.openActionTitle}>
                              {String(toolData(msg)?.label || "Launch Destination")}
                            </div>
                            <a
                              href={String(toolData(msg)?.url || "#")}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.openActionBtn}
                            >
                              <ExternalLink size={13} /> Open in New Tab
                            </a>
                          </div>
                        )}
                        {/* Web Analysis Card for analyze_web_page */}
                        {msg.toolName === "analyze_web_page" && Boolean(msg.toolResult) && (
                          <div className={styles.webAnalysisCard}>
                            <div className={styles.webAnalysisHeader}>
                              <span className={styles.webAnalysisBadge}>Webpage Intelligence</span>
                              <span className={styles.webAnalysisUrl}>
                                {String(toolData(msg)?.finalUrl || toolData(msg)?.url || "")}
                              </span>
                            </div>
                            <div className={styles.webAnalysisTitle}>
                              {String(toolData(msg)?.pageTitle || "Web Analysis Report")}
                            </div>
                            <div className={styles.webAnalysisSummary}>
                              {String(toolData(msg)?.summary || "")}
                            </div>
                            {Array.isArray(toolData(msg)?.keyInsights) &&
                              (toolData(msg)!.keyInsights as string[]).length > 0 && (
                                <ul className={styles.webAnalysisInsights}>
                                  {(toolData(msg)!.keyInsights as string[]).map((insight, i) => (
                                    <li key={i}>{insight}</li>
                                  ))}
                                </ul>
                              )}
                            <a
                              href={String(toolData(msg)?.finalUrl || toolData(msg)?.url || "#")}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.webAnalysisLink}
                            >
                              <ExternalLink size={12} /> View Web Page Source
                            </a>
                          </div>
                        )}

                        {/* Research Papers Custom Card */}
                        {msg.toolName === "research_papers" && Boolean(msg.toolResult) && (
                          <div className={styles.researchCard}>
                            <div className={styles.researchHeader}>
                              <div className={styles.researchBadge}>
                                <BookOpen size={12} />
                                <span>Academic Literature Review</span>
                              </div>
                              <span className={styles.researchCount}>
                                {Array.isArray(toolData(msg)?.papers)
                                  ? `${(toolData(msg)!.papers as unknown[]).length} Papers Discovered`
                                  : "Research Completed"}
                              </span>
                            </div>
                            {Array.isArray(toolData(msg)?.papers) && (
                              <div className={styles.researchPapersList}>
                                {(toolData(msg)!.papers as Array<{ title?: string; url?: string; published?: string; authors?: unknown; summary?: string }>).slice(0, 3).map((paper, idx) => (
                                  <div key={idx} className={styles.researchPaperItem}>
                                    <div className={styles.paperTitle}>{paper.title}</div>
                                    <div className={styles.paperMeta}>
                                      <span>{paper.published && !Number.isNaN(Date.parse(String(paper.published))) ? new Date(String(paper.published)).getFullYear() : "Recent"}</span>
                                      {paper.authors ? (
                                        <span> · {Array.isArray(paper.authors) ? paper.authors.slice(0, 2).map(String).join(", ") : String(paper.authors)}</span>
                                      ) : null}
                                    </div>
                                    <div className={styles.paperActions}>
                                      {paper.url && (
                                        <a href={String(paper.url || "#")} target="_blank" rel="noopener noreferrer" className={styles.paperLink}>
                                          <ExternalLink size={11} /> arXiv PDF
                                        </a>
                                      )}
                                      {addReminder && (
                                        <button
                                          type="button"
                                          className={styles.paperSaveBtn}
                                          onClick={() => addReminder(String(paper.title), String(paper.summary || "Academic research paper"), paper.url ? String(paper.url) : undefined)}
                                          title="Save to Reminders Vault"
                                        >
                                          <Bookmark size={11} /> Save Reminder
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Computer Mission Custom Card */}
                        {(msg.toolName === "start_computer_mission" || msg.toolName === "run_computer_skill") && Boolean(msg.toolResult) && (
                          <div className={styles.computerMissionCard}>
                            <div className={styles.computerMissionHeader}>
                              <div className={styles.missionPulseDot} />
                              <b>Autonomous Computer Mission Dispatched</b>
                              <span className={styles.missionModeBadge}>Unattended</span>
                            </div>
                            <p className={styles.missionGoal}>
                              “{String(
                                (toolData(msg)?.mission as { goal?: string } | undefined)?.goal ||
                                toolData(msg)?.message ||
                                (toolData(msg)?.skill as { name?: string } | undefined)?.name ||
                                "Autonomous task running",
                              )}”
                            </p>
                            <div className={styles.missionFooter}>
                              <span>
                                {(toolData(msg)?.mission as { totalSubtasks?: number } | undefined)?.totalSubtasks
                                ? `${(toolData(msg)!.mission as { totalSubtasks?: number }).totalSubtasks} Planned Subtasks`
                                : "Execution in progress"}
                              </span>
                              <button
                                type="button"
                                className={styles.missionJumpBtn}
                                onClick={() => goTo("computer-use")}
                              >
                                <MonitorPlay size={12} /> View Screen in Real-Time
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Real Device Action Card (media / volume / capture / PDF / telemetry) */}
                        {Boolean(msg.toolResult) &&
                          msg.toolName &&
                          ["play_media", "control_media", "control_volume", "take_screenshot", "save_page_pdf", "get_system_status", "list_windows"].includes(msg.toolName) && (
                          <div className={styles.toolResultCard}>
                            <div className={styles.toolResultHeader}>
                              <span>
                                <CheckCircle2 size={13} style={{ color: "var(--positive)", marginRight: 5, verticalAlign: "middle" }} />
                                Device actuated: {msg.toolName}
                              </span>
                              {msg.toolName === "play_media" && (toolData(msg) as { url?: string } | undefined)?.url ? (
                                <a className={styles.toolResultLink} href={(toolData(msg) as { url: string }).url} target="_blank" rel="noopener noreferrer">
                                  Open YouTube <ExternalLink size={11} />
                                </a>
                              ) : msg.toolName === "save_page_pdf" && (toolData(msg) as { url?: string } | undefined)?.url ? (
                                <a className={styles.toolResultLink} href={(toolData(msg) as { url: string }).url} target="_blank" rel="noopener noreferrer">
                                  Open PDF <ExternalLink size={11} />
                                </a>
                              ) : msg.toolName === "get_system_status" ? (
                                <button className={styles.toolResultLink} onClick={() => goTo("system")}>
                                  Open System Console <ExternalLink size={11} />
                                </button>
                              ) : null}
                            </div>
                            {msg.toolName === "play_media" && (
                              <div style={{ fontSize: "12.5px", marginTop: 6 }}>
                                🎬 Now playing <b>{(toolData(msg) as { title?: string; query?: string })?.title || (toolData(msg) as { query?: string })?.query}</b> on YouTube — opened on the device.
                              </div>
                            )}
                            {msg.toolName === "control_volume" && (
                              <div style={{ fontSize: "12.5px", marginTop: 6 }}>
                                🔊 {(toolData(msg) as { message?: string })?.message || "Volume updated."}
                              </div>
                            )}
                            {msg.toolName === "control_media" && (
                              <div style={{ fontSize: "12.5px", marginTop: 6 }}>
                                ⏯ Media command <b>{String((toolData(msg) as { action?: string })?.action || "sent")}</b> delivered via system media keys.
                              </div>
                            )}
                            {msg.toolName === "get_system_status" && (
                              <div style={{ fontSize: "12.5px", marginTop: 6, lineHeight: 1.5 }}>
                                🖥️ {(toolData(msg) as { summary?: string })?.summary || "Telemetry received."}
                              </div>
                            )}
                            {msg.toolName === "save_page_pdf" && (
                              <div style={{ fontSize: "12.5px", marginTop: 6 }}>
                                📄 Saved <b>{(toolData(msg) as { name?: string })?.name}</b> to the PDF vault.
                              </div>
                            )}
                            {msg.toolName === "take_screenshot" && (toolData(msg) as { url?: string })?.url && (
                              <a href={(toolData(msg) as { url: string }).url} target="_blank" rel="noopener noreferrer" style={{ display: "block", marginTop: 8 }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={(toolData(msg) as { url: string }).url}
                                  alt={(toolData(msg) as { name?: string })?.name || "Screenshot"}
                                  style={{ width: "100%", maxWidth: 420, borderRadius: 10, border: "1px solid var(--border)" }}
                                />
                              </a>
                            )}
                          </div>
                        )}

                        {/* Structured Fallback Tool Result Card */}
                        {Boolean(msg.toolResult) && msg.toolName !== "open_url" && msg.toolName !== "analyze_web_page" && msg.toolName !== "research_papers" && msg.toolName !== "start_computer_mission" && msg.toolName !== "run_computer_skill" && !(msg.toolName && ["play_media", "control_media", "control_volume", "take_screenshot", "save_page_pdf", "get_system_status", "list_windows"].includes(msg.toolName)) && (
                          <div className={styles.toolResultCard}>
                            <div className={styles.toolResultHeader}>
                              <span>
                                <CheckCircle2 size={13} style={{ color: "var(--positive)", marginRight: 5, verticalAlign: "middle" }} />
                                Executed: {msg.toolName}
                              </span>
                              {msg.toolName === "create_task" || msg.toolName === "list_tasks" ? (
                                <button className={styles.toolResultLink} onClick={() => goTo("tasks")}>
                                  Open Tasks <ExternalLink size={11} />
                                </button>
                              ) : msg.toolName === "create_reminder" || msg.toolName === "get_reminders" ? (
                                <button className={styles.toolResultLink} onClick={() => goTo("reminders")}>
                                  Open Reminders <ExternalLink size={11} />
                                </button>
                              ) : msg.toolName === "start_background_job" ? (
                                <button className={styles.toolResultLink} onClick={fetchJobs}>
                                  View Dossiers <ExternalLink size={11} />
                                </button>
                              ) : msg.toolName === "teach_task" || msg.toolName === "run_taught_task" ? (
                                <button className={styles.toolResultLink} onClick={fetchTaughtTasks}>
                                  View Workflows <BookOpen size={11} />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        )}

                        {/* Expandable Neural Execution Trace */}
                        {msg.role === "assistant" && msg.content && (
                          <details className={styles.cognitionTrace}>
                            <summary className={styles.cognitionSummary}>
                              <Cpu size={11} />
                              <span>Agent Execution Trace</span>
                            </summary>
                            <div className={styles.cognitionBody}>
                              <div className={styles.cognitionStep}>
                                <CheckCircle2 size={11} className={styles.stepSuccess} />
                                <span>Operational Mode: <strong>{persona.toUpperCase()}</strong></span>
                              </div>
                              {msg.toolName && (
                                <div className={styles.cognitionStep}>
                                  <CheckCircle2 size={11} className={styles.stepSuccess} />
                                  <span>Executed tool primitive <code>{msg.toolName}</code></span>
                                </div>
                              )}
                              <div className={styles.cognitionStep}>
                                <CheckCircle2 size={11} className={styles.stepSuccess} />
                                <span>Workspace invariants & state validated</span>
                              </div>
                            </div>
                          </details>
                        )}

                        <span className={styles.timestamp}>{msg.timestamp}</span>
                      </div>
                    </div>
                  ))
                )}

                {/* Active Tool Chip */}
                {activeToolActivity && (
                  <div className={styles.toolChip}>
                    <Loader2 size={13} className={styles.spin} />
                    <span>{activeToolActivity}</span>
                  </div>
                )}

                {/* Confirmation Card */}
                {pendingConfirmation && (
                  <div className={styles.confirmationCard}>
                    <div className={styles.confirmationTitle}>
                      <AlertTriangle size={15} /> Confirmation Required
                    </div>
                    <div className={styles.confirmationSummary}>
                      {pendingConfirmation.summary}
                    </div>
                    <div className={styles.confirmationActions}>
                      <button
                        className={styles.confirmBtn}
                        onClick={() => {
                          const action = pendingConfirmation;
                          setPendingConfirmation(null);
                          handleSend(undefined, { actionId: action.actionId, confirmed: true });
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        className={styles.cancelBtn}
                        onClick={() => {
                          const action = pendingConfirmation;
                          setPendingConfirmation(null);
                          handleSend(undefined, { actionId: action.actionId, confirmed: false });
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {errorMessage && (
                  <div className="error-banner" style={{ margin: "10px 18px" }}>
                    <AlertTriangle size={14} />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Chat Composer */}
              <div className={styles.composer}>
                {/* Agentic OS Quick Command Chips (from Vivek Mishra repo) */}
                <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "6px", marginBottom: "4px" }}>
                  <button
                    type="button"
                    onClick={() => handleSend("Research recent breakthroughs in autonomous multi-agent systems via Perplexity Sonar")}
                    style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", padding: "4px 10px", borderRadius: "14px", color: "#f87171", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
                  >
                    🔬 Perplexity Sonar Research
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSend("Deploy autonomous scraper worker to Hacker News and rank feed 0-100")}
                    style={{ background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.3)", padding: "4px 10px", borderRadius: "14px", color: "#38bdf8", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
                  >
                    ⚡ Scraper &amp; Priority Feed
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSend("Draft an editorial news post from the top feed article and prepare Studio card")}
                    style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", padding: "4px 10px", borderRadius: "14px", color: "#c084fc", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
                  >
                    ✍️ Content Studio Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSend("Take a desktop screenshot and verify active windows")}
                    style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", padding: "4px 10px", borderRadius: "14px", color: "#34d399", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
                  >
                    📸 Snap Desktop Screen
                  </button>
                </div>

                <form
                  className={styles.composerForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                  }}
                >
                  <textarea
                    className={styles.textarea}
                    placeholder="Ask J.A.R.V.I.S. (e.g., 'Research papers on multi-agent LLMs', 'Start background research')..."
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    maxLength={2500}
                  />

                  {isStreaming ? (
                    <button
                      type="button"
                      className={styles.sendButton}
                      style={{ background: "var(--danger)" }}
                      onClick={handleStopGeneration}
                      title="Stop generating"
                    >
                      <Square size={15} />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className={styles.sendButton}
                      disabled={!input.trim()}
                      title="Send message (Enter)"
                    >
                      <Send size={15} />
                    </button>
                  )}
                </form>

                <div className={styles.composerMeta}>
                  <span>
                    Model: <strong>{activeModel}</strong>
                  </span>
                  <span>{input.length}/2500</span>
                </div>
              </div>
            </>
          ) : (
            /* Voice HUD Mode */
            <div className={styles.voiceHud}>
              <div
                className={`${styles.hudRingsContainer} ${
                  isListening ? styles.listening : isSpeaking ? styles.speaking : ""
                }`}
              >
                <div className={styles.hudRing} />
                <div className={styles.hudRing} />
                <div className={styles.hudRing} />
                <button
                  className={styles.hudCenterOrb}
                  onClick={togglePushToTalk}
                  title={isListening ? "Click to stop listening" : "Click to speak"}
                >
                  {isListening ? <MicOff size={26} /> : <Mic size={26} />}
                </button>
              </div>

              <div className={styles.hudStatusText}>
                <div className={styles.hudStateLabel}>
                  {isListening
                    ? "Listening to voice…"
                    : isStreaming
                    ? "Executing Autonomous Request…"
                    : isSpeaking
                    ? "Speaking…"
                    : "Push to Talk"}
                </div>
                <div className={styles.hudTranscript}>
                  {voiceTranscript ? `"${voiceTranscript}"` : "Tap microphone or enable continuous listening."}
                </div>
              </div>

              {/* Voice Controls Bar */}
              <div className={styles.voiceControlsBar}>
                <button
                  className={`${styles.voiceBtn} ${continuousListening ? styles.active : ""}`}
                  onClick={() => setContinuousListening((val) => !val)}
                >
                  <Radio size={13} /> {continuousListening ? "Continuous: On" : "Continuous: Off"}
                </button>

                <button
                  className={`${styles.voiceBtn} ${voiceOutputEnabled ? styles.active : ""}`}
                  onClick={() => {
                    if (isSpeaking) stopSpeaking();
                    setVoiceOutputEnabled((val) => !val);
                  }}
                >
                  {voiceOutputEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                  {voiceOutputEnabled ? "Voice Audio" : "Muted"}
                </button>

                {isSpeaking && (
                  <button className={`${styles.voiceBtn}`} onClick={stopSpeaking} style={{ color: "var(--danger)" }}>
                    <Square size={12} /> Stop Speaking
                  </button>
                )}

                <button
                  className={styles.voiceBtn}
                  onClick={() => setSpeechRate((rate) => (rate === 1.0 ? 1.25 : 1.0))}
                >
                  Speed: {speechRate}x
                </button>

                {voices.length > 0 && (
                  <select
                    className={styles.voiceSelect}
                    value={selectedVoiceUri}
                    onChange={(e) => setSelectedVoiceUri(e.target.value)}
                    aria-label="Select voice"
                  >
                    {voices
                      .filter((v) => v.lang.startsWith("en"))
                      .slice(0, 8)
                      .map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                  </select>
                )}
              </div>

              {errorMessage && (
                <div className="error-banner">
                  <AlertTriangle size={14} />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right Column: Autonomous Agentic Research & Background Tasks */}
        <aside className={styles.agenticSidePanel}>
          {/* Autonomous Computer Agent Card */}
          <div className={styles.agenticCard} style={{ borderColor: "rgba(59, 130, 246, 0.4)", background: "rgba(15, 23, 42, 0.65)" }}>
            <div className={styles.agenticCardHeader}>
              <h3>
                <MonitorPlay size={16} style={{ color: "#38bdf8" }} /> Autonomous Computer Agent
              </h3>
              <span
                style={{
                  fontSize: "10.5px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: activeComputerMission?.status === "running" ? "rgba(16, 185, 129, 0.2)" : "rgba(56, 189, 248, 0.15)",
                  color: activeComputerMission?.status === "running" ? "#34d399" : "#38bdf8",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                {activeComputerMission?.status === "running" ? (
                  <>
                    <Loader2 size={10} className={styles.spin} /> Away Mission Active
                  </>
                ) : (
                  "Ready"
                )}
              </span>
            </div>
            <p style={{ fontSize: "12px", color: "var(--muted)", margin: 0, lineHeight: 1.4 }}>
              Human-like desktop & browser automation. Executes missions in background while you are outside.
            </p>

            {activeComputerMission && activeComputerMission.status === "running" ? (
              <div
                style={{
                  padding: "8px 10px",
                  background: "rgba(30, 41, 59, 0.8)",
                  borderRadius: "6px",
                  border: "1px solid rgba(56, 189, 248, 0.25)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 600 }}>Active Mission:</div>
                <div style={{ fontSize: "12px", color: "#f1f5f9" }}>{activeComputerMission.goal}</div>
                <div style={{ fontSize: "10.5px", color: "var(--faint)" }}>
                  Step {activeComputerMission.currentSubtaskIndex + 1} of {activeComputerMission.totalSubtasks}
                </div>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "8px", marginTop: "2px" }}>
              <button
                className="button"
                style={{ flex: 1, padding: "6px 10px", fontSize: "11.5px", background: "linear-gradient(135deg, #2563eb, #0284c7)" }}
                onClick={() => goTo("computer-use")}
              >
                <MonitorPlay size={12} /> Open Computer Use
              </button>
              <button
                className="text-button"
                style={{ padding: "6px 10px", fontSize: "11.5px" }}
                onClick={() => {
                  setInput("I am going outside, please perform ");
                }}
                title="Prompt an autonomous away mission"
              >
                Going Outside
              </button>
            </div>
          </div>

          {/* Taught Tasks & Workflows Card (Teach Task Rockboard Feature) */}
          <div className={styles.agenticCard}>
            <div className={styles.agenticCardHeader}>
              <h3>
                <BookOpen size={16} style={{ color: "var(--coral)" }} /> Taught Tasks & Workflows
              </h3>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <button
                  className={styles.historyBtn}
                  onClick={() => {
                    fetchTaskRuns();
                    setShowHistoryModal(true);
                  }}
                  title="View task execution logs"
                >
                  <History size={12} /> History
                </button>
                <button
                  className="text-button"
                  style={{ padding: "3px 8px", fontSize: "11px" }}
                  onClick={() => setShowTeachModal(true)}
                >
                  <Plus size={12} /> Teach Task
                </button>
              </div>
            </div>
            <p style={{ fontSize: "12px", color: "var(--muted)", margin: 0, lineHeight: 1.4 }}>
              Learned procedures and custom multi-step routines taught to J.A.R.V.I.S.
            </p>
            {taughtTasks.length === 0 ? (
              <p style={{ fontSize: "12px", color: "var(--muted)", fontStyle: "italic", margin: 0 }}>
                No custom tasks taught yet. Teach via voice/chat or click “+ Teach Task”.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {taughtTasks.map((task) => (
                  <div key={task.id} className={styles.taughtTaskItem}>
                    <div className={styles.taughtTaskTop}>
                      <span className={styles.taughtTaskName}>{task.name}</span>
                      <span className={styles.triggerBadge}>“{task.triggerPhrase}”</span>
                    </div>
                    {task.description && <div className={styles.taughtTaskDesc}>{task.description}</div>}
                    <div className={styles.taughtTaskActions}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "10.5px", color: "var(--faint)" }}>
                          {task.steps.length} {task.steps.length === 1 ? "step" : "steps"} · Run {task.runCount}x
                        </span>
                        {task.scheduleType === "one_time" && task.scheduledTime ? (
                          <span className={`${styles.scheduleBadge} ${styles.scheduled}`} title={`Scheduled at ${task.scheduledTime}`}>
                            <Clock size={10} /> In {nowMs === null ? "…" : Math.max(0, Math.round((new Date(task.scheduledTime).getTime() - nowMs) / 60000))}m
                          </span>
                        ) : task.scheduleType === "recurring" ? (
                          <span className={`${styles.scheduleBadge} ${styles.recurring}`} title={`Every ${task.intervalMinutes}m`}>
                            <RotateCcw size={10} /> Every {task.intervalMinutes}m
                          </span>
                        ) : (
                          <span className={styles.scheduleBadge}>Manual</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <button
                          className={styles.scheduleBtn}
                          onClick={() => {
                            setSchedulingTask(task);
                            setShowScheduleModal(true);
                          }}
                          title="Schedule this routine"
                        >
                          <Calendar size={11} /> Schedule
                        </button>
                        <button
                          className={styles.runTaskBtn}
                          disabled={runningTaskId === task.id}
                          onClick={() => runTask(task)}
                        >
                          {runningTaskId === task.id ? <Loader2 size={11} className={styles.spin} /> : <Play size={11} />}
                          Run
                        </button>
                        <button
                          className={styles.deleteTaskBtn}
                          onClick={() => deleteTask(task.id)}
                          title="Delete taught task"
                        >
                          <Trash size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Trigger Card */}
          <div className={styles.agenticCard}>
            <div className={styles.agenticCardHeader}>
              <h3>
                <Sparkles size={16} style={{ color: "var(--coral)" }} /> Launch Background Research
              </h3>
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
              Queues an autonomous literature review and paper search. Executes independently while you are away from home.
            </p>
            <form onSubmit={triggerNewBackgroundJob} style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                className="input"
                style={{ flex: 1, padding: "7px 10px", fontSize: "12.5px" }}
                placeholder="Topic: e.g. solid-state batteries, LLM agents"
                value={newJobQuery}
                onChange={(e) => setNewJobQuery(e.target.value)}
              />
              <button
                type="submit"
                className="button"
                style={{ padding: "7px 14px", fontSize: "12px" }}
                disabled={!newJobQuery.trim() || isStartingJob}
              >
                {isStartingJob ? <Loader2 size={13} className={styles.spin} /> : "Launch"}
              </button>
            </form>
          </div>

          {/* Autonomous Background Jobs List */}
          <div className={styles.agenticCard}>
            <div className={styles.agenticCardHeader}>
              <h3>
                <FileText size={16} style={{ color: "var(--yellow)" }} /> Autonomous Agentic Dossiers
              </h3>
              <span style={{ fontSize: "11px", color: "var(--faint)" }}>
                {backgroundJobs.length} records
              </span>
            </div>

            {backgroundJobs.length === 0 ? (
              <p style={{ fontSize: "12.5px", color: "var(--muted)", margin: 0, fontStyle: "italic" }}>
                No background jobs recorded yet. Ask J.A.R.V.I.S. by voice/text or use the launch box above.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {backgroundJobs.slice(0, 6).map((job) => (
                  <div key={job.id} className={styles.jobItem}>
                    <div className={styles.jobItemTop}>
                      <span className={styles.jobQuery}>{job.query}</span>
                      <span className={`${styles.statusBadge} ${styles[job.status]}`}>
                        {job.status}
                      </span>
                    </div>

                    <div className={styles.jobProgress}>
                      {job.progress || (job.status === "completed" ? "Synthesis complete." : "Processing…")}
                    </div>

                    {job.dossier && (
                      <button
                        className={styles.viewDossierBtn}
                        onClick={() => setSelectedDossier(job.dossier!)}
                      >
                        <Search size={12} /> Read Dossier ({job.dossier.papers?.length || 0} papers)
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Research Dossier Modal */}
      {selectedDossier && (
        <div className={styles.modalOverlay} onClick={() => setSelectedDossier(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>{selectedDossier.title}</h3>
              <button
                className="icon-button"
                onClick={() => setSelectedDossier(null)}
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div>
                <div className={styles.dossierSectionTitle}>Executive Summary</div>
                <p style={{ margin: 0 }}>{selectedDossier.executiveSummary}</p>
              </div>

              {selectedDossier.keyInsights && selectedDossier.keyInsights.length > 0 && (
                <div>
                  <div className={styles.dossierSectionTitle}>Key Scientific Insights</div>
                  <ul style={{ margin: 0, paddingLeft: "18px" }}>
                    {selectedDossier.keyInsights.map((insight, idx) => (
                      <li key={idx} style={{ marginBottom: "4px" }}>
                        {insight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedDossier.recommendedActions && selectedDossier.recommendedActions.length > 0 && (
                <div>
                  <div className={styles.dossierSectionTitle}>Recommended Next Steps</div>
                  <ul style={{ margin: 0, paddingLeft: "18px" }}>
                    {selectedDossier.recommendedActions.map((action, idx) => (
                      <li key={idx} style={{ marginBottom: "4px" }}>
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className={styles.dossierSectionTitle}>
                  Cited Academic Papers ({selectedDossier.papers?.length || 0})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
                  {selectedDossier.papers && selectedDossier.papers.length > 0 ? (
                    selectedDossier.papers.map((paper, idx) => (
                      <div key={idx} className={styles.paperCard}>
                        <div className={styles.paperTitle}>{paper.title}</div>
                        <div className={styles.paperAuthors}>
                          {paper.authors?.join(", ") || "Unknown authors"} · Published {paper.published.slice(0, 10)}
                        </div>
                        <div className={styles.paperSummary}>{paper.summary}</div>
                        <div className={styles.paperLinks}>
                          <a href={String(paper.url || "#")} target="_blank" rel="noopener noreferrer" className={styles.paperLink}>
                            arXiv Page <ExternalLink size={10} />
                          </a>
                          {paper.pdfUrl && (
                            <a href={paper.pdfUrl} target="_blank" rel="noopener noreferrer" className={styles.paperLink}>
                              PDF Preprint <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p style={{ fontSize: "12px", color: "var(--muted)" }}>No direct paper preprints attached.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Teach Task Modal (Workflow Builder) */}
      {showTeachModal && (
        <div className={styles.modalOverlay} onClick={() => setShowTeachModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()} style={{ maxWidth: "560px" }}>
            <div className={styles.modalHeader}>
              <h3 style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <BookOpen size={17} style={{ color: "var(--coral)" }} /> Teach J.A.R.V.I.S. a Task Routine
              </h3>
              <button
                className="icon-button"
                onClick={() => setShowTeachModal(false)}
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={saveTeachTask} className={styles.modalBody}>
              <div>
                <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Task / Procedure Name
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="e.g. Morning Sync Routine"
                  value={newTeachName}
                  onChange={(e) => setNewTeachName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Trigger Phrase (Spoken or Typed)
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="e.g. morning routine, daily sync"
                  value={newTeachTrigger}
                  onChange={(e) => setNewTeachTrigger(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Description (Optional)
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="What does this taught workflow do?"
                  value={newTeachDesc}
                  onChange={(e) => setNewTeachDesc(e.target.value)}
                />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ fontSize: "12px", color: "var(--muted)" }}>Step-by-Step Instructions</label>
                  <button
                    type="button"
                    className="text-button"
                    style={{ fontSize: "11px", padding: "2px 6px" }}
                    onClick={() => setNewTeachSteps([...newTeachSteps, ""])}
                  >
                    <Plus size={11} /> Add Step
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {newTeachSteps.map((step, idx) => (
                    <div key={idx} className={styles.teachTaskStepRow}>
                      <span style={{ fontSize: "11px", color: "var(--faint)", width: "18px" }}>{idx + 1}.</span>
                      <input
                        type="text"
                        className="input"
                        style={{ flex: 1 }}
                        placeholder="e.g. Check tasks for today, open YouTube search for news, etc."
                        value={step}
                        onChange={(e) => {
                          const copy = [...newTeachSteps];
                          copy[idx] = e.target.value;
                          setNewTeachSteps(copy);
                        }}
                        required
                      />
                      {newTeachSteps.length > 1 && (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => {
                            setNewTeachSteps(newTeachSteps.filter((_, i) => i !== idx));
                          }}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button type="button" className="text-button" onClick={() => setShowTeachModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="button" disabled={isSavingTeachTask}>
                  {isSavingTeachTask ? <Loader2 size={13} className={styles.spin} /> : "Save Taught Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Schedule Routine Modal */}
      {showScheduleModal && schedulingTask && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard} style={{ maxWidth: "450px" }}>
            <div className={styles.modalHeader}>
              <div>
                <span className="eyebrow">Autonomous Scheduler</span>
                <h3 style={{ margin: "2px 0 0 0" }}>Schedule Routine</h3>
              </div>
              <button className="icon-button" onClick={() => setShowScheduleModal(false)}>
                <X size={15} />
              </button>
            </div>

            <p style={{ fontSize: "12.5px", color: "var(--muted)", margin: "0 0 14px 0", lineHeight: 1.45 }}>
              Configure when <strong>“{schedulingTask.name}”</strong> will execute autonomously on the server, even while you are away from home.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: "12px", color: "var(--ink)", fontWeight: 600 }}>Quick One-Time Triggers</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button
                  type="button"
                  className="button secondary"
                  style={{ fontSize: "12px", padding: "8px 10px", justifyContent: "center" }}
                  disabled={isSavingSchedule}
                  onClick={() => handleScheduleTask("one_time", 5)}
                >
                  <Clock size={13} /> In 5 Minutes
                </button>
                <button
                  type="button"
                  className="button secondary"
                  style={{ fontSize: "12px", padding: "8px 10px", justifyContent: "center" }}
                  disabled={isSavingSchedule}
                  onClick={() => handleScheduleTask("one_time", 15)}
                >
                  <Clock size={13} /> In 15 Minutes
                </button>
                <button
                  type="button"
                  className="button secondary"
                  style={{ fontSize: "12px", padding: "8px 10px", justifyContent: "center" }}
                  disabled={isSavingSchedule}
                  onClick={() => handleScheduleTask("one_time", 60)}
                >
                  <Clock size={13} /> In 1 Hour
                </button>
                <button
                  type="button"
                  className="button secondary"
                  style={{ fontSize: "12px", padding: "8px 10px", justifyContent: "center" }}
                  disabled={isSavingSchedule}
                  onClick={() => handleScheduleTask("one_time", 180)}
                >
                  <Clock size={13} /> In 3 Hours
                </button>
              </div>

              <div style={{ fontSize: "12px", color: "var(--ink)", fontWeight: 600, marginTop: 6 }}>Recurring Schedules</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button
                  type="button"
                  className="button secondary"
                  style={{ fontSize: "12px", padding: "8px 10px", justifyContent: "center" }}
                  disabled={isSavingSchedule}
                  onClick={() => handleScheduleTask("recurring", undefined, 60)}
                >
                  <RotateCcw size={13} /> Every 1 Hour
                </button>
                <button
                  type="button"
                  className="button secondary"
                  style={{ fontSize: "12px", padding: "8px 10px", justifyContent: "center" }}
                  disabled={isSavingSchedule}
                  onClick={() => handleScheduleTask("recurring", undefined, 1440)}
                >
                  <RotateCcw size={13} /> Daily (Every 24h)
                </button>
              </div>

              {schedulingTask.scheduleType !== "manual" && (
                <button
                  type="button"
                  className="text-button"
                  style={{ alignSelf: "flex-start", marginTop: 8, color: "var(--danger)", fontSize: "11.5px" }}
                  disabled={isSavingSchedule}
                  onClick={() => handleScheduleTask("manual")}
                >
                  Clear Schedule (Revert to Manual Trigger)
                </button>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="text-button" onClick={() => setShowScheduleModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Autonomous Run History Modal */}
      {showHistoryModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard} style={{ maxWidth: "650px", maxHeight: "80vh", overflowY: "auto" }}>
            <div className={styles.modalHeader}>
              <div>
                <span className="eyebrow">Execution Logs</span>
                <h3 style={{ margin: "2px 0 0 0" }}>Autonomous Task History</h3>
              </div>
              <button className="icon-button" onClick={() => setShowHistoryModal(false)}>
                <X size={15} />
              </button>
            </div>

            <p style={{ fontSize: "12.5px", color: "var(--muted)", margin: "0 0 12px 0", lineHeight: 1.45 }}>
              Review all background runs and routine executions performed autonomously while you were away from home.
            </p>

            {taskRuns.length === 0 ? (
              <p style={{ fontSize: "12.5px", color: "var(--muted)", fontStyle: "italic", margin: "16px 0" }}>
                No task runs recorded yet. Run a routine or wait for a scheduled trigger.
              </p>
            ) : (
              <table className={styles.historyTable}>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Trigger</th>
                    <th>Executed At</th>
                    <th>Status</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {taskRuns.map((run) => (
                    <tr key={run.id}>
                      <td style={{ fontWeight: 600 }}>{run.taskName}</td>
                      <td>
                        <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "capitalize" }}>
                          {run.triggeredBy}
                        </span>
                      </td>
                      <td style={{ fontSize: "11px", color: "var(--muted)" }}>
                        {new Date(run.executedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td>
                        <span className={`${styles.statusPill} ${styles[run.status]}`}>
                          {run.status}
                        </span>
                      </td>
                      <td style={{ fontSize: "11px", color: "var(--muted)", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {run.summary || `${run.stepResults.length} steps`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="button" onClick={() => setShowHistoryModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


