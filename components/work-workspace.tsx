"use client";

import React, { useState } from "react";
import {
  Plus,
  X,
  Sliders,
  PanelLeftClose,
  PanelLeft,
  FileText,
  Bot,
  TerminalSquare,
  Sparkles,
  Maximize2,
  Trash2,
  Save,
  Check,
  ChevronRight,
  MonitorPlay,
  Code2,
  ShieldCheck,
  Database,
  Cpu,
} from "lucide-react";
import type { PublicSettings } from "@/lib/types";

interface WorkspaceTab {
  id: string;
  title: string;
  notes: string;
  activeAgent?: string;
  createdAt: string;
}

const AVAILABLE_AGENTS = [
  { id: "jarvis", name: "J.A.R.V.I.S.", role: "Executive OS Engine", icon: Bot, color: "#38bdf8" },
  { id: "adam", name: "A.D.A.M.", role: "Autonomous Computer Use", icon: MonitorPlay, color: "#a855f7" },
  { id: "forge", name: "FORGE-1", role: "Principal Architect", icon: Code2, color: "#10b981" },
  { id: "cipher", name: "CIPHER-9", role: "Lead Data Scientist", icon: Database, color: "#f59e0b" },
  { id: "aegis", name: "AEGIS-7", role: "Cybersecurity Officer", icon: ShieldCheck, color: "#ef4444" },
  { id: "nexus", name: "NEXUS-4", role: "Kernel & Systems", icon: Cpu, color: "#06b6d4" },
];

export function WorkWorkspace({ settings: _settings }: { settings?: PublicSettings }) {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [
    {
      id: "tab-1",
      title: "Tab 1: Untitled Workspace",
      notes: "",
      createdAt: "12:00 PM",
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("tab-1");
  const [isSlideBarOpen, setIsSlideBarOpen] = useState(true);
  const [slideBarWidth, setSlideBarWidth] = useState(280);
  const [canvasZoom, setCanvasZoom] = useState(100);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const handleAddTab = () => {
    const nextNum = tabs.length + 1;
    const newTab: WorkspaceTab = {
      id: `tab-${nextNum}-${tabs.length}`,
      title: `Tab ${nextNum}: Workspace ${nextNum}`,
      notes: "",
      createdAt: "12:00 PM",
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleCloseTab = (idToClose: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      // Don't close the only tab, just clear it
      setTabs([
        {
          id: "tab-1",
          title: "Tab 1: Untitled Workspace",
          notes: "",
          createdAt: "12:00 PM",
        },
      ]);
      return;
    }
    const filtered = tabs.filter((t) => t.id !== idToClose);
    setTabs(filtered);
    if (activeTabId === idToClose) {
      setActiveTabId(filtered[filtered.length - 1].id);
    }
  };

  const handleUpdateNotes = (notes: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, notes } : t)),
    );
  };

  const handleRenameTab = (newTitle: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, title: newTitle } : t)),
    );
  };

  const handleDockAgent = (agentId: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, activeAgent: agentId } : t)),
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 120px)", minHeight: "680px", background: "#0d0f18", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
      {/* 1. TOP TAB BAR & CONTROLS */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#131622", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0 12px", height: "46px" }}>
        {/* Dynamic Empty Tabs Strip */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", overflowX: "auto", flex: 1, paddingRight: "16px" }}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 14px",
                  borderRadius: "8px 8px 0 0",
                  background: isActive ? "#1a1e2e" : "transparent",
                  border: isActive ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
                  borderBottom: isActive ? "2px solid #38bdf8" : "none",
                  color: isActive ? "#ffffff" : "rgba(255,255,255,0.5)",
                  fontSize: "12px",
                  fontWeight: isActive ? 600 : 400,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                <FileText size={13} style={{ color: isActive ? "#38bdf8" : "rgba(255,255,255,0.4)" }} />
                <input
                  type="text"
                  value={tab.title}
                  onChange={(e) => handleRenameTab(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "inherit",
                    fontSize: "inherit",
                    fontWeight: "inherit",
                    width: `${Math.max(100, tab.title.length * 8)}px`,
                    cursor: "text",
                  }}
                />
                <button
                  type="button"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  title="Close tab"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    padding: "2px",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    opacity: 0.6,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}

          {/* New Tab Button */}
          <button
            type="button"
            onClick={handleAddTab}
            title="Open new empty workspace tab"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "5px 10px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.04)",
              border: "1px dashed rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.6)",
              fontSize: "12px",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(56,189,248,0.1)";
              e.currentTarget.style.borderColor = "#38bdf8";
              e.currentTarget.style.color = "#38bdf8";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
              e.currentTarget.style.color = "rgba(255,255,255,0.6)";
            }}
          >
            <Plus size={13} />
            <span>New Tab</span>
          </button>
        </div>

        {/* Slide Bar Toggle & Canvas Tools */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setIsSlideBarOpen((prev) => !prev)}
            title={isSlideBarOpen ? "Collapse Slide Bar" : "Open Slide Bar"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "8px",
              background: isSlideBarOpen ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${isSlideBarOpen ? "rgba(56,189,248,0.3)" : "rgba(255,255,255,0.1)"}`,
              color: isSlideBarOpen ? "#38bdf8" : "rgba(255,255,255,0.8)",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {isSlideBarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
            <span>Slide Bar</span>
          </button>
        </div>
      </div>

      {/* 2. BODY: SLIDE BAR + EMPTY WORK CANVAS */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
        {/* Slide Bar (Collapsible Navigation & Tools Panel) */}
        {isSlideBarOpen && (
          <aside
            style={{
              width: `${slideBarWidth}px`,
              minWidth: "220px",
              maxWidth: "450px",
              background: "#111420",
              borderRight: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              padding: "16px",
              gap: "16px",
              transition: "width 0.2s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Sliders size={14} color="#38bdf8" />
                <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.7)" }}>
                  Slide Bar Controls
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsSlideBarOpen(false)}
                title="Hide slide bar"
                style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: "2px" }}
              >
                <X size={13} />
              </button>
            </div>

            {/* Slide Width Slider */}
            <div style={{ background: "rgba(255,255,255,0.02)", padding: "10px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "6px" }}>
                <span>Slide Bar Width</span>
                <span>{slideBarWidth}px</span>
              </div>
              <input
                type="range"
                min="220"
                max="420"
                value={slideBarWidth}
                onChange={(e) => setSlideBarWidth(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#38bdf8", cursor: "pointer" }}
              />
            </div>

            {/* Agent Docking Station */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Dock Agent to Tab
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {AVAILABLE_AGENTS.map((agent) => {
                  const Icon = agent.icon;
                  const isDocked = activeTab.activeAgent === agent.id;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => handleDockAgent(isDocked ? "" : agent.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "8px 10px",
                        borderRadius: "8px",
                        background: isDocked ? "rgba(56,189,248,0.12)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${isDocked ? agent.color : "rgba(255,255,255,0.06)"}`,
                        color: "#ffffff",
                        fontSize: "12px",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <Icon size={16} style={{ color: agent.color }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: "12px" }}>{agent.name}</div>
                        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>{agent.role}</div>
                      </div>
                      {isDocked && <Check size={14} color="#38bdf8" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Canvas Zoom Slider */}
            <div style={{ background: "rgba(255,255,255,0.02)", padding: "10px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "6px" }}>
                <span>Canvas Zoom</span>
                <span>{canvasZoom}%</span>
              </div>
              <input
                type="range"
                min="70"
                max="130"
                value={canvasZoom}
                onChange={(e) => setCanvasZoom(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#a855f7", cursor: "pointer" }}
              />
            </div>
          </aside>
        )}

        {/* Empty Canvas Workspace */}
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            background: "#0c0e17",
            backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            overflowY: "auto",
            padding: "24px",
            position: "relative",
          }}
        >
          {/* Active Tab Header Details */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#ffffff", margin: 0 }}>
                  {activeTab.title}
                </h2>
                {activeTab.activeAgent && (
                  <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "12px", background: "rgba(56,189,248,0.15)", color: "#38bdf8", border: "1px solid rgba(56,189,248,0.3)" }}>
                    {AVAILABLE_AGENTS.find((a) => a.id === activeTab.activeAgent)?.name || "Agent"} Docked
                  </span>
                )}
              </div>
              <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", margin: "4px 0 0" }}>
                Created at {activeTab.createdAt} · Clean Canvas Ready
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                type="button"
                onClick={() => handleUpdateNotes("")}
                title="Clear canvas notes"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.5)",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                <Trash2 size={12} />
                <span>Clear Canvas</span>
              </button>
            </div>
          </div>

          {/* Interactive Workspace Canvas */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              borderRadius: "12px",
              background: "#111420",
              border: "1px solid rgba(255,255,255,0.08)",
              padding: "16px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              zoom: `${canvasZoom}%`,
            }}
          >
            {/* If tab is completely empty, show sleek ready-canvas state */}
            {!activeTab.notes && !activeTab.activeAgent ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, textAlign: "center", padding: "40px" }}>
                <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.25)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px" }}>
                  <Sparkles size={28} color="#38bdf8" />
                </div>
                <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#ffffff", margin: "0 0 6px" }}>
                  Workspace Canvas Ready
                </h3>
                <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", maxWidth: "440px", margin: "0 0 24px", lineHeight: 1.5 }}>
                  This is an empty tab ready for your tasks. Use the slide bar on the left to dock agents, or start typing your project notes directly into this tab.
                </p>

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
                  <button
                    type="button"
                    onClick={() => handleUpdateNotes("# Project Plan\n\n- Goal: Define project milestones\n- Architecture: Agentic OS Workflow\n- Status: In Progress\n")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 14px",
                      borderRadius: "8px",
                      background: "rgba(56,189,248,0.15)",
                      border: "1px solid rgba(56,189,248,0.3)",
                      color: "#38bdf8",
                      fontSize: "12px",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    <FileText size={14} />
                    <span>Initialize Scratchpad</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDockAgent("jarvis")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 14px",
                      borderRadius: "8px",
                      background: "rgba(168,85,247,0.15)",
                      border: "1px solid rgba(168,85,247,0.3)",
                      color: "#c084fc",
                      fontSize: "12px",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    <Bot size={14} />
                    <span>Dock J.A.R.V.I.S.</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDockAgent("adam")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 14px",
                      borderRadius: "8px",
                      background: "rgba(16,185,129,0.15)",
                      border: "1px solid rgba(16,185,129,0.3)",
                      color: "#34d399",
                      fontSize: "12px",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    <MonitorPlay size={14} />
                    <span>Dock A.D.A.M. Computer Use</span>
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "12px" }}>
                {activeTab.activeAgent && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.03)", padding: "10px 14px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Bot size={16} color="#38bdf8" />
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#ffffff" }}>
                        Docked Agent: {AVAILABLE_AGENTS.find((a) => a.id === activeTab.activeAgent)?.name}
                      </span>
                      <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
                        ({AVAILABLE_AGENTS.find((a) => a.id === activeTab.activeAgent)?.role})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDockAgent("")}
                      style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "11px" }}
                    >
                      Undock
                    </button>
                  </div>
                )}

                <textarea
                  value={activeTab.notes}
                  onChange={(e) => handleUpdateNotes(e.target.value)}
                  placeholder="Type anything here... Project notes, scratchpad, code blocks, or instructions for docked agents."
                  style={{
                    flex: 1,
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "#e2e8f0",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    fontSize: "13px",
                    lineHeight: 1.6,
                    resize: "none",
                  }}
                />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
