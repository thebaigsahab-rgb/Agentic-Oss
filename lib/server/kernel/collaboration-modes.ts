import "server-only";

import { getDatabase } from "@/lib/server/database";
import type { CollaborationMode } from "./types";
import { emitKernelEvent, setWorldFact } from "./kernel-store";

let currentCollaborationMode: CollaborationMode = "delegated";

export function getCollaborationMode(): CollaborationMode {
  return currentCollaborationMode;
}

export function setCollaborationMode(mode: CollaborationMode, reason = "User toggled mode"): {
  mode: CollaborationMode;
  message: string;
} {
  currentCollaborationMode = mode;
  const db = getDatabase();

  setWorldFact(db, "service", "collaboration_mode", mode, 1.0, "observed");
  emitKernelEvent(db, "collaboration.mode_changed", "kernel", { mode, reason });

  if (mode === "lockdown") {
    // Revoke all active capability grants immediately
    db.prepare("UPDATE kernel_capability_grants SET revoked = 1").run();
    // Pause all running missions
    db.prepare("UPDATE kernel_missions SET status = 'paused' WHERE status IN ('planning', 'executing')").run();
    return {
      mode,
      message: "EMERGENCY LOCKDOWN ACTIVATED: All active missions paused, capability grants revoked.",
    };
  }

  return {
    mode,
    message: `Collaboration mode set to ${mode.toUpperCase()} (${reason}).`,
  };
}
