"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Volume2,
  VolumeX,
  Volume1,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Square,
  Camera,
  Rocket,
  AppWindow,
  Monitor,
  RefreshCw,
  Loader2,
  Cpu,
  MemoryStick,
  BatteryCharging,
  BatteryFull,
  MousePointer2,
  Clock,
} from "lucide-react";
import type { DeviceSnapshot, DesktopWindow } from "@/lib/computer-use-types";
import { AgentArtifacts } from "@/components/agent-artifacts";
import styles from "./system-console.module.css";

const QUICK_APPS = [
  { alias: "notepad", label: "Notepad", emoji: "📝" },
  { alias: "calc", label: "Calculator", emoji: "🧮" },
  { alias: "explorer", label: "Files", emoji: "📁" },
  { alias: "msedge", label: "Edge", emoji: "🌐" },
  { alias: "chrome", label: "Chrome", emoji: "🧭" },
  { alias: "spotify", label: "Spotify", emoji: "🎧" },
  { alias: "code", label: "VS Code", emoji: "🧑‍💻" },
  { alias: "terminal", label: "Terminal", emoji: "⌨️" },
  { alias: "cmd", label: "CMD", emoji: "🛠️" },
  { alias: "taskmgr", label: "Task Manager", emoji: "📈" },
  { alias: "control", label: "Control Panel", emoji: "⚙️" },
  { alias: "mspaint", label: "Paint", emoji: "🎨" },
];

type SystemStatus = {
  snapshot: DeviceSnapshot | null;
  volume: { volume: number; muted: boolean } | null;
  windows: DesktopWindow[];
};

export function SystemConsole() {
  const [status, setStatus] = useState<SystemStatus>({ snapshot: null, volume: null, windows: [] });
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchStatus = useCallback(async (withWindows = false) => {
    try {
      const res = await fetch(`/api/system${withWindows ? "?windows=1" : ""}`);
      if (res.ok) {
        const data = (await res.json()) as {
          snapshot?: DeviceSnapshot;
          volume?: { volume: number; muted: boolean } | null;
          windows?: DesktopWindow[];
        };
        setStatus((prev) => ({
          snapshot: data.snapshot || prev.snapshot,
          volume: data.volume || prev.volume,
          windows: data.windows || (withWindows ? [] : prev.windows),
        }));
      }
    } catch {
      // keep last snapshot
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void fetchStatus(true), 0);
    const interval = setInterval(() => void fetchStatus(false), 15_000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [fetchStatus]);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3500);
  };

  const act = async (actionLabel: string, payload: Record<string, unknown>) => {
    setBusyAction(actionLabel);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputMode: "agent_owned", ...payload }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } | string };
      if (!res.ok || data.ok === false) {
        const message = typeof data.error === "string" ? data.error : data.error?.message || "Action failed.";
        flash(`⚠ ${message}`);
      } else {
        void fetchStatus(false);
      }
    } catch {
      flash("⚠ Device bridge unreachable.");
    } finally {
      setBusyAction(null);
    }
  };

  const device = status.snapshot;
  const hostReady = device?.hostReady ?? false;
  const volume = status.volume?.volume ?? device?.volume ?? 0;
  const muted = status.volume?.muted ?? device?.muted ?? false;

  const setVolume = async (level: number) => {
    await act(`volume-${level}`, { action: "set_volume", level });
  };

  return (
    <div className={styles.consoleRoot}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Monitor size={22} className={styles.titleIcon} /> System Console
          </h1>
          <p className={styles.subtitle}>
            Direct hardware deck for this PC — audio, media transport, app launches, and the agent&apos;s artifact vaults.
          </p>
        </div>
        <span className={`${styles.bridgePill} ${hostReady ? styles.bridgeOn : styles.bridgeOff}`}>
          <span className={styles.bridgeDot} />
          {loading ? "Reading device…" : hostReady ? `Device bridge online · ${device?.machine || "PC"}` : "Device bridge offline"}
        </span>
      </header>

      {notice && <div className={styles.notice}>{notice}</div>}

      <section className={styles.chipRow}>
        <div className={styles.statChip}><Cpu size={15} /><div><span>CPU</span><b>{device?.cpuLoad != null ? `${device.cpuLoad}%` : "—"}</b></div></div>
        <div className={styles.statChip}><MemoryStick size={15} /><div><span>RAM</span><b>{device?.memoryFreeGb != null ? `${device.memoryFreeGb} / ${device.memoryTotalGb ?? "?"} GB` : "—"}</b></div></div>
        <div className={styles.statChip}>
          {device?.charging ? <BatteryCharging size={15} /> : <BatteryFull size={15} />}
          <div><span>Battery</span><b>{device?.batteryPercent != null ? `${device.batteryPercent}%` : "AC power"}</b></div>
        </div>
        <div className={styles.statChip}><Clock size={15} /><div><span>Uptime</span><b>{device?.uptimeHours != null ? `${device.uptimeHours} h` : "—"}</b></div></div>
        <div className={styles.statChip}><MousePointer2 size={15} /><div><span>Your idle</span><b>{device?.idleSeconds != null ? `${Math.round(device.idleSeconds)}s` : "—"}</b></div></div>
        <div className={styles.statChip}><Activity size={15} /><div><span>Foreground</span><b className={styles.truncate}>{device?.foregroundTitle || "—"}</b></div></div>
      </section>

      <div className={styles.decks}>
        <section className={styles.deck}>
          <h2 className={styles.deckTitle}><Volume2 size={15} /> Master Audio</h2>
          <div className={styles.volumeRow}>
            <button
              type="button"
              className={styles.iconBtn}
              title={muted ? "Unmute" : "Mute"}
              onClick={() => void act("mute", { action: "set_mute", muted: !muted })}
              disabled={!hostReady}
            >
              {muted ? <VolumeX size={18} /> : volume > 45 ? <Volume2 size={18} /> : <Volume1 size={18} />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              className={styles.volumeSlider}
              onChange={(e) => void setVolume(Number(e.target.value))}
              disabled={!hostReady}
              aria-label="Master volume"
            />
            <span className={styles.volumeValue}>{volume}%</span>
          </div>
          <div className={styles.btnRow}>
            <button type="button" className={styles.smallBtn} onClick={() => void act("vol-down", { action: "volume_step", delta: -10 })} disabled={!hostReady}>−10</button>
            <button type="button" className={styles.smallBtn} onClick={() => void act("vol-up", { action: "volume_step", delta: 10 })} disabled={!hostReady}>+10</button>
            <button type="button" className={styles.smallBtn} onClick={() => void setVolume(50)} disabled={!hostReady}>50%</button>
            <button type="button" className={styles.smallBtn} onClick={() => void setVolume(100)} disabled={!hostReady}>Max</button>
          </div>
        </section>

        <section className={styles.deck}>
          <h2 className={styles.deckTitle}><Play size={15} /> Media Transport</h2>
          <div className={styles.mediaRow}>
            <button type="button" className={styles.mediaBtn} title="Previous track" onClick={() => void act("prev", { action: "media_key", media: "previous" })} disabled={!hostReady}><SkipBack size={17} /></button>
            <button type="button" className={styles.mediaBtn} title="Play / pause" onClick={() => void act("toggle", { action: "media_key", media: "toggle" })} disabled={!hostReady}><Pause size={17} /></button>
            <button type="button" className={styles.mediaBtn} title="Stop" onClick={() => void act("stop", { action: "media_key", media: "stop" })} disabled={!hostReady}><Square size={15} /></button>
            <button type="button" className={styles.mediaBtn} title="Next track" onClick={() => void act("next", { action: "media_key", media: "next" })} disabled={!hostReady}><SkipForward size={17} /></button>
          </div>
          <p className={styles.deckNote}>Hardware media keys reach YouTube, Spotify, and any player — even when it is not focused.</p>
        </section>

        <section className={styles.deck}>
          <h2 className={styles.deckTitle}><Rocket size={15} /> Quick Launch</h2>
          <div className={styles.appGrid}>
            {QUICK_APPS.map((app) => (
              <button
                key={app.alias}
                type="button"
                className={styles.appBtn}
                onClick={() => void act(`app-${app.alias}`, { action: "launch_app", app: app.alias })}
                disabled={!hostReady}
              >
                <span className={styles.appEmoji}>{app.emoji}</span>
                {app.label}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className={styles.decksTwo}>
        <section className={styles.deck}>
          <div className={styles.deckTitleRow}>
            <h2 className={styles.deckTitle}><AppWindow size={15} /> Open Windows</h2>
            <button type="button" className={styles.iconBtnSmall} onClick={() => void fetchStatus(true)} title="Refresh windows">
              {busyAction === "windows" ? <Loader2 size={13} className={styles.spin} /> : <RefreshCw size={13} />}
            </button>
          </div>
          {status.windows.length === 0 ? (
            <p className={styles.deckNote}>{hostReady ? "No titled windows found." : "Window enumeration needs the device bridge."}</p>
          ) : (
            <div className={styles.windowList}>
              {status.windows.map((w) => (
                <button
                  key={`${w.process}-${w.title}`}
                  type="button"
                  className={styles.windowRow}
                  onClick={() => void act(`focus-${w.title}`, { action: "focus_window", title: w.title })}
                  disabled={!hostReady}
                  title={`Focus "${w.title}"`}
                >
                  <span className={styles.windowProcess}>{w.process}</span>
                  <span className={styles.windowTitle}>{w.title}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className={styles.deck}>
          <h2 className={styles.deckTitle}><Camera size={15} /> Artifact Vaults</h2>
          <AgentArtifacts />
        </section>
      </div>
    </div>
  );
}
