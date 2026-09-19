// Shared, platform-free intent parsers for device commands. Used by the
// J.A.R.V.I.S. chat fast paths (server) and the Computer Use command deck
// (client) so a spoken command and a typed command behave identically.
import type { AgentInputMode } from "./computer-use-types";

const MEDIA_NOUN = /(music|song|video|track|audio|media)/;

export type MediaAction = "play" | "pause" | "toggle" | "next" | "previous" | "stop";

export type MediaTransportIntent =
  | { type: "transport"; action: MediaAction }
  | { type: "query"; query: string };

export function parseMediaCommand(text: string): MediaTransportIntent | null {
  const t = (text || "").toLowerCase().trim();

  const nextMatch = t.match(/\b(?:play\s+)?(?:the\s+)?(?:next|following|skip)(?:\s+(?:song|track|video|one))?\b/);
  if (nextMatch && !t.includes("play next by")) return { type: "transport", action: "next" };

  if (/\b(?:previous|prev|go\s+back|last\s+song|rewind\s+track)\b/.test(t)) {
    return { type: "transport", action: "previous" };
  }
  if (/\b(?:pause|hold)\b/.test(t) && !/\bunpause\b/.test(t)) {
    return { type: "transport", action: "pause" };
  }
  if (/\b(?:unpause|resume|continue)\b/.test(t)) {
    return { type: "transport", action: "toggle" };
  }
  if (/\bstop\b/.test(t) && MEDIA_NOUN.test(t)) {
    return { type: "transport", action: "stop" };
  }
  // Bare "play music" / "play a song" (no title) = transport toggle.
  const genericPlay = t.match(/^play\s+(?:the\s+|some\s+|a\s+)?(?:music|song|video|track|tune|media|beats)s?\s*[!.?]*$/);
  if (genericPlay) return { type: "transport", action: "toggle" };
  if (/^(?:resume|unpause)/.test(t.trim())) return { type: "transport", action: "toggle" };
  return null;
}

export type PlayIntent =
  | { type: "transport"; action: MediaAction }
  | { type: "query"; query: string };

// "play song hawayein" -> query "hawayein"; "pause" -> transport pause.
export function parsePlayCommand(text: string): PlayIntent | null {
  const t = (text || "").trim();
  const lower = t.toLowerCase();

  const transport = parseMediaCommand(lower);
  if (transport && transport.type === "transport") return transport;

  const playMatch = lower.match(/^(?:please\s+)?play\s+(?:a\s+song\s+(?:called\s+|named\s+)?|song\s+|video\s+|music\s+|track\s+|gaana\s+)?(.+?)[.!?]*$/);
  if (playMatch) {
    const title = playMatch[1].trim();
    if (title && !/^(?:the\s+)?(?:music|song|video|track|media)s?$/.test(title)) {
      // Strip leading filler words common in voice commands, and trailing YouTube or urgency tags
      let cleaned = title.replace(/^(?:a\s+|an\s+|the\s+|some\s+)/, "").trim();
      cleaned = cleaned.replace(/\s+(?:on|in|from|via)\s+youtube\b/i, "").trim();
      cleaned = cleaned.replace(/\s+(?:right\s+now|in\s+real\s*time|immediately)\b/gi, "").trim();
      return { type: "query", query: cleaned || title };
    }
  }
  if (/^(?:please\s+)?(?:start|drop|put\s+on)\s+(?:the\s+)?(?:music|song)/.test(lower) && !lower.includes(" by ")) {
    return { type: "transport", action: "toggle" };
  }
  return null;
}

export type VolumeIntent =
  | { action: "get" }
  | { action: "set"; level: number }
  | { action: "increase"; step?: number }
  | { action: "decrease"; step?: number }
  | { action: "mute" }
  | { action: "unmute" };

export function clampVolume(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(100, Math.round(level)));
}

export function parseVolumeCommand(text: string): VolumeIntent | null {
  const t = (text || "").toLowerCase().trim();
  if (!t) return null;

  // Anchored phrases ("volume 30", "mute", "louder") always parse. Verb-led
  // elliptical commands ("decrease to 20%", "increase by 20") parse only when
  // a number is present — that keeps ordinary chat like "the market is down"
  // or "drop the table" from touching the audio endpoint.
  const anchored = /(volume|sound|audio|louder|quieter|loudest|mute|unmute|silence)/.test(t);
  if (!anchored) {
    const numericCommand = /\d/.test(t) && /^(?:please\s+)?(?:turn|increase|decrease|raise|lower|reduce|drop|boost|set)\b/.test(t);
    if (!numericCommand) return null;
  }

  // A playback request is never a volume command — even when the song title
  // contains audio words ("play sound of silence").
  if (/^(?:please\s+)?(?:play|put\s+on|drop\s+(?:the\s+)?(?:beat|music|song))\b/.test(t)) return null;

  if (/\b(?:unmute|turn\s+(?:the\s+)?sound\s+back\s+on|sound\s+on)\b/.test(t)) return { action: "unmute" };
  if (/\b(?:mute|silence)\b/.test(t)) return { action: "mute" };

  const toNumber = t.match(/\b(?:to|at|upto|up\s+to)\s*(?:level\s*|volume\s*)?(\d{1,3})\s*(?:%|percent(?:age)?)?/);
  const byNumber = t.match(/\bby\s+(\d{1,3})\s*(?:%|points?|percent)?/);
  const suffixNumber = t.match(/(?:volume|sound|audio)\s*(?:level)?\s*[:=]?\s*(\d{1,3})\s*(?:%|percent)?/);

  const wantsUp = /\b(?:increase|raise|up|louder|loudest|higher|boost|max)\b/.test(t) || /^(?:up|volume\s*up)\b/.test(t.trim());
  const wantsDown = /\b(?:decrease|reduce|lower|down|quieter|soften|drop)\b/.test(t) || /^(?:down|volume\s*down)\b/.test(t.trim());

  if (toNumber) {
    return { action: "set", level: clampVolume(Number(toNumber[1])) };
  }
  if (suffixNumber && !wantsUp && !wantsDown) {
    return { action: "set", level: clampVolume(Number(suffixNumber[1])) };
  }
  if (byNumber && (wantsUp || wantsDown)) {
    const step = clampVolume(Number(byNumber[1]));
    return wantsUp ? { action: "increase", step } : { action: "decrease", step };
  }
  if (wantsUp && !wantsDown) return { action: "increase" };
  if (wantsDown && !wantsUp) return { action: "decrease" };
  if (/\b(?:what|how|current|check|tell|which)\b/.test(t) || /\?$/.test(t)) return { action: "get" };
  return null;
}

// One-shot parse of a command-deck line into a concrete device action.
// Deterministic commands never need the LLM; anything unrecognized returns
// null so the caller can escalate (e.g. run it as an autonomous mission).
export type DeckIntent =
  | { kind: "launch_app"; app: string }
  | { kind: "open_url"; url: string }
  | { kind: "new_tab"; url?: string }
  | { kind: "execute_command"; command: string }
  | { kind: "screenshot" }
  | { kind: "save_pdf"; url: string; name?: string }
  | { kind: "volume"; intent: VolumeIntent }
  | { kind: "media"; action: MediaAction }
  | { kind: "play_media"; query: string }
  | { kind: "type_text"; text: string }
  | { kind: "press_hotkey"; combo: string }
  | { kind: "click_mouse"; x: number; y: number; button: "left" | "right" }
  | { kind: "scroll"; dy: number }
  | { kind: "focus_window"; title: string }
  | { kind: "list_windows" }
  | { kind: "switch_tab"; direction?: "next" | "prev" }
  | { kind: "cycle_window" }
  | { kind: "teach_skill"; name?: string }
  | { kind: "system_status" };

const URL_LIKE = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;

export function parseDeckCommand(raw: string): DeckIntent | null {
  const text = (raw || "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  // Screenshot
  if (/^(?:take\s+|capture\s+|grab\s+)?(?:a\s+)?(?:screen\s*)?screenshot\b/.test(lower)) {
    return { kind: "screenshot" };
  }

  // Switch tab ("move from one tab to another", "switch tab", "next tab", "ctrl+tab")
  if (
    /^(?:switch|move|cycle|change|go\s+to\s+next)\s+(?:from\s+one\s+tab\s+to\s+another|tabs?|browser\s+tabs?)/.test(lower) ||
    /^(?:next\s+tab|switch\s+tab)$/.test(lower) ||
    /^(?:press\s+)?ctrl\+tab$/.test(lower)
  ) {
    return { kind: "switch_tab", direction: "next" };
  }
  if (/^(?:previous|prev)\s+tab$/.test(lower) || /^(?:press\s+)?ctrl\+shift\+tab$/.test(lower)) {
    return { kind: "switch_tab", direction: "prev" };
  }

  // Switch / cycle window ("cycle windows", "switch window", "alt+tab")
  if (/^(?:cycle\s+windows?|switch\s+windows?|next\s+window)$/.test(lower) || /^(?:press\s+)?alt\+tab$/.test(lower)) {
    return { kind: "cycle_window" };
  }

  // Teach skill ("teach task: xyz", "teach skill xyz", "/teach skill")
  const teachMatch = text.match(/^(?:teach|record)\s+(?:task|skill)(?::|\s+)?\s*(.*)$/i);
  if (teachMatch) {
    return { kind: "teach_skill", name: teachMatch[1]?.trim() };
  }

  // PDF capture: "save pdf of <url>" / "pdf <url>" / "save <url> as pdf"
  const pdfMatch = text.match(/^(?:save\s+)?pdf\s+(?:of\s+)?(\S+)/i) || text.match(/^save\s+(\S+)\s+as\s+pdf$/i);
  if (pdfMatch && URL_LIKE.test(pdfMatch[1])) {
    return { kind: "save_pdf", url: pdfMatch[1] };
  }

  // Volume
  const volumeIntent = parseVolumeCommand(lower);
  if (volumeIntent) return { kind: "volume", intent: volumeIntent };

  // Media transport
  const mediaIntent = parseMediaCommand(lower);
  if (mediaIntent && mediaIntent.type === "transport") return { kind: "media", action: mediaIntent.action };

  // Media playback ("play song hawayein", "play song arj kiya hai in youtube")
  const playIntent = parsePlayCommand(lower);
  if (playIntent && playIntent.type === "query") return { kind: "play_media", query: playIntent.query };

  // Type text
  const typeMatch = text.match(/^(?:type|write|enter)\s+"([\s\S]+)"$/i) || text.match(/^(?:type|write|enter)\s+(.+)$/i);
  if (typeMatch) return { kind: "type_text", text: typeMatch[1] };

  // Hotkey
  const keyMatch = text.match(/^(?:press|hotkey|key)\s+(?:the\s+)?(.+)$/i);
  if (keyMatch) return { kind: "press_hotkey", combo: keyMatch[1] };

  // Click at coordinates
  const clickMatch = lower.match(/^click\s+(?:at\s+)?(\d{1,4})\s*[,\s]\s*(\d{1,4})(?:\s+(right))?$/);
  if (clickMatch) {
    return { kind: "click_mouse", x: Number(clickMatch[1]), y: Number(clickMatch[2]), button: clickMatch[3] === "right" ? "right" : "left" };
  }

  // Scroll
  if (/^scroll\s+down\b/.test(lower)) return { kind: "scroll", dy: 360 };
  if (/^scroll\s+up\b/.test(lower)) return { kind: "scroll", dy: -360 };

  // Focus a window / list windows
  const focusMatch = text.match(/^(?:focus|switch\s+to)\s+(?:window\s+)?(.+)$/i);
  if (focusMatch) return { kind: "focus_window", title: focusMatch[1] };
  if (/^(?:list\s+)?windows$/.test(lower) || /^list\s+windows$/.test(lower)) return { kind: "list_windows" };

  // System status
  if (/^(?:system|pc|device)?\s*status$/.test(lower)) return { kind: "system_status" };

  // Open new tab ("open new tab", "open a new tab", "new tab", "create tab", "open tab")
  const newTabMatch = text.match(/^(?:please\s+)?(?:open\s+(?:a\s+)?new\s+tab|new\s+tab|create\s+(?:a\s+)?(?:new\s+)?tab|open\s+tab)(?:\s+(?:for|with|at|to)?\s*(.+))?$/i);
  if (newTabMatch) {
    const rawTarget = newTabMatch[1]?.trim().replace(/[.!?]+$/, "");
    return { kind: "new_tab", url: rawTarget || undefined };
  }

  // Shell Command Execution ("run command dir", "execute dir", "powershell Get-Process", "exec npm test")
  const execMatch = text.match(/^(?:please\s+)?(?:execute|run|exec)\s+(?:command|cmd|powershell|shell|script)?\s*[:=]?\s*(.+)$/i)
    || text.match(/^(?:powershell|cmd|terminal)\s*[:=]?\s*(.+)$/i);
  if (execMatch) {
    const candidate = execMatch[1].trim();
    if (!/^(?:notepad|calc|calculator|paint|spotify|chrome|edge|code|terminal|explorer|forza|discord|slack)$/i.test(candidate)) {
      return { kind: "execute_command", command: candidate };
    }
  }

  // Open a URL or Launch Application
  const openMatch = text.match(/^(?:open|go\s+to|visit|launch|run|start)\s+(.+)$/i);
  if (openMatch) {
    const target = openMatch[1].trim().replace(/[.!?]+$/, "");
    if (URL_LIKE.test(target)) return { kind: "open_url", url: target };
    // Known app alias or executable
    const app = target.replace(/^(?:the\s+)/, "").toLowerCase();
    return { kind: "launch_app", app };
  }

  return null;
}

export const INPUT_MODE_LABELS: Record<AgentInputMode, string> = {
  agent_owned: "Agent-owned",
  auto_idle: "Auto-idle borrow",
  takeover: "Takeover",
};

export const INPUT_MODE_DESCRIPTIONS: Record<AgentInputMode, string> = {
  agent_owned: "The agent uses only its own virtual mouse & keyboard. Your real devices are never touched.",
  auto_idle: "While you are idle the agent borrows your REAL mouse & keyboard; the moment you move, it hands them back and switches to virtual motors.",
  takeover: "You explicitly hand over the real mouse & keyboard now. The agent operates them directly until you release control.",
};
