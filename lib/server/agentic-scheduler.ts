import "server-only";

import { getDatabase } from "@/lib/server/database";
import { listDueTaughtTasks, recordTaughtTaskRun } from "@/lib/agentic-store";
import { executeRunTaughtTask } from "@/lib/server/jarvis-tools";
import { tickActiveAutonomousMissions } from "@/lib/server/mission-orchestrator";

declare global {
  var autonomousSchedulerTimer: NodeJS.Timeout | undefined;
  var autonomousSchedulerRunning: boolean | undefined;
}

export function startAutonomousScheduler() {
  if (globalThis.autonomousSchedulerTimer) {
    return;
  }

  // Run a tick every 20 seconds
  globalThis.autonomousSchedulerTimer = setInterval(async () => {
    if (globalThis.autonomousSchedulerRunning) return;
    globalThis.autonomousSchedulerRunning = true;

    try {
      const database = getDatabase();
      const dueTasks = listDueTaughtTasks(database);

      for (const task of dueTasks) {
        console.log(`[Autonomous Scheduler] Waking to execute due routine: "${task.name}" (${task.id})`);

        try {
          const result = await executeRunTaughtTask(
            { taskId: task.id },
            "UTC",
            "scheduler",
          );

          if (task.scheduleType === "one_time") {
            // Mark completed so it doesn't fire again
            recordTaughtTaskRun(
              database,
              task.id,
              JSON.stringify(result.data || result.error),
              "completed",
            );
          } else {
            recordTaughtTaskRun(
              database,
              task.id,
              JSON.stringify(result.data || result.error),
              "active",
            );
          }

          console.log(`[Autonomous Scheduler] Completed routine: "${task.name}" with status: ${result.ok ? "SUCCESS" : "FAILED"}`);
        } catch (taskErr) {
          console.error(`[Autonomous Scheduler] Error executing task ${task.id}:`, taskErr);
        }
      }

      // Progress active Computer Use autonomous missions
      try {
        tickActiveAutonomousMissions(database);
      } catch (missionErr) {
        console.error("[Autonomous Scheduler] Error ticking missions:", missionErr);
      }
    } catch (err) {
      console.error("[Autonomous Scheduler] Error in tick:", err);
    } finally {
      globalThis.autonomousSchedulerRunning = false;
    }
  }, 20_000);
  globalThis.autonomousSchedulerTimer.unref();

  console.log("[Autonomous Scheduler] Background scheduler initialized (polling every 20s)");
}

export function stopAutonomousScheduler() {
  if (globalThis.autonomousSchedulerTimer) {
    clearInterval(globalThis.autonomousSchedulerTimer);
    globalThis.autonomousSchedulerTimer = undefined;
    globalThis.autonomousSchedulerRunning = false;
  }
}
