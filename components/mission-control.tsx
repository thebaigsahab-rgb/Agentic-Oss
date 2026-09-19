"use client";

import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Play,
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Compass,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import type { AutonomousMission } from "@/lib/computer-use-types";
import styles from "./mission-control.module.css";

interface MissionControlProps {
  onJumpToComputerUse?: () => void;
}

export function MissionControl({ onJumpToComputerUse }: MissionControlProps) {
  const [missions, setMissions] = useState<AutonomousMission[]>([]);
  const [activeMission, setActiveMission] = useState<AutonomousMission | null>(null);
  const [newGoal, setNewGoal] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  const fetchMissions = async () => {
    try {
      const res = await fetch("/api/computer-use");
      if (res.ok) {
        const data = await res.json();
        setActiveMission(data.activeMission || null);
        if (data.recentMissions) setMissions(data.recentMissions);
      }
    } catch {}
  };

  useEffect(() => {
    fetchMissions();
    const interval = setInterval(fetchMissions, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoal.trim() || isStarting) return;
    setIsStarting(true);
    try {
      const res = await fetch("/api/computer-use/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: newGoal.trim(),
          mode: "away",
          userAway: true,
        }),
      });
      if (res.ok) {
        setNewGoal("");
        fetchMissions();
      }
    } catch {} finally {
      setIsStarting(false);
    }
  };

  return (
    <div className={styles.missionControlRoot}>
      {/* Top Heading */}
      <div className="page-heading reveal">
        <div>
          <p className="eyebrow">Goal-to-Plan Kernel & Autonomous DAG Orchestrator</p>
          <h1>Mission Control</h1>
          <p className="page-description">
            Event-sourced autonomous agent workflows, background DAG execution, and checkpoint durability.
          </p>
        </div>
      </div>

      {/* Stats Row */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statIcon}><Compass size={20} /></div>
          <div>
            <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Active Mission</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: activeMission ? "#38bdf8" : "#94a3b8" }}>
              {activeMission ? "Running (CUA)" : "Idle · Ready"}
            </div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon}><CheckCircle2 size={20} style={{ color: "#34d399" }} /></div>
          <div>
            <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Completed Missions</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#f8fafc" }}>
              {missions.filter((m) => m.status === "completed").length}
            </div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon}><Clock size={20} style={{ color: "#fbbf24" }} /></div>
          <div>
            <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Durability Engine</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#f8fafc" }}>SQLite Checkpoints</div>
          </div>
        </div>
      </div>

      {/* Launch New Autonomous Mission Form */}
      <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(56, 189, 248, 0.25)", borderRadius: "14px", padding: "16px" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
          <Sparkles size={15} style={{ color: "#38bdf8" }} />
          <span>Launch Autonomous Mission DAG</span>
        </h3>
        <form onSubmit={handleLaunch} style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            className="input"
            style={{ flex: 1 }}
            placeholder="Describe high-level objective (e.g. Sweep Hacker News top tech stories and compile debrief)..."
            value={newGoal}
            onChange={(e) => setNewGoal(e.target.value)}
            disabled={isStarting}
          />
          <button type="submit" className="button button-primary" disabled={isStarting || !newGoal.trim()}>
            {isStarting ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
            <span>Dispatch</span>
          </button>
        </form>
      </div>

      {/* Missions List */}
      <div className={styles.missionsList}>
        {activeMission && (
          <div className={styles.missionCard} style={{ borderColor: "rgba(56, 189, 248, 0.6)", background: "rgba(12, 20, 36, 0.95)" }}>
            <div className={styles.missionTop}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="stat-chip" style={{ background: "rgba(56, 189, 248, 0.2)", borderColor: "rgba(56, 189, 248, 0.5)", color: "#38bdf8" }}>
                  <Loader2 size={12} className="spin" style={{ marginRight: "4px" }} /> Active Mission
                </span>
                <span className={styles.missionGoal}>{activeMission.goal}</span>
              </div>
              {onJumpToComputerUse && (
                <button className="button button-primary" style={{ padding: "6px 12px", fontSize: "11px" }} onClick={onJumpToComputerUse}>
                  <span>View Live Viewport</span>
                  <ArrowRight size={12} />
                </button>
              )}
            </div>

            <div className={styles.taskNodes}>
              {activeMission.plannedSubtasks?.map((subtask, idx) => {
                const isCurrent = idx === activeMission.currentSubtaskIndex;
                const isPast = idx < activeMission.currentSubtaskIndex;
                return (
                  <div
                    key={subtask.id || idx}
                    className={`${styles.taskNode} ${
                      isPast ? styles.nodeSuccess : isCurrent ? styles.nodeRunning : styles.nodePending
                    }`}
                  >
                    {isPast ? <CheckCircle2 size={13} /> : isCurrent ? <Loader2 size={13} className="spin" /> : <Clock size={13} />}
                    <span style={{ fontWeight: isCurrent ? 700 : 500 }}>
                      Step {idx + 1}: {subtask.title}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {missions.slice(0, 8).map((m) => (
          <div key={m.id} className={styles.missionCard}>
            <div className={styles.missionTop}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  className="stat-chip"
                  style={{
                    background: m.status === "completed" ? "rgba(16, 185, 129, 0.15)" : "rgba(244, 63, 94, 0.15)",
                    borderColor: m.status === "completed" ? "rgba(16, 185, 129, 0.3)" : "rgba(244, 63, 94, 0.3)",
                    color: m.status === "completed" ? "#34d399" : "#fb7185",
                  }}
                >
                  {m.status.toUpperCase()}
                </span>
                <span className={styles.missionGoal}>{m.goal}</span>
              </div>
              <span style={{ fontSize: "11px", color: "#64748b" }}>
                {new Date(m.createdAt).toLocaleTimeString()}
              </span>
            </div>

            {m.debrief && (
              <div style={{ fontSize: "12px", color: "#cbd5e1", background: "rgba(15, 23, 42, 0.5)", padding: "10px", borderRadius: "8px" }}>
                <b>Executive Debrief:</b> {m.debrief.summary}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
