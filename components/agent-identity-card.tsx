"use client";

import React from "react";
import {
  Cpu,
  MemoryStick,
  BatteryCharging,
  BatteryFull,
  MousePointer2,
  Keyboard,
  Globe,
  Camera,
  FileText,
  SquareTerminal,
  Volume2,
  AppWindow,
  Eye,
  ShieldCheck,
  ShieldAlert,
  Activity,
} from "lucide-react";
import type { AgentInputMode, AutonomousMission, DeviceSnapshot } from "@/lib/computer-use-types";
import { INPUT_MODE_LABELS, INPUT_MODE_DESCRIPTIONS } from "@/lib/device-intents";
import styles from "./agent-cockpit.module.css";

export type AgentIdentityCardProps = {
  device: DeviceSnapshot | null;
  inputMode: AgentInputMode;
  onInputModeChange: (mode: AgentInputMode) => void;
  activeMission: AutonomousMission | null;
  missionInputMode?: AgentInputMode | null;
  modelLabel?: string;
};

const INPUT_MODES: AgentInputMode[] = ["agent_owned", "auto_idle", "takeover"];

export function AgentIdentityCard({ device, inputMode, onInputModeChange, activeMission, missionInputMode, modelLabel }: AgentIdentityCardProps) {
  const hostReady = device?.hostReady ?? false;
  const working = activeMission?.status === "running";
  const effectiveMode = working ? missionInputMode || inputMode : inputMode;

  const capabilities = [
    { icon: Globe, label: "Browser Ops", enabled: true, detail: "Real tabs + virtual grounding" },
    { icon: MousePointer2, label: "Real Mouse", enabled: hostReady && effectiveMode !== "agent_owned", detail: INPUT_MODE_LABELS[effectiveMode] },
    { icon: Keyboard, label: "Real Keyboard", enabled: hostReady && effectiveMode !== "agent_owned", detail: INPUT_MODE_LABELS[effectiveMode] },
    { icon: Camera, label: "Vision", enabled: hostReady, detail: hostReady ? "Screen capture online" : "Needs device bridge" },
    { icon: SquareTerminal, label: "Shell", enabled: true, detail: "Guarded command execution" },
    { icon: FileText, label: "PDF Vault", enabled: hostReady, detail: hostReady ? "Headless Edge/Chrome" : "Needs device bridge" },
    { icon: Volume2, label: "Audio", enabled: hostReady, detail: hostReady ? `Master volume ${device?.volume ?? 0}%` : "Needs device bridge" },
    { icon: AppWindow, label: "Windows", enabled: hostReady, detail: hostReady ? "Focus & enumerate" : "Needs device bridge" },
  ];

  const idleText =
    device?.idleSeconds == null
      ? "unknown"
      : device.idleSeconds >= 90
        ? `${Math.floor(device.idleSeconds / 60)}m ${Math.round(device.idleSeconds % 60)}s`
        : `${Math.round(device.idleSeconds)}s`;

  return (
    <section className={styles.identityCard} aria-label="Agent identity">
      <div className={styles.idLeft}>
        <div className={`${styles.monogram} ${working ? styles.monogramWorking : ""}`}>
          {working ? <Activity size={26} className={styles.monogramIcon} /> : <span className={styles.monogramIcon}>AI</span>}
        </div>
        <div className={styles.idMeta}>
          <div className={styles.idNameRow}>
            <h2 className={styles.idName}>A.D.A.M.</h2>
            <span className={`${styles.clearance} ${hostReady ? styles.clearanceFull : styles.clearanceLimited}`}>
              {hostReady ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
              {hostReady ? "Full Clearance" : "Limited Clearance"}
            </span>
          </div>
          <div className={styles.idRole}>
            Autonomous Desktop Agent Module · {modelLabel || "local model"} · OS Build 2.0
          </div>
          <div className={styles.idChips}>
            <span className={`${styles.chip} ${working ? styles.chipRunning : styles.chipIdle}`}>
              <span className={styles.statusDot} />
              {working ? `Executing: ${(activeMission?.plannedSubtasks?.[activeMission.currentSubtaskIndex]?.title || activeMission?.goal || "mission").slice(0, 46)}` : "Idle · standing by"}
            </span>
            <span className={styles.chip}>
              <Eye size={12} />
              {device?.machine || "PC"} · {hostReady ? "bridge online" : "bridge offline"}
            </span>
            {device?.foregroundTitle ? (
              <span className={styles.chip} title={device.foregroundTitle}>
                <AppWindow size={12} />
                Focus: {device.foregroundTitle.slice(0, 42)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.idMiddle}>
        <div className={styles.telemetryTitle}>Live device telemetry</div>
        <div className={styles.telemetryGrid}>
          <div className={styles.teleChip}>
            <Cpu size={14} />
            <div>
              <span className={styles.teleLabel}>CPU</span>
              <span className={styles.teleValue}>{device?.cpuLoad != null ? `${device.cpuLoad}%` : "—"}</span>
            </div>
          </div>
          <div className={styles.teleChip}>
            <MemoryStick size={14} />
            <div>
              <span className={styles.teleLabel}>RAM free</span>
              <span className={styles.teleValue}>{device?.memoryFreeGb != null ? `${device.memoryFreeGb}/${device.memoryTotalGb ?? "?"} GB` : "—"}</span>
            </div>
          </div>
          <div className={styles.teleChip}>
            {device?.charging ? <BatteryCharging size={14} /> : <BatteryFull size={14} />}
            <div>
              <span className={styles.teleLabel}>Battery</span>
              <span className={styles.teleValue}>{device?.batteryPercent != null ? `${device.batteryPercent}%${device.charging ? " ⚡" : ""}` : "AC"}</span>
            </div>
          </div>
          <div className={styles.teleChip}>
            <MousePointer2 size={14} />
            <div>
              <span className={styles.teleLabel}>You idle</span>
              <span className={styles.teleValue}>{idleText}</span>
            </div>
          </div>
          <div className={styles.teleChip}>
            <Volume2 size={14} />
            <div>
              <span className={styles.teleLabel}>Volume</span>
              <span className={styles.teleValue}>{hostReady ? `${device?.volume ?? 0}%${device?.muted ? " 🔇" : ""}` : "—"}</span>
            </div>
          </div>
          <div className={styles.teleChip}>
            <Monitor size={14} />
            <div>
              <span className={styles.teleLabel}>Screen</span>
              <span className={styles.teleValue}>{device?.screenWidth ? `${device.screenWidth}×${device.screenHeight}` : "—"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.idRight}>
        <div className={styles.safetyTitle}>Motor arbitration — who drives the real mouse & keyboard</div>
        <div className={styles.modeSegment} role="radiogroup" aria-label="Input mode">
          {INPUT_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={inputMode === mode}
              className={`${styles.modeBtn} ${inputMode === mode ? styles.modeBtnActive : ""}`}
              onClick={() => {
                if (mode === "takeover") {
                  const granted = window.confirm(
                    "Hand over your REAL mouse and keyboard to A.D.A.M. now?\n\nThe agent will physically move the cursor, click, and type on this computer until you release control from this panel.",
                  );
                  if (!granted) return;
                }
                onInputModeChange(mode);
              }}
            >
              {INPUT_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <p className={styles.modeDesc}>{INPUT_MODE_DESCRIPTIONS[inputMode]}</p>
        <div className={styles.capGrid}>
          {capabilities.map((cap) => (
            <div key={cap.label} className={`${styles.capItem} ${cap.enabled ? styles.capOn : styles.capOff}`} title={cap.detail}>
              <cap.icon size={13} />
              <span>{cap.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Monitor(props: React.ComponentProps<typeof AppWindow>) {
  // Local alias to keep the import list tidy for the screen-resolution chip.
  return <AppWindow {...props} />;
}
