import { getDatabase } from "@/lib/server/database";
import {
  getActiveAutonomousMission,
  listAutonomousMissions,
  listComputerSkills,
  listComputerUseLogs,
} from "@/lib/server/computer-skills-store";
import { getMissionInputMode } from "@/lib/server/mission-orchestrator";
import { getDeviceSnapshot } from "@/lib/server/system-bridge";

export const runtime = "nodejs";

export async function GET() {
  try {
    const database = getDatabase();
    const activeMission = getActiveAutonomousMission(database);
    const skills = listComputerSkills(database, 20);
    const recentMissions = listAutonomousMissions(database, 10);
    const recentLogs = listComputerUseLogs(database, undefined, 25);
    const device = await getDeviceSnapshot();

    return Response.json({
      ok: true,
      activeMission,
      activeMissionInputMode: activeMission ? getMissionInputMode(activeMission.id) : "agent_owned",
      totalSkills: skills.length,
      skills,
      recentMissions,
      recentLogs,
      device,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load computer use status." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action || "autonomous_prompt").trim();
    const prompt = String(body.prompt || "").trim();
    const inputMode = body.inputMode || "takeover";

    // 1. Specific Action Handlers
    if (action === "open_tab") {
      const { openNewBrowserTab } = await import("@/lib/server/system-bridge");
      const res = await openNewBrowserTab(typeof body.url === "string" ? body.url : undefined);
      return Response.json({ ok: true, action: "open_tab", result: res, message: `Opened new browser tab${body.url ? ` to ${body.url}` : ""}.` });
    }

    if (action === "search_web") {
      const query = String(body.query || prompt || "").trim();
      const { openUrlInDefaultBrowser } = await import("@/lib/server/system-bridge");
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      const res = await openUrlInDefaultBrowser(searchUrl);
      return Response.json({ ok: true, action: "search_web", query, result: res, message: `Launched web search for "${query}".` });
    }

    if (action === "play_media") {
      const query = String(body.query || prompt || "").trim();
      const { resolveYouTubeMedia } = await import("@/lib/server/jarvis-device-tools");
      const media = await resolveYouTubeMedia(query);
      return Response.json({ ok: true, action: "play_media", query, media, message: `Playing "${media.title || query}" on YouTube.` });
    }

    if (action === "launch_app") {
      const appName = String(body.app || prompt || "").trim();
      const { launchApplication } = await import("@/lib/server/system-bridge");
      const res = await launchApplication(appName);
      return Response.json({ ok: true, action: "launch_app", app: appName, result: res, message: `Launched application: ${appName}.` });
    }

    if (action === "execute_command") {
      const command = String(body.command || prompt || "").trim();
      const { executeShellCommand } = await import("@/lib/server/system-bridge");
      const res = await executeShellCommand(command, body.cwd);
      return Response.json({ action: "execute_command", ...res });
    }

    if (action === "take_screenshot") {
      const { takeScreenScreenshot } = await import("@/lib/server/system-bridge");
      const screenshot = await takeScreenScreenshot();
      return Response.json({ ok: true, action: "take_screenshot", screenshot, message: "Desktop screenshot captured." });
    }

    if (action === "system_audit") {
      const { executeShellCommand, getDeviceSnapshot } = await import("@/lib/server/system-bridge");
      const [device, portsRes, procRes] = await Promise.all([
        getDeviceSnapshot(),
        executeShellCommand("Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -First 10 LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String"),
        executeShellCommand("Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 ProcessName, Id, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String"),
      ]);
      return Response.json({
        ok: true,
        action: "system_audit",
        device,
        listeningPorts: portsRes.stdout,
        topProcesses: procRes.stdout,
        message: "Completed system and cybersecurity telemetry audit.",
      });
    }

    // 2. Natural Language Autonomous Intent Resolution
    if (!prompt) {
      return Response.json({ error: "No prompt or action provided." }, { status: 400 });
    }

    const lower = prompt.toLowerCase();

    // Check for "open new tab" / "new tab" / "open tab"
    if (/\b(?:open\s+(?:a\s+)?(?:new\s+)?tab|new\s+tab)\b/i.test(lower)) {
      const urlMatch = prompt.match(/https?:\/\/[^\s]+/i) || prompt.match(/\b(github\.com[^\s]*|google\.com[^\s]*|youtube\.com[^\s]*)\b/i);
      const targetUrl = urlMatch ? (urlMatch[0].startsWith("http") ? urlMatch[0] : `https://${urlMatch[0]}`) : undefined;
      const { openNewBrowserTab } = await import("@/lib/server/system-bridge");
      const res = await openNewBrowserTab(targetUrl);
      return Response.json({
        ok: true,
        action: "open_tab",
        result: res,
        message: `Successfully opened new browser tab${targetUrl ? ` to ${targetUrl}` : ""}.`,
      });
    }

    // Check for YouTube / play song
    if (/\b(?:play|listen|song|video|youtube)\b/i.test(lower)) {
      const cleanQuery = prompt.replace(/\b(?:play|song|video|on\s+youtube|in\s+youtube|please|can\s+you)\b/gi, "").trim();
      const { resolveYouTubeMedia } = await import("@/lib/server/jarvis-device-tools");
      const media = await resolveYouTubeMedia(cleanQuery || prompt);
      return Response.json({
        ok: true,
        action: "play_media",
        query: cleanQuery || prompt,
        media,
        message: `Playing "${media.title || cleanQuery || prompt}" on YouTube.`,
      });
    }

    // Check for web search
    if (/\b(?:search\s+(?:the\s+)?web|search\s+for|google\s+for|look\s+up|find\s+online)\b/i.test(lower)) {
      const cleanQuery = prompt.replace(/\b(?:search\s+(?:the\s+)?web(?:\s+for)?|search\s+for|google\s+for|look\s+up|please|can\s+you)\b/gi, "").trim();
      const { openUrlInDefaultBrowser } = await import("@/lib/server/system-bridge");
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery || prompt)}`;
      const res = await openUrlInDefaultBrowser(searchUrl);
      return Response.json({
        ok: true,
        action: "search_web",
        query: cleanQuery || prompt,
        result: res,
        message: `Searched web for "${cleanQuery || prompt}".`,
      });
    }

    // Check for screenshot
    if (/\b(?:screenshot|snap\s+(?:the\s+)?screen|capture\s+(?:the\s+)?screen)\b/i.test(lower)) {
      const { takeScreenScreenshot } = await import("@/lib/server/system-bridge");
      const screenshot = await takeScreenScreenshot();
      return Response.json({
        ok: true,
        action: "take_screenshot",
        screenshot,
        message: "Captured desktop screenshot.",
      });
    }

    // Check for open ports / security / process check
    if (/\b(?:ports?|processes|security|audit|diagnostics?|cybersecurity)\b/i.test(lower)) {
      const { executeShellCommand, getDeviceSnapshot } = await import("@/lib/server/system-bridge");
      const [device, portsRes, procRes] = await Promise.all([
        getDeviceSnapshot(),
        executeShellCommand("Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -First 10 LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String"),
        executeShellCommand("Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 ProcessName, Id, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String"),
      ]);
      return Response.json({
        ok: true,
        action: "system_audit",
        device,
        listeningPorts: portsRes.stdout,
        topProcesses: procRes.stdout,
        message: "Completed system and cybersecurity audit.",
      });
    }

    // Check for app launch: "open notepad", "launch vscode", "open terminal"
    const appMatch = prompt.match(/\b(?:open|launch|start)\s+([a-zA-Z0-9_\-\s]+)/i);
    if (appMatch && !lower.includes("new tab") && !lower.includes("tab")) {
      const appCandidate = appMatch[1].trim();
      const knownApps = ["notepad", "calc", "calculator", "terminal", "powershell", "cmd", "explorer", "code", "vscode", "chrome", "edge", "steam", "spotify", "taskmgr"];
      if (knownApps.some((k) => appCandidate.toLowerCase().includes(k))) {
        const { launchApplication } = await import("@/lib/server/system-bridge");
        const res = await launchApplication(appCandidate);
        return Response.json({
          ok: true,
          action: "launch_app",
          app: appCandidate,
          result: res,
          message: `Launched application: ${appCandidate}.`,
        });
      }
    }

    // Default: Dispatch as an Autonomous Computer Use Mission
    const { startAutonomousMission } = await import("@/lib/server/mission-orchestrator");
    const database = getDatabase();
    const mission = await startAutonomousMission(database, {
      goal: prompt,
      mode: "away",
      userAway: true,
      inputMode: inputMode as any,
    });

    return Response.json({
      ok: true,
      action: "autonomous_mission",
      mission,
      message: `Launched autonomous mission: "${prompt}".`,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to execute computer use action." },
      { status: 500 },
    );
  }
}

