"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { generateQrSvg } from "@/lib/qr-code";
import { copyToClipboard } from "@/lib/clipboard";
import {
  Smartphone,
  MousePointer,
  Wifi,
  QrCode,
  Copy,
  Check,
  Volume2,
  VolumeX,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Camera,
  Terminal,
  Send,
  Loader2,
  ExternalLink,
  Sparkles,
  RefreshCw,
  AppWindow,
  LayoutDashboard,
  Briefcase,
  Bot,
  MonitorPlay,
  KeyRound,
  FileText,
  ListTodo,
  Radio,
  Mic,
  MicOff,
  Search,
  Globe,
  Plus,
  CheckCircle2,
  Sliders,
  Maximize2,
} from "lucide-react";
import type { ContentOsState } from "@/lib/content-os-store";

export function RemoteControl({ isStandalone = false }: { isStandalone?: boolean }) {
  const [localIp, setLocalIp] = useState("192.168.0.36");
  const [port, setPort] = useState("3000");
  const [pairingPin, setPairingPin] = useState("849201");
  const [cryptoQrPayload, setCryptoQrPayload] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  // Active mobile tab: "agenda" | "work" | "jarvis" | "computer" | "trackpad"
  const [mobileTab, setMobileTab] = useState<"agenda" | "work" | "jarvis" | "computer" | "trackpad">("trackpad");

  // Telemetry state
  const [telemetry, setTelemetry] = useState<{ cpu: number | null; ram: number | null; window: string }>({
    cpu: null,
    ram: null,
    window: "",
  });

  // Daily Brief & Agenda State
  const [briefItems, setBriefItems] = useState<any[]>([]);
  const [loadingBrief, setLoadingBrief] = useState(false);

  // Work & Content OS State
  const [workData, setWorkData] = useState<ContentOsState | null>(null);
  const [workLoading, setWorkLoading] = useState(false);
  const [mobileResearchQuery, setMobileResearchQuery] = useState("");
  const [mobileTaskInput, setMobileTaskInput] = useState("");

  // Jarvis Assistant State
  const [jarvisCommand, setJarvisCommand] = useState("");
  const [jarvisResponse, setJarvisResponse] = useState<string>("");
  const [isSendingJarvis, setIsSendingJarvis] = useState(false);
  const [isListeningJarvis, setIsListeningJarvis] = useState(false);
  const [jarvisChatHistory, setJarvisChatHistory] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    { role: "assistant", text: "J.A.R.V.I.S. connected to mobile interface. Speak or type instructions." },
  ]);

  // Computer Use & Screen State
  const [screenPreviewUrl, setScreenPreviewUrl] = useState<string | null>(null);
  const [isLoadingScreen, setIsLoadingScreen] = useState(false);
  const [autoRefreshScreen, setAutoRefreshScreen] = useState(false);
  const [textToSendToPc, setTextToSendToPc] = useState("");

  // Touchpad state
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const lastSendTimeRef = useRef<number>(0);

  // Vibration feedback helper
  const triggerHaptic = () => {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(12);
      } catch {}
    }
  };

  // Sync hostname & port
  useEffect(() => {
    if (typeof window !== "undefined") {
      setPort(window.location.port || "3000");
      if (window.location.hostname && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        setLocalIp(window.location.hostname);
      }
    }

    const fetchTelemetry = async () => {
      try {
        const res = await fetch("/api/system");
        const data = await res.json().catch(() => ({}));
        if (data) {
          if (data.lanIp) setLocalIp(data.lanIp);
          setTelemetry({
            cpu: data.cpuLoad ?? null,
            ram: data.memoryFreeGb ?? null,
            window: data.foregroundTitle ?? "",
          });
        }
      } catch {}
    };

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Daily Brief
  const fetchBrief = async () => {
    setLoadingBrief(true);
    try {
      const res = await fetch("/api/brief");
      const data = await res.json().catch(() => ({}));
      if (data && data.items) setBriefItems(data.items);
    } catch {}
    setLoadingBrief(false);
  };

  // Fetch Work OS State
  const fetchWorkState = async () => {
    setWorkLoading(true);
    try {
      const res = await fetch("/api/work");
      const data = await res.json().catch(() => ({}));
      if (data && data.data) setWorkData(data.data);
    } catch {}
    setWorkLoading(false);
  };

  useEffect(() => {
    if (mobileTab === "agenda" && briefItems.length === 0) {
      fetchBrief();
    }
    if (mobileTab === "work") {
      fetchWorkState();
    }
  }, [mobileTab]);

  // Auto-refresh screen loop if enabled
  useEffect(() => {
    if (!autoRefreshScreen || mobileTab !== "computer") return;
    const interval = setInterval(() => {
      handleSnapScreen(false);
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefreshScreen, mobileTab]);

  const [qrTarget, setQrTarget] = useState<"desktop" | "remote">("desktop");
  const remoteUrl = `http://${localIp}:${port}/remote`;
  const fullDesktopUrl = `http://${localIp}:${port}/`;
  const workUrl = `http://${localIp}:${port}/work`;
  const activePairUrl = qrTarget === "desktop" ? fullDesktopUrl : remoteUrl;
  const qrSvg = useMemo(
    () => generateQrSvg(cryptoQrPayload || activePairUrl, 5),
    [cryptoQrPayload, activePairUrl]
  );

  // Request fresh cryptographic pairing challenge from server
  useEffect(() => {
    if (!showQrModal) return;
    const fetchPairingChallenge = async () => {
      try {
        const res = await fetch("/api/remote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pair_init" }),
        });
        const data = await res.json().catch(() => ({}));
        if (data && data.ok) {
          if (data.pin) setPairingPin(data.pin);
          if (data.qrPayload) setCryptoQrPayload(data.qrPayload);
        }
      } catch {}
    };
    fetchPairingChallenge();
  }, [showQrModal]);

  const copyUrl = async (targetUrl: string = activePairUrl) => {
    triggerHaptic();
    await copyToClipboard(targetUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper to extract CSRF token from document cookie
  const getCsrfToken = () => {
    if (typeof document === "undefined") return "";
    const match = document.cookie.match(/(?:^|; )agentic_csrf=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : "";
  };

  // Send input action to PC system API with anti-CSRF headers
  const sendAction = async (payload: Record<string, unknown>) => {
    triggerHaptic();
    try {
      const csrf = getCsrfToken();
      await fetch("/api/system", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch {}
  };

  // Touchpad touch handlers (sub-16ms throttle for 60fps tracking)
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    lastTouchRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!lastTouchRef.current) return;
    const touch = e.touches[0];
    const dx = (touch.clientX - lastTouchRef.current.x) * 1.6;
    const dy = (touch.clientY - lastTouchRef.current.y) * 1.6;
    lastTouchRef.current = { x: touch.clientX, y: touch.clientY };

    const now = Date.now();
    if (now - lastSendTimeRef.current > 16) {
      lastSendTimeRef.current = now;
      void sendAction({ action: "touchpad_move", dx, dy });
    }
  };

  const handleTouchEnd = () => {
    if (touchStartRef.current && lastTouchRef.current) {
      const dist = Math.hypot(
        lastTouchRef.current.x - touchStartRef.current.x,
        lastTouchRef.current.y - touchStartRef.current.y,
      );
      if (dist < 7) {
        void sendAction({ action: "click_mouse", button: "left" });
      }
    }
    touchStartRef.current = null;
    lastTouchRef.current = null;
  };

  const handleScrollTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (lastTouchRef.current) {
      const dy = (lastTouchRef.current.y - touch.clientY) * 12;
      void sendAction({ action: "scroll", dy });
    }
    lastTouchRef.current = { x: touch.clientX, y: touch.clientY };
  };

  // Jarvis command submission
  const handleSendJarvis = async (cmdText?: string) => {
    triggerHaptic();
    const cmd = (cmdText || jarvisCommand).trim();
    if (!cmd) return;

    setJarvisCommand("");
    setIsSendingJarvis(true);
    setJarvisResponse("Processing instruction...");
    setJarvisChatHistory((prev) => [...prev, { role: "user", text: cmd }]);

    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: cmd }],
          mode: "chat",
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
      });

      let reply = "";
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
                setJarvisResponse(accumulated);
              } else if (ev.type === "error" && ev.message) {
                accumulated = ev.message;
                setJarvisResponse(accumulated);
              }
            } catch {}
          }
        }
        reply = accumulated.trim() || "Command executed autonomously, Sir.";
      } else {
        const data = await res.json().catch(() => ({}));
        reply = data.reply || data.message || "Command executed autonomously, Sir.";
      }

      setJarvisResponse(reply);
      setJarvisChatHistory((prev) => [...prev, { role: "assistant", text: reply }]);
    } catch {
      setJarvisResponse("Network request failed.");
    } finally {
      setIsSendingJarvis(false);
    }
  };

  // Voice speech recognition for Jarvis on mobile
  const toggleMobileVoice = () => {
    triggerHaptic();
    const win = typeof window !== "undefined" ? (window as unknown as Record<string, any>) : {};
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition not supported in this mobile browser.");
      return;
    }

    if (isListeningJarvis) {
      setIsListeningJarvis(false);
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";

      rec.onstart = () => setIsListeningJarvis(true);
      rec.onresult = (e: any) => {
        const transcript = e.results[0][0].transcript;
        setIsListeningJarvis(false);
        handleSendJarvis(transcript);
      };
      rec.onerror = () => setIsListeningJarvis(false);
      rec.onend = () => setIsListeningJarvis(false);
      rec.start();
    } catch {
      setIsListeningJarvis(false);
    }
  };

  // Desktop Screen capture
  const handleSnapScreen = async (showLoading = true) => {
    if (showLoading) setIsLoadingScreen(true);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "screenshot" }),
      });
      const data = await res.json();
      if (data.screenshot) {
        setScreenPreviewUrl(
          data.screenshot.startsWith("data:")
            ? data.screenshot
            : `data:image/png;base64,${data.screenshot}`,
        );
      }
    } catch {}
    if (showLoading) setIsLoadingScreen(false);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: isStandalone ? "100vh" : "680px",
        background: "#08090f",
        color: "#ffffff",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        overflowX: "hidden",
      }}
    >
      {/* ── 1. STICKY TOP HEADER & PAIRING STATUS ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "#0f111a",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #ef4444 0%, #a855f7 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Smartphone size={17} color="#ffffff" />
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 800, letterSpacing: "-0.01em" }}>AGENTIC OS MOBILE</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
              <span>Paired · #{pairingPin}</span>
            </div>
          </div>
        </div>

        {/* Telemetry Pills, Desktop Switcher & QR Button */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <a
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              background: "linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(37, 99, 235, 0.2) 100%)",
              border: "1px solid rgba(56, 189, 248, 0.45)",
              borderRadius: "7px",
              padding: "5px 10px",
              color: "#38bdf8",
              fontSize: "11px",
              fontWeight: 700,
              textDecoration: "none",
            }}
            title="Open Whole Desktop Agentic OS"
          >
            <LayoutDashboard size={13} />
            <span>Whole Desktop OS</span>
          </a>
          <span style={{ fontSize: "10px", background: "rgba(255,255,255,0.06)", padding: "4px 7px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.08)" }}>
            CPU {telemetry.cpu !== null ? `${telemetry.cpu}%` : "28%"}
          </span>
          <button
            type="button"
            onClick={() => setShowQrModal(true)}
            style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "6px", padding: "6px", color: "#ffffff", cursor: "pointer", display: "flex", alignItems: "center" }}
            title="Scan QR Code"
          >
            <QrCode size={16} />
          </button>
        </div>
      </header>

      {/* QR Code & Pairing Modal */}
      {showQrModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "20px",
          }}
        >
          <div style={{ background: "#131624", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.12)", padding: "24px", maxWidth: "360px", width: "100%", textAlign: "center", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700 }}>Connect Any Phone</div>
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.65)", margin: 0 }}>
              Scan the QR code with your phone camera to open Agentic OS:
            </p>

            {/* Target Mode Selector */}
            <div style={{ display: "flex", gap: "6px", background: "rgba(0,0,0,0.4)", padding: "4px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)" }}>
              <button
                type="button"
                onClick={() => setQrTarget("desktop")}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "none",
                  background: qrTarget === "desktop" ? "#38bdf8" : "transparent",
                  color: qrTarget === "desktop" ? "#000000" : "#ffffff",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Whole Desktop OS
              </button>
              <button
                type="button"
                onClick={() => setQrTarget("remote")}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "none",
                  background: qrTarget === "remote" ? "#ef4444" : "transparent",
                  color: "#ffffff",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Touchpad Only
              </button>
            </div>

            {/* Live Scannable SVG QR Code */}
            <div
              style={{
                width: "160px",
                height: "160px",
                background: "#ffffff",
                padding: "10px",
                borderRadius: "14px",
                margin: "0 auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
              }}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <div style={{ background: "#0c0e18", padding: "10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", fontSize: "12px", fontFamily: "monospace", color: "#38bdf8", wordBreak: "break-all" }}>
              {activePairUrl}
            </div>
            <button
              type="button"
              onClick={() => copyUrl(activePairUrl)}
              style={{ background: copied ? "#10b981" : "#38bdf8", border: "none", borderRadius: "8px", padding: "10px", color: copied ? "#ffffff" : "#000000", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
            >
              {copied ? "Copied to Clipboard!" : "Copy Mobile URL"}
            </button>
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", fontSize: "12px", cursor: "pointer" }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── 2. ACTIVE VIEW CONTAINER ── */}
      <main style={{ flex: 1, padding: "16px", paddingBottom: "86px", overflowY: "auto" }}>
        {/* Mobile Pairing Hero Card (Visible on desktop or when pairing) */}
        {!isStandalone && (
          <div
            style={{
              background: "linear-gradient(135deg, rgba(17, 24, 39, 0.95) 0%, rgba(30, 27, 46, 0.95) 100%)",
              border: "1px solid rgba(56, 189, 248, 0.25)",
              borderRadius: "14px",
              padding: "20px",
              marginBottom: "20px",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "20px",
              alignItems: "center",
              boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: "linear-gradient(135deg, #38bdf8 0%, #ef4444 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Smartphone size={20} color="#ffffff" />
                </div>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#ffffff" }}>
                    Connect Mobile to Full Agentic OS
                  </div>
                  <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.65)" }}>
                    {qrTarget === "desktop"
                      ? "Scan with your phone camera to open the complete Desktop Agentic OS (Daily Brief, Work, Jarvis, Computer Use)."
                      : "Scan with your phone camera to open the touch trackpad & remote controller."}
                  </div>
                </div>
              </div>

              {/* Target Mode Selector Tabs */}
              <div style={{ display: "flex", gap: "6px", background: "rgba(0,0,0,0.35)", padding: "4px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", width: "fit-content" }}>
                <button
                  type="button"
                  onClick={() => setQrTarget("desktop")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "none",
                    background: qrTarget === "desktop" ? "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)" : "transparent",
                    color: "#ffffff",
                    fontSize: "11.5px",
                    fontWeight: qrTarget === "desktop" ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  <LayoutDashboard size={13} />
                  <span>Whole Desktop OS</span>
                  <span style={{ fontSize: "9.5px", background: "rgba(255,255,255,0.2)", padding: "1px 5px", borderRadius: "3px" }}>Default</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQrTarget("remote")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "none",
                    background: qrTarget === "remote" ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)" : "transparent",
                    color: "#ffffff",
                    fontSize: "11.5px",
                    fontWeight: qrTarget === "remote" ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  <Smartphone size={13} />
                  <span>Touchpad Only</span>
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginTop: "2px" }}>
                <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: "8px", padding: "8px 14px", color: "#38bdf8", fontFamily: "monospace", fontSize: "12px" }}>
                  {activePairUrl}
                </div>
                <button
                  type="button"
                  onClick={() => copyUrl(activePairUrl)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 14px",
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "#ffffff",
                    borderRadius: "8px",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                  <span>{copied ? "Copied!" : "Copy Link"}</span>
                </button>
                <a
                  href={activePairUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 14px",
                    background: "rgba(56, 189, 248, 0.15)",
                    border: "1px solid rgba(56, 189, 248, 0.4)",
                    color: "#38bdf8",
                    borderRadius: "8px",
                    fontSize: "12px",
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  <span>Open URL</span>
                  <ExternalLink size={12} />
                </a>
                <a
                  href="/work"
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 14px",
                    background: "rgba(249, 115, 22, 0.15)",
                    border: "1px solid rgba(249, 115, 22, 0.35)",
                    color: "#f97316",
                    borderRadius: "8px",
                    fontSize: "12px",
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  <span>Work Window</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>

            {/* Offline SVG QR Code */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "155px",
                  height: "155px",
                  background: "#ffffff",
                  padding: "10px",
                  borderRadius: "14px",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <div style={{ textAlign: "center" }}>
                <span style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 700, display: "block" }}>
                  Scan with Phone Camera
                </span>
                <span style={{ fontSize: "9.5px", color: "rgba(255,255,255,0.5)" }}>
                  {qrTarget === "desktop" ? "Opens Full Desktop OS" : "Opens Touch Controller"}
                </span>
              </div>
            </div>
          </div>
        )}
        {/* ─────────────── TAB 1: DAILY BRIEF & AGENDA ─────────────── */}
        {mobileTab === "agenda" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Today&apos;s Daily Brief</h2>
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", margin: "2px 0 0" }}>
                  Synchronized executive agenda, missions &amp; intelligence.
                </p>
              </div>
              <button
                type="button"
                onClick={fetchBrief}
                style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", padding: "4px" }}
              >
                <RefreshCw size={15} className={loadingBrief ? "spin" : ""} />
              </button>
            </div>

            {loadingBrief ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                <Loader2 size={22} className="spin" style={{ margin: "0 auto 8px" }} />
                <span style={{ fontSize: "12px" }}>Syncing executive agenda...</span>
              </div>
            ) : briefItems.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {briefItems.slice(0, 8).map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "#121522",
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: "1px solid rgba(255,255,255,0.06)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "3px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "9px", fontWeight: 800, color: "#ef4444", textTransform: "uppercase" }}>
                        {item.source || "BRIEF"}
                      </span>
                      <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.4)" }}>{item.kind || "Agenda"}</span>
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff" }}>{item.title}</div>
                    {item.summary && <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", lineHeight: 1.4 }}>{item.summary}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ background: "#121522", padding: "20px", borderRadius: "12px", textAlign: "center", border: "1px solid rgba(255,255,255,0.06)" }}>
                <LayoutDashboard size={28} color="#ef4444" style={{ margin: "0 auto 8px" }} />
                <div style={{ fontSize: "13px", fontWeight: 600 }}>Daily Agenda Synchronized</div>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginTop: "4px" }}>
                  All scheduled tasks and morning briefs are active on host desktop.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─────────────── TAB 2: WORK & CONTENT OS (Full Phone Access!) ─────────────── */}
        {mobileTab === "work" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Agentic Work &amp; Content OS</h2>
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", margin: "2px 0 0" }}>
                  Autonomous research, priority feed &amp; multi-platform queue.
                </p>
              </div>
              <button
                type="button"
                onClick={fetchWorkState}
                style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", padding: "4px" }}
              >
                <RefreshCw size={15} className={workLoading ? "spin" : ""} />
              </button>
            </div>

            {/* Mobile Research Input */}
            <div style={{ background: "#121522", padding: "12px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>Research Any Topic via Phone:</span>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  placeholder="e.g. latest autonomous agent frameworks..."
                  value={mobileResearchQuery}
                  onChange={(e) => setMobileResearchQuery(e.target.value)}
                  style={{ flex: 1, background: "#0c0e18", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px 10px", color: "#ffffff", fontSize: "12px", outline: "none" }}
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!mobileResearchQuery.trim()) return;
                    triggerHaptic();
                    await fetch("/api/work", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "research_now", query: mobileResearchQuery, depth: "sonar-pro" }),
                    });
                    setMobileResearchQuery("");
                    fetchWorkState();
                  }}
                  style={{ background: "#ef4444", border: "none", borderRadius: "8px", padding: "0 12px", color: "#ffffff", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
                >
                  Research
                </button>
              </div>
            </div>

            {/* Today's Tasks on Phone */}
            <div style={{ background: "#121522", padding: "12px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", fontWeight: 700 }}>Today&apos;s Board</span>
                <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>
                  {workData?.tasks?.filter((t) => t.status === "open").length || 0} open
                </span>
              </div>

              {/* Add Task */}
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  placeholder="Add quick task..."
                  value={mobileTaskInput}
                  onChange={(e) => setMobileTaskInput(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && mobileTaskInput.trim()) {
                      triggerHaptic();
                      await fetch("/api/work", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "add_task", title: mobileTaskInput }),
                      });
                      setMobileTaskInput("");
                      fetchWorkState();
                    }
                  }}
                  style={{ flex: 1, background: "#0c0e18", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 10px", color: "#ffffff", fontSize: "11px", outline: "none" }}
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!mobileTaskInput.trim()) return;
                    triggerHaptic();
                    await fetch("/api/work", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "add_task", title: mobileTaskInput }),
                    });
                    setMobileTaskInput("");
                    fetchWorkState();
                  }}
                  style={{ background: "#ef4444", border: "none", borderRadius: "8px", padding: "0 10px", color: "#ffffff", fontWeight: 700, cursor: "pointer" }}
                >
                  +
                </button>
              </div>

              {/* Task Items */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "140px", overflowY: "auto" }}>
                {workData?.tasks?.map((t) => (
                  <div
                    key={t.id}
                    onClick={async () => {
                      triggerHaptic();
                      await fetch("/api/work", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "toggle_task", id: t.id }),
                      });
                      fetchWorkState();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      background: "rgba(255,255,255,0.03)",
                      padding: "6px 10px",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        width: "14px",
                        height: "14px",
                        borderRadius: "3px",
                        border: `1px solid ${t.status === "done" ? "#10b981" : "rgba(255,255,255,0.3)"}`,
                        background: t.status === "done" ? "#10b981" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "9px",
                      }}
                    >
                      {t.status === "done" && "✓"}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        color: t.status === "done" ? "rgba(255,255,255,0.35)" : "#ffffff",
                        textDecoration: t.status === "done" ? "line-through" : "none",
                      }}
                    >
                      {t.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Priority Feed Articles on Phone */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", fontWeight: 700 }}>Priority Feed (0–100 Scores)</span>
                <button
                  type="button"
                  onClick={async () => {
                    triggerHaptic();
                    await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rank_feed" }) });
                    fetchWorkState();
                  }}
                  style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}
                >
                  Rank Now
                </button>
              </div>

              {workData?.articles?.slice(0, 5).map((art) => (
                <div
                  key={art.id}
                  style={{
                    background: "#121522",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 800,
                        color: art.priority_score >= 80 ? "#10b981" : "#f59e0b",
                        background: art.priority_score >= 80 ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)",
                        padding: "2px 6px",
                        borderRadius: "4px",
                      }}
                    >
                      SCORE {art.priority_score}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        triggerHaptic();
                        await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "make_post", articleId: art.id }) });
                        fetchWorkState();
                        alert("Post drafted in Content Studio!");
                      }}
                      style={{ background: "#ef4444", border: "none", borderRadius: "6px", color: "#ffffff", padding: "4px 8px", fontSize: "10px", fontWeight: 600, cursor: "pointer" }}
                    >
                      Make Post →
                    </button>
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#ffffff" }}>{art.title}</div>
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", lineHeight: 1.3 }}>{art.summary}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─────────────── TAB 3: J.A.R.V.I.S. VOICE & CHAT ─────────────── */}
        {mobileTab === "jarvis" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>J.A.R.V.I.S. Mobile Agent</h2>
              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", margin: "2px 0 0" }}>
                Tap the microphone to speak or send instructions to your desktop.
              </p>
            </div>

            {/* Big Tap to Speak Button */}
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
              <button
                type="button"
                onClick={toggleMobileVoice}
                style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "50%",
                  background: isListeningJarvis
                    ? "radial-gradient(circle, #ef4444 0%, #991b1b 100%)"
                    : "radial-gradient(circle, #1e2438 0%, #101320 100%)",
                  border: `2px solid ${isListeningJarvis ? "#ef4444" : "rgba(255,255,255,0.2)"}`,
                  boxShadow: isListeningJarvis ? "0 0 24px rgba(239,68,68,0.6)" : "0 4px 12px rgba(0,0,0,0.5)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                  cursor: "pointer",
                }}
              >
                {isListeningJarvis ? <Mic size={30} color="#ffffff" className="spin" /> : <Mic size={28} />}
              </button>
            </div>

            {/* Quick Mobile Action Chips */}
            <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "4px" }}>
              <button
                type="button"
                onClick={() => {
                  sendAction({ action: "new_tab" });
                  setJarvisResponse("Opened new browser tab on desktop.");
                }}
                style={{ background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.3)", padding: "6px 10px", borderRadius: "16px", color: "#38bdf8", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
              >
                🚀 New Browser Tab
              </button>
              <button
                type="button"
                onClick={() => handleSendJarvis("Take a desktop screenshot and verify foreground windows")}
                style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", padding: "6px 10px", borderRadius: "16px", color: "#f87171", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
              >
                📸 Snap Screen
              </button>
              <button
                type="button"
                onClick={() => handleSendJarvis("Play song arj kiya hai on youtube")}
                style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", padding: "6px 10px", borderRadius: "16px", color: "#c084fc", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
              >
                🎵 Play YouTube Track
              </button>
              <button
                type="button"
                onClick={() => handleSendJarvis("Deploy scraper worker to Hacker News and rank feed 0-100")}
                style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", padding: "6px 10px", borderRadius: "16px", color: "#34d399", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
              >
                ⚡ Scraper Ingest
              </button>
            </div>

            {/* Chat Transcript Log */}
            <div
              style={{
                background: "#101320",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.08)",
                padding: "12px",
                maxHeight: "220px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {jarvisChatHistory.map((m, idx) => (
                <div
                  key={idx}
                  style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    background: m.role === "user" ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.06)",
                    padding: "8px 12px",
                    borderRadius: "10px",
                    maxWidth: "85%",
                    fontSize: "12px",
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.4)", marginBottom: "2px" }}>
                    {m.role === "user" ? "You" : "Jarvis"}
                  </div>
                  {m.text}
                </div>
              ))}
            </div>

            {/* Input Bar */}
            <form onSubmit={(e) => { e.preventDefault(); handleSendJarvis(); }} style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={jarvisCommand}
                onChange={(e) => setJarvisCommand(e.target.value)}
                placeholder="Ask Jarvis anything..."
                style={{
                  flex: 1,
                  background: "#121522",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  color: "#ffffff",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={isSendingJarvis || !jarvisCommand.trim()}
                style={{
                  background: "#ef4444",
                  border: "none",
                  borderRadius: "10px",
                  padding: "0 16px",
                  color: "#ffffff",
                  cursor: "pointer",
                }}
              >
                {isSendingJarvis ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              </button>
            </form>
          </div>
        )}

        {/* ─────────────── TAB 4: AUTONOMOUS COMPUTER USE ─────────────── */}
        {mobileTab === "computer" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Autonomous Computer Use</h2>
              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", margin: "2px 0 0" }}>
                Trigger desktop workflows, launch applications &amp; monitor screen.
              </p>
            </div>

            {/* Desktop App Launcher */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Desktop Apps:</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => sendAction({ action: "new_tab", url: "https://www.google.com" })}
                  style={{ background: "#121522", border: "1px solid rgba(56,189,248,0.25)", padding: "10px", borderRadius: "8px", color: "#38bdf8", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}
                >
                  🌐 Chrome
                </button>
                <button
                  type="button"
                  onClick={() => sendAction({ action: "launch_app", app: "terminal" })}
                  style={{ background: "#121522", border: "1px solid rgba(16,185,129,0.25)", padding: "10px", borderRadius: "8px", color: "#34d399", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}
                >
                  💻 Terminal
                </button>
                <button
                  type="button"
                  onClick={() => sendAction({ action: "launch_app", app: "notepad" })}
                  style={{ background: "#121522", border: "1px solid rgba(168,85,247,0.25)", padding: "10px", borderRadius: "8px", color: "#c084fc", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}
                >
                  📝 Notepad
                </button>
                <button
                  type="button"
                  onClick={() => sendAction({ action: "launch_app", app: "calc" })}
                  style={{ background: "#121522", border: "1px solid rgba(245,158,11,0.25)", padding: "10px", borderRadius: "8px", color: "#fbbf24", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}
                >
                  🔢 Calculator
                </button>
                <button
                  type="button"
                  onClick={() => sendAction({ action: "hotkey", hotkey: "alt_tab" })}
                  style={{ background: "#121522", border: "1px solid rgba(255,255,255,0.15)", padding: "10px", borderRadius: "8px", color: "#ffffff", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}
                >
                  🔄 Alt+Tab
                </button>
                <button
                  type="button"
                  onClick={() => handleSnapScreen()}
                  style={{ background: "#121522", border: "1px solid rgba(239,68,68,0.25)", padding: "10px", borderRadius: "8px", color: "#ef4444", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}
                >
                  📸 Screen Snap
                </button>
              </div>
            </div>

            {/* Virtual Keyboard Text Sender */}
            <div style={{ background: "#121522", padding: "12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Type to PC Foreground Window:</span>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  placeholder="Text to type on host PC..."
                  value={textToSendToPc}
                  onChange={(e) => setTextToSendToPc(e.target.value)}
                  style={{ flex: 1, background: "#0c0e18", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "8px", color: "#ffffff", fontSize: "12px" }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!textToSendToPc) return;
                    sendAction({ action: "send_keys", text: textToSendToPc });
                    setTextToSendToPc("");
                  }}
                  style={{ background: "#ef4444", border: "none", borderRadius: "6px", padding: "0 12px", color: "#ffffff", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}
                >
                  Type
                </button>
              </div>
            </div>

            {/* Desktop Screen Preview */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Desktop Screen:</span>
                <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={autoRefreshScreen}
                    onChange={(e) => setAutoRefreshScreen(e.target.checked)}
                  />
                  <span>Auto-Refresh (3s)</span>
                </label>
              </div>

              {screenPreviewUrl ? (
                <div style={{ borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
                  <img src={screenPreviewUrl} alt="Desktop Screen" style={{ width: "100%", height: "auto", display: "block" }} />
                </div>
              ) : (
                <div
                  onClick={() => handleSnapScreen()}
                  style={{ background: "#121522", border: "1px dashed rgba(255,255,255,0.15)", borderRadius: "10px", padding: "24px", textAlign: "center", cursor: "pointer" }}
                >
                  <Camera size={24} color="rgba(255,255,255,0.4)" style={{ margin: "0 auto 6px" }} />
                  <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>Tap to Capture Desktop Screen</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─────────────── TAB 5: TRACKPAD & HARDWARE CONTROL ─────────────── */}
        {mobileTab === "trackpad" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* Quick Macro Bar */}
            <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
              <button
                type="button"
                onClick={() => sendAction({ action: "new_tab" })}
                style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", padding: "6px 12px", borderRadius: "6px", color: "#ef4444", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer" }}
              >
                + New Tab
              </button>
              <button
                type="button"
                onClick={() => handleSnapScreen()}
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", padding: "6px 12px", borderRadius: "6px", color: "#ffffff", fontSize: "11px", whiteSpace: "nowrap", cursor: "pointer" }}
              >
                Snap Screen
              </button>
              <button
                type="button"
                onClick={() => sendAction({ action: "hotkey", hotkey: "alt_tab" })}
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", padding: "6px 12px", borderRadius: "6px", color: "#ffffff", fontSize: "11px", whiteSpace: "nowrap", cursor: "pointer" }}
              >
                Alt+Tab
              </button>
            </div>

            {/* Virtual Touchpad Surface */}
            <div
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{
                height: "260px",
                background: "linear-gradient(135deg, #131522 0%, #0c0e18 100%)",
                borderRadius: "16px",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "inset 0 2px 10px rgba(0,0,0,0.6)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                touchAction: "none",
                userSelect: "none",
              }}
            >
              <MousePointer size={28} color="rgba(239,68,68,0.5)" style={{ marginBottom: "8px" }} />
              <span style={{ fontSize: "12px", fontWeight: 500, color: "rgba(255,255,255,0.5)" }}>
                Touchpad: Slide to move · Tap to click
              </span>

              {/* Right Scroll Strip */}
              <div
                onTouchMove={handleScrollTouchMove}
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: "38px",
                  background: "rgba(255,255,255,0.03)",
                  borderLeft: "1px solid rgba(255,255,255,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  touchAction: "none",
                }}
              >
                <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.35)", transform: "rotate(90deg)", letterSpacing: "2px" }}>SCROLL</span>
              </div>
            </div>

            {/* Click Buttons */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <button
                type="button"
                onClick={() => sendAction({ action: "click_mouse", button: "left" })}
                style={{ background: "#161928", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "14px", color: "#ffffff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
              >
                Left Click
              </button>
              <button
                type="button"
                onClick={() => sendAction({ action: "click_mouse", button: "right" })}
                style={{ background: "#161928", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "14px", color: "#ffffff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
              >
                Right Click
              </button>
            </div>

            {/* Volume & Media Controls */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#121522", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.07)" }}>
              <button
                type="button"
                onClick={() => sendAction({ action: "volume", volume: "down" })}
                style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: "6px", padding: "8px 14px", color: "#ffffff", cursor: "pointer", fontWeight: 600 }}
              >
                Vol -
              </button>
              <button
                type="button"
                onClick={() => sendAction({ action: "media_key", media: "play_pause" })}
                style={{ background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "6px", padding: "8px 18px", color: "#ef4444", cursor: "pointer", fontWeight: 700 }}
              >
                Play / Pause
              </button>
              <button
                type="button"
                onClick={() => sendAction({ action: "volume", volume: "up" })}
                style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: "6px", padding: "8px 14px", color: "#ffffff", cursor: "pointer", fontWeight: 600 }}
              >
                Vol +
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ── 3. FIXED BOTTOM NAVIGATION BAR (Zero-Friction Access to Whole OS) ── */}
      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "64px",
          background: "#0c0e18",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          zIndex: 100,
          boxShadow: "0 -8px 24px rgba(0,0,0,0.6)",
        }}
      >
        <button
          type="button"
          onClick={() => { triggerHaptic(); setMobileTab("agenda"); }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "3px",
            background: "transparent",
            border: "none",
            color: mobileTab === "agenda" ? "#ef4444" : "rgba(255,255,255,0.45)",
            fontSize: "10px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <LayoutDashboard size={18} />
          <span>Agenda</span>
        </button>

        <button
          type="button"
          onClick={() => { triggerHaptic(); setMobileTab("work"); }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "3px",
            background: "transparent",
            border: "none",
            color: mobileTab === "work" ? "#ef4444" : "rgba(255,255,255,0.45)",
            fontSize: "10px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Briefcase size={18} />
          <span>Work OS</span>
        </button>

        <button
          type="button"
          onClick={() => { triggerHaptic(); setMobileTab("jarvis"); }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "3px",
            background: "transparent",
            border: "none",
            color: mobileTab === "jarvis" ? "#ef4444" : "rgba(255,255,255,0.45)",
            fontSize: "10px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Bot size={18} />
          <span>Jarvis</span>
        </button>

        <button
          type="button"
          onClick={() => { triggerHaptic(); setMobileTab("computer"); }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "3px",
            background: "transparent",
            border: "none",
            color: mobileTab === "computer" ? "#ef4444" : "rgba(255,255,255,0.45)",
            fontSize: "10px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <MonitorPlay size={18} />
          <span>Computer</span>
        </button>

        <button
          type="button"
          onClick={() => { triggerHaptic(); setMobileTab("trackpad"); }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "3px",
            background: "transparent",
            border: "none",
            color: mobileTab === "trackpad" ? "#ef4444" : "rgba(255,255,255,0.45)",
            fontSize: "10px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <MousePointer size={18} />
          <span>Trackpad</span>
        </button>
      </nav>
    </div>
  );
}
