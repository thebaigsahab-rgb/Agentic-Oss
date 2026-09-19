import "server-only";

import { getDatabase } from "@/lib/server/database";
import { getDeviceSnapshot, getVolumeStatus, listDesktopWindows } from "@/lib/server/system-bridge";
import type { WorkstationDigitalTwin, WorldStateFact } from "./types";
import { getWorldFacts, setWorldFact } from "./kernel-store";

/**
 * 7.3 World State / Digital Twin Engine
 * Periodically or on-demand observes the host workstation and maintains structured facts in SQLite.
 */
export async function refreshWorkstationDigitalTwin(): Promise<WorkstationDigitalTwin> {
  const db = getDatabase();

  // 1. Physical Snapshot
  const snapshot = await getDeviceSnapshot();
  const volume = await getVolumeStatus().catch(() => ({ volume: snapshot.volume, muted: snapshot.muted }));
  const windows = await listDesktopWindows().catch(() => []);

  // 2. Persist observed facts with 1.0 confidence
  setWorldFact(db, "metric", "cpu_load", snapshot.cpuLoad || 0, 1.0, "observed");
  setWorldFact(db, "metric", "memory_free_gb", snapshot.memoryFreeGb || 0, 1.0, "observed");
  setWorldFact(db, "metric", "user_idle_seconds", snapshot.idleSeconds || 0, 1.0, "observed");
  setWorldFact(db, "device", "audio_volume", volume ? volume.volume : 0, 1.0, "observed");
  setWorldFact(db, "device", "audio_muted", volume ? volume.muted : false, 1.0, "observed");

  if (snapshot.batteryPercent !== null) {
    setWorldFact(db, "device", "battery_percent", snapshot.batteryPercent, 1.0, "observed");
    setWorldFact(db, "device", "charging", Boolean(snapshot.charging), 1.0, "observed");
  }

  // 3. Foreground & Active Windows
  const activeWindows = windows.map((w, index) => ({
    title: w.title,
    handle: index + 1,
    process: w.process,
    isForeground: w.title === snapshot.foregroundTitle,
  }));
  setWorldFact(db, "window", "active_windows", activeWindows, 1.0, "observed");

  // 4. Inferred facts: e.g. User Work Session Status
  const idleSecs = snapshot.idleSeconds ?? 0;
  const userPresence = idleSecs < 60 ? "active_at_desk" : idleSecs < 600 ? "away_short" : "away_extended";
  setWorldFact(db, "metric", "user_presence_state", userPresence, 0.9, "inferred");

  // Active missions
  const activeMissionRows = db.prepare(
    "SELECT id FROM kernel_missions WHERE status IN ('planning', 'executing')",
  ).all() as Array<{ id: string }>;
  const activeMissions = activeMissionRows.map((r) => r.id);
  setWorldFact(db, "service", "active_missions", activeMissions, 1.0, "observed");

  return {
    activeWindows,
    runningProcesses: [
      { pid: process.pid, name: "node-agentic-os", cpuPercent: snapshot.cpuLoad || 0, memoryMb: Math.round((snapshot.memoryTotalGb || 8) * 1024) },
    ],
    battery: snapshot.batteryPercent !== null ? { level: snapshot.batteryPercent, charging: Boolean(snapshot.charging) } : undefined,
    systemAudio: volume || { volume: snapshot.volume, muted: snapshot.muted },
    userIdleSeconds: idleSecs,
    networkOnline: true,
    activeMissions,
    lastObservedAt: new Date().toISOString(),
  };
}

export function queryWorldStateFacts(category?: string): WorldStateFact[] {
  const db = getDatabase();
  return getWorldFacts(db, category);
}
