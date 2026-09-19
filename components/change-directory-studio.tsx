"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  FolderGit2,
  FileCode2,
  GitBranch,
  GitCommit,
  RefreshCw,
  Terminal,
  FileDiff,
  Loader2,
  Play,
  Sparkles,
} from "lucide-react";

export function ChangeDirectoryStudio() {
  const [gitStatus, setGitStatus] = useState<string>("");
  const [gitDiff, setGitDiff] = useState<string>("");
  const [activeView, setActiveView] = useState<"diff" | "status" | "log">("diff");
  const [customCommand, setCustomCommand] = useState("");
  const [commandOutput, setCommandOutput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [branch, setBranch] = useState("main");

  const fetchGitData = async () => {
    setIsLoading(true);
    try {
      // Run git status
      const statusRes = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_command", command: "git status -s" }),
      });
      const statusData = await statusRes.json().catch(() => ({}));
      setGitStatus(statusData.stdout || "Working directory clean (no uncommitted changes).");

      // Run git diff
      const diffRes = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_command", command: "git diff" }),
      });
      const diffData = await diffRes.json().catch(() => ({}));
      setGitDiff(diffData.stdout || "(No active uncommitted diffs)");

      // Run branch check
      const branchRes = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_command", command: "git branch --show-current" }),
      });
      const branchData = await branchRes.json().catch(() => ({}));
      if (branchData.stdout) setBranch(branchData.stdout.trim());
    } catch {
      setGitStatus("Could not query git status.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchGitData();
  }, []);

  const handleRunCommand = async (cmdToRun: string) => {
    const trimmed = cmdToRun.trim();
    if (!trimmed || isLoading) return;

    setIsLoading(true);
    setCommandOutput((prev) => `${prev}\n$ ${trimmed}\n`);
    setCustomCommand("");

    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_command", command: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      const text = data.stdout || data.stderr || "Command executed with code 0.";
      setCommandOutput((prev) => `${prev}${text}\n`);
    } catch (err) {
      setCommandOutput((prev) => `${prev}Error: ${err instanceof Error ? err.message : "Failed to execute"}\n`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgeReview = async () => {
    setIsLoading(true);
    setCommandOutput((prev) => `${prev}\n> Invoking FORGE-1 Principal Architect to review changes...\n`);
    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "@forge-1: Review recent code changes, verify architecture patterns and check for potential regressions.",
          mode: "chat",
        }),
      });
      const text = await res.text();
      const deltas = text
        .split("\n\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => {
          try {
            const j = JSON.parse(l.slice(6));
            return j.type === "text_delta" ? j.text : "";
          } catch {
            return "";
          }
        })
        .join("");
      setCommandOutput((prev) => `${prev}${deltas || "Review completed."}\n`);
    } catch (err) {
      setCommandOutput((prev) => `${prev}Architect review error: ${err instanceof Error ? err.message : "Failed"}\n`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px", width: "100%" }}>
      {/* Page Heading */}
      <div className="page-heading reveal">
        <div>
          <p className="eyebrow">Repository Explorer & Code Engine</p>
          <h1>Change D · Directory & Code Studio</h1>
          <p className="page-description">
            Inspect working tree diffs, track modified files, navigate directories, and invoke FORGE-1 code reviews.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span className="stat-chip">
            <GitBranch size={13} style={{ marginRight: "5px", color: "#38bdf8" }} />
            Branch: <strong>{branch}</strong>
          </span>
          <button
            type="button"
            className="panel-btn"
            onClick={fetchGitData}
            disabled={isLoading}
            title="Refresh Git Diffs"
          >
            <RefreshCw size={13} className={isLoading ? "spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            className="accent-button"
            onClick={handleForgeReview}
            disabled={isLoading}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Sparkles size={14} /> FORGE-1 Review
          </button>
        </div>
      </div>

      {/* View Switcher Chips */}
      <div style={{ display: "flex", gap: "10px" }}>
        <button
          type="button"
          onClick={() => setActiveView("diff")}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            background: activeView === "diff" ? "rgba(56, 189, 248, 0.2)" : "rgba(15, 23, 42, 0.6)",
            border: activeView === "diff" ? "1px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.1)",
            color: activeView === "diff" ? "#38bdf8" : "#94a3b8",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <FileDiff size={15} /> Active Diff
        </button>
        <button
          type="button"
          onClick={() => setActiveView("status")}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            background: activeView === "status" ? "rgba(56, 189, 248, 0.2)" : "rgba(15, 23, 42, 0.6)",
            border: activeView === "status" ? "1px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.1)",
            color: activeView === "status" ? "#38bdf8" : "#94a3b8",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <FileCode2 size={15} /> Changed Files (git status)
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveView("log");
            void handleRunCommand("git log -n 6 --oneline");
          }}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            background: activeView === "log" ? "rgba(56, 189, 248, 0.2)" : "rgba(15, 23, 42, 0.6)",
            border: activeView === "log" ? "1px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.1)",
            color: activeView === "log" ? "#38bdf8" : "#94a3b8",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <GitCommit size={15} /> Recent Commits (git log)
        </button>
      </div>

      {/* Main Diff / Status Display */}
      <div
        style={{
          background: "rgba(9, 14, 24, 0.95)",
          border: "1px solid rgba(56, 189, 248, 0.25)",
          borderRadius: "14px",
          overflow: "hidden",
          boxShadow: "0 12px 36px rgba(0, 0, 0, 0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            background: "rgba(15, 23, 42, 0.95)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, color: "#f8fafc" }}>
            <FolderGit2 size={15} style={{ color: "#38bdf8" }} />
            <span>
              {activeView === "diff" ? "Unified Code Diff" : activeView === "status" ? "Working Directory Status" : "Recent Commit History"}
            </span>
          </div>
          {isLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#38bdf8" }}>
              <Loader2 size={12} className="spin" />
              <span>Scanning…</span>
            </div>
          )}
        </div>

        <pre
          style={{
            background: "#020617",
            color: "#e2e8f0",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: "12px",
            lineHeight: 1.55,
            padding: "16px",
            minHeight: "260px",
            maxHeight: "440px",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            margin: 0,
          }}
        >
          {activeView === "diff" ? gitDiff : activeView === "status" ? gitStatus : commandOutput || "Click to fetch git log."}
        </pre>
      </div>

      {/* Directory Quick Action Command Bar */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          background: "rgba(15, 23, 42, 0.7)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "12px",
          padding: "14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 600, color: "#94a3b8" }}>
          <Terminal size={14} style={{ color: "#38bdf8" }} />
          <span>Quick Directory Operations</span>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {[
            { label: "git status -s", cmd: "git status -s" },
            { label: "git diff --stat", cmd: "git diff --stat" },
            { label: "git log -n 5 --oneline", cmd: "git log -n 5 --oneline" },
            { label: "npm test", cmd: "npm test" },
            { label: "dir (List files)", cmd: "dir" },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              className="panel-btn"
              onClick={() => handleRunCommand(action.cmd)}
              disabled={isLoading}
              style={{ fontSize: "11.5px", padding: "5px 10px" }}
            >
              <Play size={11} style={{ marginRight: "4px" }} /> {action.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRunCommand(customCommand);
          }}
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
            marginTop: "6px",
          }}
        >
          <input
            type="text"
            className="text-input"
            style={{ flex: 1, fontFamily: "monospace", fontSize: "12px" }}
            placeholder="Execute directory or git command (e.g. git diff components/)..."
            value={customCommand}
            onChange={(e) => setCustomCommand(e.target.value)}
            disabled={isLoading}
          />
          <button type="submit" className="accent-button" disabled={isLoading || !customCommand.trim()}>
            {isLoading ? <Loader2 size={13} className="spin" /> : "Run"}
          </button>
        </form>

        {commandOutput && (
          <pre
            style={{
              background: "#020617",
              color: "#38bdf8",
              fontFamily: "monospace",
              fontSize: "11.5px",
              padding: "10px",
              borderRadius: "8px",
              maxHeight: "200px",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              margin: 0,
            }}
          >
            {commandOutput}
          </pre>
        )}
      </div>
    </div>
  );
}
