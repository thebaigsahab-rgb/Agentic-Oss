import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "data:text/javascript,export {};") return { format: "commonjs", source: "module.exports = {};", shortCircuit: true };
    return nextLoad(url, context);
  },
});

// ---------------------------------------------------------------------------
// Shared device intent parsers (lib/device-intents.ts) — pure, no PowerShell.
// ---------------------------------------------------------------------------

test("parsePlayCommand maps media requests and transport commands", async () => {
  const { parsePlayCommand } = await import("../lib/device-intents");

  // Song requests land on the exact query.
  const song = parsePlayCommand("play song hawayein");
  assert.deepEqual(song, { type: "query", query: "hawayein" });

  const bare = parsePlayCommand("play despacito");
  assert.deepEqual(bare, { type: "query", query: "despacito" });

  const called = parsePlayCommand("play a song called authors");
  assert.deepEqual(called, { type: "query", query: "authors" });

  // Transport commands stay transport.
  assert.deepEqual(parsePlayCommand("pause the music"), { type: "transport", action: "pause" });
  assert.deepEqual(parsePlayCommand("next song"), { type: "transport", action: "next" });
  assert.deepEqual(parsePlayCommand("previous track"), { type: "transport", action: "previous" });
  assert.deepEqual(parsePlayCommand("resume"), { type: "transport", action: "toggle" });
  assert.deepEqual(parsePlayCommand("stop the music"), { type: "transport", action: "stop" });
  assert.deepEqual(parsePlayCommand("play music"), { type: "transport", action: "toggle" });

  // Unrelated text yields nothing.
  assert.equal(parsePlayCommand("what is the weather"), null);
  assert.equal(parsePlayCommand("create a task for tomorrow"), null);
});

test("parseVolumeCommand handles absolute, relative, and mute intents", async () => {
  const { parseVolumeCommand } = await import("../lib/device-intents");

  // "increase the sound to 50%" — absolute target wins over the verb.
  assert.deepEqual(parseVolumeCommand("increase the sound to 50%"), { action: "set", level: 50 });
  assert.deepEqual(parseVolumeCommand("set volume to 65"), { action: "set", level: 65 });
  assert.deepEqual(parseVolumeCommand("decrease to 20%"), { action: "set", level: 20 });
  assert.deepEqual(parseVolumeCommand("volume 30"), { action: "set", level: 30 });

  // Relative steps.
  assert.deepEqual(parseVolumeCommand("increase volume by 20"), { action: "increase", step: 20 });
  assert.deepEqual(parseVolumeCommand("decrease the sound by 15 points"), { action: "decrease", step: 15 });
  assert.deepEqual(parseVolumeCommand("volume up"), { action: "increase" });
  assert.deepEqual(parseVolumeCommand("turn the volume down"), { action: "decrease" });
  assert.deepEqual(parseVolumeCommand("louder by 25"), { action: "increase", step: 25 });

  // Mute family (unmute must win over the mute substring).
  assert.deepEqual(parseVolumeCommand("mute"), { action: "mute" });
  assert.deepEqual(parseVolumeCommand("unmute"), { action: "unmute" });
  assert.deepEqual(parseVolumeCommand("silence the audio"), { action: "mute" });

  // Queries.
  assert.deepEqual(parseVolumeCommand("what is the volume"), { action: "get" });
  assert.deepEqual(parseVolumeCommand("current volume?"), { action: "get" });

  // Levels clamp into 0-100.
  assert.deepEqual(parseVolumeCommand("set volume to 250"), { action: "set", level: 100 });

  // Non-volume text is ignored (e.g. a song called "Sound of Silence").
  assert.equal(parseVolumeCommand("play sound of silence"), null);
});

test("parseDeckCommand dispatches device commands without the LLM", async () => {
  const { parseDeckCommand } = await import("../lib/device-intents");

  assert.deepEqual(parseDeckCommand("screenshot"), { kind: "screenshot" });
  assert.deepEqual(parseDeckCommand("take a screenshot"), { kind: "screenshot" });
  assert.deepEqual(parseDeckCommand("save pdf of https://example.com/article"), {
    kind: "save_pdf",
    url: "https://example.com/article",
  });
  assert.deepEqual(parseDeckCommand("open notepad"), { kind: "launch_app", app: "notepad" });
  assert.deepEqual(parseDeckCommand("go to github.com/trending"), { kind: "open_url", url: "github.com/trending" });
  assert.deepEqual(parseDeckCommand('type "hello world"'), { kind: "type_text", text: "hello world" });
  assert.deepEqual(parseDeckCommand("press ctrl+s"), { kind: "press_hotkey", combo: "ctrl+s" });
  assert.deepEqual(parseDeckCommand("click at 500 300"), { kind: "click_mouse", x: 500, y: 300, button: "left" });
  assert.deepEqual(parseDeckCommand("click 420 180 right"), { kind: "click_mouse", x: 420, y: 180, button: "right" });
  assert.deepEqual(parseDeckCommand("scroll down"), { kind: "scroll", dy: 360 });
  assert.deepEqual(parseDeckCommand("focus vscode"), { kind: "focus_window", title: "vscode" });
  assert.deepEqual(parseDeckCommand("play song hawayein"), { kind: "play_media", query: "hawayein" });
  assert.deepEqual(parseDeckCommand("increase volume by 10"), {
    kind: "volume",
    intent: { action: "increase", step: 10 },
  });

  assert.deepEqual(parseDeckCommand("open new tab"), { kind: "new_tab", url: undefined });
  assert.deepEqual(parseDeckCommand("new tab"), { kind: "new_tab", url: undefined });
  assert.deepEqual(parseDeckCommand("open new tab https://github.com"), { kind: "new_tab", url: "https://github.com" });
  assert.deepEqual(parseDeckCommand("exec npm test"), { kind: "execute_command", command: "npm test" });
  assert.deepEqual(parseDeckCommand("run command dir"), { kind: "execute_command", command: "dir" });

  // Complex goals are escalated, not mis-executed.
  assert.equal(parseDeckCommand("research the latest agentic frameworks and compile a competitor radar"), null);
});

// ---------------------------------------------------------------------------
// System bridge pure safety layer (lib/server/system-bridge.ts).
// ---------------------------------------------------------------------------

test("resolveInputPermission gates real mouse/keyboard by mode and idle", async () => {
  const { resolveInputPermission } = await import("../lib/server/system-bridge");

  // agent_owned never touches the real devices.
  assert.equal(resolveInputPermission("agent_owned", 999).allowed, false);

  // auto_idle requires the idle measurement and the threshold.
  assert.equal(resolveInputPermission("auto_idle", null).allowed, false);
  assert.equal(resolveInputPermission("auto_idle", 1).allowed, false);
  const granted = resolveInputPermission("auto_idle", 12);
  assert.equal(granted.allowed, true);

  // takeover is explicit consent.
  assert.equal(resolveInputPermission("takeover", 0).allowed, true);

  // Threshold is tunable.
  assert.equal(resolveInputPermission("auto_idle", 3, 5).allowed, false);
  assert.equal(resolveInputPermission("auto_idle", 6, 5).allowed, true);
});

test("validateHotkey refuses system-level chords and maps safe ones", async () => {
  const { validateHotkey } = await import("../lib/server/system-bridge");

  const win = validateHotkey("Win+D");
  assert.equal(win.ok, false);
  if (!win.ok) assert.match(win.reason, /Windows-key/i);

  const altF4 = validateHotkey("Alt+F4");
  assert.equal(altF4.ok, false);
  if (!altF4.ok) assert.match(altF4.reason, /Alt\+F4/i);

  const cad = validateHotkey("Ctrl+Alt+Del");
  assert.equal(cad.ok, false);

  const ok = validateHotkey("Ctrl+S");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.sendKeys, "^s");

  const enter = validateHotkey("Enter");
  assert.equal(enter.ok, true);
  if (enter.ok) assert.equal(enter.sendKeys, "{ENTER}");

  const garbage = validateHotkey("Ctrl+Alt+Shift+Win+Q");
  assert.equal(garbage.ok, false);
});

test("escapeSendKeysText neutralizes operator characters", async () => {
  const { escapeSendKeysText } = await import("../lib/server/system-bridge");
  assert.equal(escapeSendKeysText("hello world"), "hello world");
  // SendKeys escaping wraps each operator char in braces individually.
  assert.equal(escapeSendKeysText("100% done (ok)"), "100{%} done {(}ok{)}");
  assert.equal(escapeSendKeysText("line\nbreak"), "line{ENTER}break");
});

test("isBlockedCommand extends the shell guardrail vocabulary", async () => {
  const { isBlockedCommand } = await import("../lib/server/system-bridge");
  assert.equal(isBlockedCommand("node -v"), null);
  assert.equal(isBlockedCommand("git status"), null);
  assert.equal(isBlockedCommand("rm -rf /"), "rm -rf");
  assert.equal(isBlockedCommand("shutdown /s"), "shutdown");
  assert.equal(isBlockedCommand("reg delete HKLM\\Software"), "reg delete");
  assert.equal(isBlockedCommand("Remove-Item -Recurse C:\\Users"), "remove-item -recurse");
});

test("clampVolume clamps to the Windows 0-100 scalar range", async () => {
  const { clampVolume } = await import("../lib/server/system-bridge");
  assert.equal(clampVolume(50), 50);
  assert.equal(clampVolume(-5), 0);
  assert.equal(clampVolume(140), 100);
  assert.equal(clampVolume(Number.NaN), 0);
  assert.equal(clampVolume(49.6), 50);
});

test("sanitizeArtifactName rejects traversal, devices, and paths", async () => {
  const { sanitizeArtifactName, SystemBridgeError } = await import("../lib/server/system-bridge");

  assert.equal(sanitizeArtifactName("shot_2026_09_14.png"), "shot_2026_09_14.png");

  assert.throws(() => sanitizeArtifactName("../../etc/passwd"), SystemBridgeError);
  assert.throws(() => sanitizeArtifactName("..\\..\\windows\\system.ini"), SystemBridgeError);
  assert.throws(() => sanitizeArtifactName("con.png"), SystemBridgeError);
  assert.throws(() => sanitizeArtifactName(""), SystemBridgeError);
});

// ---------------------------------------------------------------------------
// YouTube resolution (lib/server/jarvis-device-tools.ts) — pure extraction.
// ---------------------------------------------------------------------------

test("extractYouTubeVideo lifts the first videoRenderer id and title", async () => {
  const { extractYouTubeVideo, buildYouTubeWatchUrl, buildYouTubeSearchUrl } = await import(
    "../lib/server/jarvis-device-tools"
  );

  const html = `window["ytInitialData"] = {"contents":[{"videoRenderer":{"videoId":"aKb2Xw5mQp0","thumbnail":{},"title":{"runs":[{"text":"Hawayein - Official Video"}]}}},{"videoRenderer":{"videoId":"zzzzzzzzzzz"}}]};`;
  const match = extractYouTubeVideo(html);
  assert.ok(match);
  assert.equal(match.videoId, "aKb2Xw5mQp0");
  assert.equal(match.title, "Hawayein - Official Video");

  assert.deepEqual(extractYouTubeVideo(""), null);
  assert.deepEqual(extractYouTubeVideo("no data here"), null);

  // Escaped titles decode correctly.
  const escaped = extractYouTubeVideo(`{"videoRenderer":{"videoId":"bB3YyZ6nRr1","title":{"runs":[{"text":"Arijit Singh \\u0026 Shreya"}]}}}`);
  assert.ok(escaped);
  assert.equal(escaped.title, "Arijit Singh & Shreya");

  // Fallback to any videoId when no renderer shape is present.
  const fallback = extractYouTubeVideo(`{"lockupViewModel":{"videoId":"cC4DzZ7oSs2"}}`);
  assert.ok(fallback);
  assert.equal(fallback.videoId, "cC4DzZ7oSs2");

  assert.equal(buildYouTubeWatchUrl("aKb2Xw5mQp0"), "https://www.youtube.com/watch?v=aKb2Xw5mQp0");
  assert.equal(
    buildYouTubeSearchUrl("hawayein song"),
    `https://www.youtube.com/results?search_query=${encodeURIComponent("hawayein song")}`,
  );
});

// ---------------------------------------------------------------------------
// EncodedCommand hygiene — user text must never reach a raw shell string.
// ---------------------------------------------------------------------------

test("buildPowerShellCommand encodes the script as UTF-16LE base64", async () => {
  const { buildPowerShellCommand } = await import("../lib/server/system-bridge");

  const evil = "Start-Process 'x'; Remove-Item C:\\ -Recurse; [Vol]::SetVolume(0)";
  const command = buildPowerShellCommand(evil);
  assert.ok(command.startsWith("powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand "));
  const encoded = command.slice(command.lastIndexOf(" ") + 1);
  // Base64 of UTF-16LE: round-trip must reproduce the exact script.
  const decoded = Buffer.from(encoded, "base64").toString("utf16le");
  assert.equal(decoded, evil);
});
