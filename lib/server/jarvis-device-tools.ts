import "server-only";

import type { ToolResult } from "@/lib/jarvis-types";
import type { DeviceSnapshot, DesktopWindow } from "@/lib/computer-use-types";
import type { MediaAction, VolumeIntent } from "@/lib/device-intents";
import { clampVolume, parsePlayCommand, parseVolumeCommand } from "@/lib/device-intents";
import {
  getDeviceSnapshot,
  getVolumeStatus,
  setVolumeLevel,
  stepVolume,
  setMuted,
  sendMediaKey,
  takeScreenScreenshot,
  savePageAsPdf,
  openUrlInDefaultBrowser,
  openNewBrowserTab,
  executeShellCommand,
  type ShellCommandResult,
  launchApplication,
  listDesktopWindows,
  realMouseClick,
  realTypeText,
  realPressHotkey,
  SystemBridgeError,
} from "@/lib/server/system-bridge";
import type {
  ControlMediaArgs,
  ControlVolumeArgs,
  GetSystemStatusArgs,
  ListWindowsArgs,
  PlayMediaArgs,
  SavePagePdfArgs,
  TakeScreenshotArgs,
} from "@/lib/jarvis-types";

// Re-exported for the chat route's deterministic fast paths.
export { parsePlayCommand, parseVolumeCommand, parseMediaCommand } from "@/lib/device-intents";

// ---------------------------------------------------------------------------
// YouTube search → watch URL. The server fetches the public results page and
// lifts the first real videoId, so "play Hawayein" lands on the song itself,
// not a search page.
// ---------------------------------------------------------------------------

export type YouTubeMatch = { videoId: string; title: string } | null;

export function extractYouTubeVideo(html: string): YouTubeMatch {
  if (!html) return null;

  const renderer = html.match(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/);
  if (renderer && renderer.index !== undefined) {
    const window = html.slice(renderer.index, renderer.index + 4000);
    const title = window.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
    if (title) {
      return { videoId: renderer[1], title: unescapeJsonString(title[1]) };
    }
    return { videoId: renderer[1], title: "YouTube video" };
  }

  // Fallback: first plain videoId occurrence anywhere in the payload.
  const anyId = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
  return anyId ? { videoId: anyId[1], title: "YouTube video" } : null;
}

function unescapeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\u([\dA-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}

export function buildYouTubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export type PlayMediaResult = {
  query: string;
  videoId?: string;
  title?: string;
  url: string;
  openedOnDevice: boolean;
  fallbackSearch: boolean;
};

export async function resolveYouTubeMedia(query: string): Promise<PlayMediaResult> {
  const searchUrl = buildYouTubeSearchUrl(query);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await res.text();
    clearTimeout(timer);
    const match = extractYouTubeVideo(html);
    if (match) {
      const watchUrl = buildYouTubeWatchUrl(match.videoId);
      let openedOnDevice = false;
      try {
        await openUrlInDefaultBrowser(watchUrl);
        openedOnDevice = true;
      } catch {
        // Non-Windows or shell failure — the client will window.open instead.
      }
      return { query, videoId: match.videoId, title: match.title, url: watchUrl, openedOnDevice, fallbackSearch: false };
    }
  } catch {
    // Fall through to opening the search results page directly.
  }

  let openedOnDevice = false;
  try {
    await openUrlInDefaultBrowser(searchUrl);
    openedOnDevice = true;
  } catch {
    // Client fallback opens it.
  }
  return { query, url: searchUrl, openedOnDevice, fallbackSearch: true };
}

// ---------------------------------------------------------------------------
// Tool executors — each returns the standard ToolResult shape.
// ---------------------------------------------------------------------------

function failure(error: SystemBridgeError): ToolResult<never> {
  return {
    ok: false,
    error: { code: error.code, message: error.message, retryable: error.retryable },
  };
}

export async function executePlayMedia(args: PlayMediaArgs): Promise<ToolResult<PlayMediaResult>> {
  const query = (args.query || "").trim();
  if (!query) {
    return { ok: false, error: { code: "MISSING_QUERY", message: "Tell me what to play — a song, artist, or video title.", retryable: false } };
  }
  const result = await resolveYouTubeMedia(query);
  return {
    ok: true,
    data: result,
    meta: { source: "youtube_media", timestamp: new Date().toISOString() },
  };
}

export async function executeControlMedia(args: ControlMediaArgs): Promise<ToolResult<{ action: MediaAction }>> {
  const action = (args.action || "").toLowerCase().trim() as MediaAction;
  if (!["play", "pause", "toggle", "next", "previous", "stop"].includes(action)) {
    return { ok: false, error: { code: "INVALID_ACTION", message: "Media action must be play, pause, toggle, next, previous, or stop.", retryable: false } };
  }
  try {
    await sendMediaKey(action);
    return {
      ok: true,
      data: { action },
      meta: { source: "media_keys", timestamp: new Date().toISOString() },
    };
  } catch (err) {
    return failure(err instanceof SystemBridgeError ? err : new SystemBridgeError("MEDIA_FAILED", "Could not send the media key.", true));
  }
}

export type VolumeResult = {
  action: VolumeIntent["action"];
  volume?: number;
  muted?: boolean;
  message: string;
};

export async function executeControlVolume(args: ControlVolumeArgs): Promise<ToolResult<VolumeResult>> {
  const action = (args.action || "get").toLowerCase() as VolumeIntent["action"];
  try {
    if (action === "get") {
      const status = await getVolumeStatus();
      return {
        ok: true,
        data: { action, volume: status.volume, muted: status.muted, message: `System volume is at ${status.volume}%${status.muted ? " (muted)" : ""}.` },
        meta: { source: "audio_endpoint", timestamp: new Date().toISOString() },
      };
    }
    if (action === "set") {
      const level = clampVolume(Number(args.level ?? 50));
      const status = await setVolumeLevel(level);
      return {
        ok: true,
        data: { action, volume: status.volume, muted: status.muted, message: `Volume set to ${status.volume}%.` },
        meta: { source: "audio_endpoint", timestamp: new Date().toISOString() },
      };
    }
    if (action === "increase" || action === "decrease") {
      const step = clampVolume(Number(args.step ?? 10)) || 10;
      const status = await stepVolume(action === "increase" ? step : -step);
      return {
        ok: true,
        data: { action, volume: status.volume, muted: status.muted, message: `Volume ${action === "increase" ? "raised" : "lowered"} to ${status.volume}%.` },
        meta: { source: "audio_endpoint", timestamp: new Date().toISOString() },
      };
    }
    if (action === "mute" || action === "unmute") {
      const status = await setMuted(action === "mute");
      return {
        ok: true,
        data: { action, volume: status.volume, muted: status.muted, message: status.muted ? "Sound muted." : "Sound unmuted." },
        meta: { source: "audio_endpoint", timestamp: new Date().toISOString() },
      };
    }
    return { ok: false, error: { code: "INVALID_ACTION", message: "Volume action must be get, set, increase, decrease, mute, or unmute.", retryable: false } };
  } catch (err) {
    return failure(err instanceof SystemBridgeError ? err : new SystemBridgeError("VOLUME_FAILED", "Could not reach the audio endpoint.", true));
  }
}

export type ScreenshotToolResult = {
  name: string;
  url: string;
  bytes: number;
  capturedAt: string;
};

export async function executeTakeScreenshot(args: TakeScreenshotArgs = {}): Promise<ToolResult<ScreenshotToolResult>> {
  try {
    const shot = await takeScreenScreenshot(args.label);
    return {
      ok: true,
      data: { name: shot.name, url: shot.url, bytes: shot.bytes, capturedAt: new Date().toISOString() },
      meta: { source: "screen_capture", timestamp: new Date().toISOString() },
    };
  } catch (err) {
    return failure(err instanceof SystemBridgeError ? err : new SystemBridgeError("SCREENSHOT_FAILED", "Screen capture failed.", true));
  }
}

export type PdfToolResult = {
  name: string;
  url: string;
  sourceUrl: string;
};

export async function executeSavePagePdf(args: SavePagePdfArgs): Promise<ToolResult<PdfToolResult>> {
  const url = (args.url || "").trim();
  if (!url) {
    return { ok: false, error: { code: "MISSING_URL", message: "A web address is required to save as PDF.", retryable: false } };
  }
  try {
    const pdf = await savePageAsPdf(url, args.name);
    return {
      ok: true,
      data: { name: pdf.name, url: pdf.url, sourceUrl: pdf.sourceUrl },
      meta: { source: "pdf_vault", timestamp: new Date().toISOString() },
    };
  } catch (err) {
    return failure(err instanceof SystemBridgeError ? err : new SystemBridgeError("PDF_FAILED", "Could not render the page to PDF.", true));
  }
}

export type SystemStatusResult = DeviceSnapshot & {
  summary: string;
};

export async function executeGetSystemStatus(_args: GetSystemStatusArgs = {}): Promise<ToolResult<SystemStatusResult>> {
  try {
    const snapshot = await getDeviceSnapshot();
    const summary = snapshot.hostReady
      ? `${snapshot.machine}: volume ${snapshot.volume}%${snapshot.muted ? " (muted)" : ""}, ${snapshot.memoryFreeGb ?? "?"}GB free of ${snapshot.memoryTotalGb ?? "?"}GB RAM${snapshot.cpuLoad != null ? `, CPU at ${snapshot.cpuLoad}%` : ""}${snapshot.batteryPercent != null ? `, battery ${snapshot.batteryPercent}%${snapshot.charging ? " (charging)" : ""}` : ""}${snapshot.idleSeconds != null ? `, user idle ${Math.round(snapshot.idleSeconds)}s` : ""}.`
      : `Device bridge is not reachable right now (${snapshot.platform} host). Dashboard intelligence keeps running; real input and audio control pause until it returns.`;
    return {
      ok: true,
      data: { ...snapshot, summary },
      meta: { source: "device_snapshot", timestamp: new Date().toISOString() },
    };
  } catch (err) {
    return failure(err instanceof SystemBridgeError ? err : new SystemBridgeError("STATUS_FAILED", "Could not read device status.", true));
  }
}

export async function executeListWindows(_args: ListWindowsArgs = {}): Promise<ToolResult<{ windows: DesktopWindow[] }>> {
  try {
    const windows = await listDesktopWindows(25);
    return {
      ok: true,
      data: { windows },
      meta: { source: "window_enumeration", timestamp: new Date().toISOString() },
    };
  } catch (err) {
    return failure(err instanceof SystemBridgeError ? err : new SystemBridgeError("WINDOWS_FAILED", "Could not enumerate desktop windows.", true));
  }
}

export async function executeLaunchApplication(args: { app: string }): Promise<ToolResult<{ app: string }>> {
  try {
    const res = await launchApplication(args.app);
    return {
      ok: true,
      data: { app: res.app },
      meta: { source: "application_launcher", timestamp: new Date().toISOString() },
    };
  } catch (err) {
    return failure(err instanceof SystemBridgeError ? err : new SystemBridgeError("LAUNCH_FAILED", `Could not launch "${args.app}".`, true));
  }
}

export async function executeRealMouseClick(args: {
  xNorm?: number;
  yNorm?: number;
  button?: "left" | "right" | "middle";
  double?: boolean;
}): Promise<ToolResult<{ performed: string }>> {
  try {
    const res = await realMouseClick("takeover", args.xNorm, args.yNorm, args.button || "left", { double: args.double });
    return {
      ok: true,
      data: { performed: res.performed },
      meta: { source: "real_mouse_click", timestamp: new Date().toISOString() },
    };
  } catch (err) {
    return failure(err instanceof SystemBridgeError ? err : new SystemBridgeError("MOUSE_FAILED", "Could not perform mouse click.", true));
  }
}

export async function executeRealKeyboardType(args: { text?: string; hotkey?: string }): Promise<ToolResult<{ performed: string }>> {
  try {
    if (args.hotkey) {
      const res = await realPressHotkey("takeover", args.hotkey);
      return {
        ok: true,
        data: { performed: res.performed },
        meta: { source: "real_hotkey", timestamp: new Date().toISOString() },
      };
    }
    const res = await realTypeText("takeover", args.text || "");
    return {
      ok: true,
      data: { performed: res.performed },
      meta: { source: "real_type_text", timestamp: new Date().toISOString() },
    };
  } catch (err) {
    return failure(err instanceof SystemBridgeError ? err : new SystemBridgeError("KEYBOARD_FAILED", "Could not perform keyboard input.", true));
  }
}

export async function executeOpenNewBrowserTab(args: { url?: string }): Promise<ToolResult<{ url: string; opened: boolean }>> {
  try {
    const res = await openNewBrowserTab(args.url);
    return {
      ok: true,
      data: { url: res.url, opened: true },
      meta: { source: "browser_tabs", timestamp: new Date().toISOString() },
    };
  } catch (err) {
    return failure(err instanceof SystemBridgeError ? err : new SystemBridgeError("TAB_FAILED", "Could not open new browser tab.", true));
  }
}

export async function executeShellCommandTool(args: { command: string; cwd?: string }): Promise<ToolResult<ShellCommandResult>> {
  try {
    const res = await executeShellCommand(args.command, args.cwd);
    return {
      ok: true,
      data: res,
      meta: { source: "system_terminal", timestamp: new Date().toISOString() },
    };
  } catch (err) {
    return failure(err instanceof SystemBridgeError ? err : new SystemBridgeError("CMD_FAILED", "Command execution failed.", true));
  }
}
