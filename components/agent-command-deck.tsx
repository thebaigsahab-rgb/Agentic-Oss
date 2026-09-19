"use client";

import React, { useRef, useState } from "react";
import { Send, Loader2, TerminalSquare, Zap } from "lucide-react";
import type { AgentInputMode, DeviceSnapshot } from "@/lib/computer-use-types";
import { parseDeckCommand, type DeckIntent } from "@/lib/device-intents";
import styles from "./agent-cockpit.module.css";

export type CommandDeckEvent = {
  id: number;
  command: string;
  ok: boolean;
  message: string;
  at: string;
};

export type AgentCommandDeckProps = {
  inputMode: AgentInputMode;
  device: DeviceSnapshot | null;
  onLaunchMission: (goal: string) => void;
  onStatusMutated?: () => void;
};

const QUICK_ACTIONS = [
  { label: "📸 Screenshot", command: "screenshot" },
  { label: "⏯ Pause / Play", command: "pause" },
  { label: "⏭ Next track", command: "next song" },
  { label: "🔊 Vol +10", command: "increase volume by 10" },
  { label: "🔉 Vol −10", command: "decrease volume by 10" },
  { label: "🌐 Open New Tab", command: "open new tab" },
  { label: "🔇 Mute", command: "mute" },
  { label: "🪟 Windows", command: "list windows" },
  { label: "🚀 Open notepad", command: "open notepad" },
  { label: "▶ Play song…", command: "play " },
  { label: "🧪 Run Tests", command: "exec npm test" },
  { label: "📊 Git Status", command: "exec git status -s" },
  { label: "⌨ Type…", command: 'type "' },
];

export function AgentCommandDeck({ inputMode, device, onLaunchMission, onStatusMutated }: AgentCommandDeckProps) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<CommandDeckEvent[]>([]);
  const seqRef = useRef(1);

  const pushEvent = (cmd: string, ok: boolean, message: string) => {
    const entry: CommandDeckEvent = {
      id: seqRef.current++,
      command: cmd,
      ok,
      message,
      at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
    setFeed((prev) => [entry, ...prev].slice(0, 8));
  };

  const callSystem = async (payload: Record<string, unknown>): Promise<{ ok: boolean; message: string }> => {
    const res = await fetch("/api/system", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputMode, ...payload }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      ok?: boolean;
      error?: { message?: string } | string;
    };
    if (!res.ok || data.ok === false) {
      const err = data.error;
      const message = typeof err === "string" ? err : err?.message || `Request failed (${res.status}).`;
      return { ok: false, message };
    }
    return { ok: true, message: "" };
  };

  const runIntent = async (intent: DeckIntent, original: string) => {
    switch (intent.kind) {
      case "screenshot": {
        const { ok, message } = await callSystem({ action: "screenshot", label: `deck_${Date.now()}` });
        pushEvent(original, ok, ok ? "Screenshot saved to the vault." : message);
        break;
      }
      case "volume": {
        const v = intent.intent;
        if (v.action === "get") {
          const snapshot = device;
          pushEvent(original, true, snapshot?.hostReady ? `Volume is ${snapshot.volume}%${snapshot.muted ? " (muted)" : ""}.` : "Device bridge offline.");
          break;
        }
        const payload =
          v.action === "set" ? { action: "set_volume", level: v.level }
          : v.action === "increase" ? { action: "volume_step", delta: v.step ?? 10 }
          : v.action === "decrease" ? { action: "volume_step", delta: -(v.step ?? 10) }
          : { action: "set_mute", muted: v.action === "mute" };
        const { ok, message } = await callSystem(payload);
        pushEvent(original, ok, ok ? "Volume updated." : message);
        break;
      }
      case "media": {
        const { ok, message } = await callSystem({ action: "media_key", media: intent.action });
        pushEvent(original, ok, ok ? `Sent media "${intent.action}".` : message);
        break;
      }
      case "play_media": {
        const res = await fetch("/api/system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "play_media", query: intent.query }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; media?: { title?: string; fallbackSearch?: boolean }; error?: { message?: string } };
        if (data.ok && data.media) {
          pushEvent(original, true, data.media.fallbackSearch ? "Opened YouTube search — pick the video." : `Now playing "${data.media.title || intent.query}" on YouTube.`);
        } else {
          pushEvent(original, false, data.error?.message || "Playback failed.");
        }
        break;
      }
      case "open_url": {
        const { ok, message } = await callSystem({ action: "open_url", url: intent.url });
        pushEvent(original, ok, ok ? `Opened ${intent.url} in the default browser.` : message);
        break;
      }
      case "new_tab": {
        const { ok, message } = await callSystem({ action: "new_tab", url: intent.url });
        pushEvent(original, ok, ok ? `Opened new browser tab ${intent.url ? `(${intent.url})` : ""}.` : message);
        break;
      }
      case "execute_command": {
        const res = await fetch("/api/system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "execute_command", command: intent.command }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; stdout?: string; stderr?: string; exitCode?: number; error?: { message?: string } };
        if (data.ok) {
          const out = (data.stdout || data.stderr || "Executed successfully.").slice(0, 160);
          pushEvent(original, true, out);
        } else {
          pushEvent(original, false, data.error?.message || data.stderr || "Command execution failed.");
        }
        break;
      }
      case "launch_app": {
        const { ok, message } = await callSystem({ action: "launch_app", app: intent.app });
        pushEvent(original, ok, ok ? `Launched ${intent.app}.` : message);
        break;
      }
      case "save_pdf": {
        const { ok, message } = await callSystem({ action: "save_pdf", url: intent.url, name: `deck_${Date.now()}` });
        pushEvent(original, ok, ok ? "PDF saved to the vault." : message);
        break;
      }
      case "type_text": {
        const { ok, message } = await callSystem({ action: "type_text", text: intent.text });
        pushEvent(original, ok, ok ? "Typed on the real keyboard." : message);
        break;
      }
      case "press_hotkey": {
        const { ok, message } = await callSystem({ action: "press_hotkey", combo: intent.combo });
        pushEvent(original, ok, ok ? `Pressed ${intent.combo}.` : message);
        break;
      }
      case "click_mouse": {
        const { ok, message } = await callSystem({
          action: "click_mouse",
          x: intent.x,
          y: intent.y,
          button: intent.button,
        });
        pushEvent(original, ok, ok ? `Clicked (${intent.x}, ${intent.y}).` : message);
        break;
      }
      case "scroll": {
        const { ok, message } = await callSystem({ action: "scroll", dy: intent.dy });
        pushEvent(original, ok, ok ? "Scrolled." : message);
        break;
      }
      case "focus_window": {
        const { ok, message } = await callSystem({ action: "focus_window", title: intent.title });
        pushEvent(original, ok, ok ? `Focused "${intent.title}".` : message || "Window not found.");
        break;
      }
      case "list_windows": {
        const res = await fetch("/api/system?windows=1");
        const data = (await res.json().catch(() => ({}))) as { windows?: Array<{ title: string; process: string }> };
        const windows = data.windows || [];
        pushEvent(original, windows.length > 0, windows.length ? `${windows.length} windows: ${windows.slice(0, 4).map((w) => w.process).join(", ")}…` : "No titled windows found.");
        break;
      }
      case "system_status": {
        pushEvent(original, true, device?.hostReady ? `CPU ${device.cpuLoad ?? "—"}% · RAM ${device.memoryFreeGb ?? "—"}GB free · battery ${device.batteryPercent ?? "AC"}` : "Device bridge offline.");
        break;
      }
    }
    onStatusMutated?.();
  };

  const executeText = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busy) return;

    const intent = parseDeckCommand(text);
    if (!intent) {
      // Not a deterministic device command — escalate to the mission planner.
      pushEvent(text, true, "Not a direct device command — routing to the mission planner…");
      onLaunchMission(text);
      setCommand("");
      return;
    }

    setBusy(true);
    try {
      await runIntent(intent, text);
    } finally {
      setBusy(false);
      setCommand("");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeText(command);
  };

  return (
    <section className={styles.deckRoot} aria-label="Agent command deck">
      <form className={styles.deckInputRow} onSubmit={handleSubmit}>
        <TerminalSquare size={18} className={styles.deckIcon} />
        <input
          className={styles.deckInput}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={inputMode === "agent_owned" ? "Command the agent: screenshot · play song… · open notepad · volume 50 · type \"hello\"…" : "Command A.D.A.M. on the real PC: click 500 300 · press Ctrl+S · type \"report done\" · save pdf of https://…"}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className={styles.deckSend} disabled={busy || !command.trim()}>
          {busy ? <Loader2 size={16} className={styles.spin} /> : <Send size={16} />}
          Execute
        </button>
      </form>
      <div className={styles.deckChips}>
        <span className={styles.deckHint}>
          <Zap size={12} /> Quick:
        </span>
        {QUICK_ACTIONS.map((qa) => (
          <button
            key={qa.label}
            type="button"
            className={styles.deckChip}
            onClick={() => {
              if (qa.command.endsWith(" ") || qa.command.endsWith('"')) {
                // Stage the command so the user can finish the argument.
                setCommand(qa.command);
                requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`.${styles.deckInput}`)?.focus());
              } else {
                void executeText(qa.command);
              }
            }}
          >
            {qa.label}
          </button>
        ))}
      </div>
      {feed.length > 0 && (
        <div className={styles.deckFeed}>
          {feed.map((ev) => (
            <div key={ev.id} className={`${styles.feedItem} ${ev.ok ? styles.feedOk : styles.feedErr}`}>
              <span className={styles.feedTime}>{ev.at}</span>
              <code className={styles.feedCmd}>{ev.command}</code>
              <span className={styles.feedMsg}>{ev.message}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
