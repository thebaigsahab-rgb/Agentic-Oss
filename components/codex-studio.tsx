"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  TerminalSquare,
  Play,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Cpu,
  Code2,
  ShieldCheck,
  FileCode,
  FolderGit2,
  Loader2,
  Trash2,
} from "lucide-react";
import styles from "./codex-studio.module.css";

const PRESET_SCRIPTS = [
  {
    id: "run_tests",
    label: "Run Test Suite",
    cmd: "npm test",
    desc: "Executes 258 node test runner test suites",
  },
  {
    id: "doctor",
    label: "System Doctor",
    cmd: "node scripts/doctor.mjs",
    desc: "Runs environment, database & model checks",
  },
  {
    id: "git_status",
    label: "Git Status & Diff",
    cmd: "git status -s",
    desc: "Checks modified and untracked repository files",
  },
  {
    id: "list_windows",
    label: "Active Windows",
    cmd: "powershell -Command \"Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -First 10 ProcessName, MainWindowTitle | Format-Table\"",
    desc: "Lists all foreground applications on Windows",
  },
  {
    id: "forge_refactor",
    label: "FORGE-1 Code Review",
    cmd: "@forge-1: Perform architectural sanity check on active routes",
    desc: "Invokes Principal Architect sub-agent",
  },
];

export function CodexStudio() {
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string>(
    "Agentic OS Codex Studio [Version 0.4.0]\nConnected to local execution kernel.\nType any PowerShell command, script, or @forge-1 directive below.\n",
  );
  const [isRunning, setIsRunning] = useState(false);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [output]);

  const executeCommand = async (cmdToRun: string) => {
    const raw = cmdToRun.trim();
    if (!raw || isRunning) return;

    setIsRunning(true);
    setOutput((prev) => `${prev}\n> ${raw}\n`);
    setCommand("");

    try {
      // Check if it's a sub-agent directive
      if (raw.startsWith("@forge-1") || raw.startsWith("@cipher-9") || raw.startsWith("council:")) {
        const res = await fetch("/api/jarvis/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: raw, mode: "chat" }),
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
        setOutput((prev) => `${prev}${deltas || "Execution completed."}\n`);
        return;
      }

      // Check if it's a windows listing or direct system check
      if (raw.toLowerCase() === "list windows" || raw.toLowerCase() === "windows") {
        const res = await fetch("/api/system?windows=1");
        const data = await res.json();
        const wins = data.windows || [];
        const formatted = wins.map((w: any) => `[${w.process}] ${w.title}`).join("\n");
        setOutput((prev) => `${prev}${formatted || "No active titled windows found."}\n`);
        return;
      }

      // Check if it's "open new tab"
      if (/^(?:open\s+(?:a\s+)?new\s+tab|new\s+tab|open\s+tab)/i.test(raw)) {
        const res = await fetch("/api/system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "new_tab" }),
        });
        const data = await res.json().catch(() => ({}));
        setOutput((prev) => `${prev}Opened fresh browser tab.\n`);
        return;
      }

      // Execute via real System Bridge shell command
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute_command", command: raw }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        const outputText = data.stdout || data.stderr || "(Command completed with no output)";
        setOutput((prev) => `${prev}${outputText}\n[Exit 0 · ${data.durationMs ?? 0}ms]\n`);
      } else {
        const errText = data.stderr || data.error?.message || "Execution failed";
        setOutput((prev) => `${prev}${errText}\n[Exit ${data.exitCode ?? 1} · ${data.durationMs ?? 0}ms]\n`);
      }
    } catch (err: unknown) {
      setOutput((prev) => `${prev}Execution error: ${err instanceof Error ? err.message : "Command failed"}\n`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeCommand(command);
  };

  return (
    <div className={styles.codexRoot}>
      {/* Page Heading */}
      <div className="page-heading reveal">
        <div>
          <p className="eyebrow">Developer Cockpit & CUA Studio</p>
          <h1>Codex Studio</h1>
          <p className="page-description">
            Interactive shell execution, code generation with FORGE-1, system diagnostic probes, and rapid scripts.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span className="stat-chip">
            <Code2 size={13} style={{ marginRight: "5px", color: "#38bdf8" }} />
            Architect: <strong>FORGE-1</strong>
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => setOutput("Codex Studio terminal buffer cleared.\n")}
          >
            <Trash2 size={13} /> Clear
          </button>
        </div>
      </div>

      {/* Preset Fast Scripts Grid */}
      <div className={styles.scriptsGrid}>
        {PRESET_SCRIPTS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={styles.scriptTile}
            onClick={() => executeCommand(s.cmd)}
            disabled={isRunning}
          >
            <TerminalSquare size={16} style={{ color: "#38bdf8", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#f8fafc" }}>{s.label}</div>
              <div style={{ fontSize: "10px", color: "#94a3b8" }}>{s.desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Interactive Terminal Card */}
      <div className={styles.terminalCard}>
        <div className={styles.terminalHeader}>
          <div className={styles.terminalTitle}>
            <TerminalSquare size={15} style={{ color: "#38bdf8" }} />
            <span>PowerShell & CUA Executive Kernel</span>
          </div>
          {isRunning && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#38bdf8" }}>
              <Loader2 size={12} className="spin" />
              <span>Executing…</span>
            </div>
          )}
        </div>

        <div className={styles.terminalOutput}>
          {output}
          <div ref={outputEndRef} />
        </div>

        <form onSubmit={handleFormSubmit} className={styles.terminalInputForm}>
          <span className={styles.terminalPromptPrefix}>PS &gt;</span>
          <input
            type="text"
            className={styles.terminalInput}
            placeholder="Type a command, script, or @forge-1 prompt..."
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={isRunning}
          />
          <button type="submit" className={styles.terminalSendBtn} disabled={isRunning || !command.trim()}>
            {isRunning ? <Loader2 size={13} className="spin" /> : "Run"}
          </button>
        </form>
      </div>
    </div>
  );
}
