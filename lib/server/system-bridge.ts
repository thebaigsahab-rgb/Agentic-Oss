import "server-only";

import { exec } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AgentInputMode as InputMode,
  ArtifactInfo,
  ArtifactKind,
  DeviceSnapshot,
  DesktopWindow,
} from "@/lib/computer-use-types";
import type { MediaAction } from "@/lib/device-intents";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// System Bridge — the real actuation layer of the Agentic OS.
//
// The Next.js server runs on the user's machine, so it can drive the actual
// device through Windows PowerShell (Windows PowerShell 5.1 ships with every
// Windows 10/11 install — no external tooling required). Every actuation is
// expressed as an EncodedCommand script so user text can never break out of
// quoting, and every raw-input action flows through the safety gates in this
// module before touching the user's real mouse and keyboard.
// ---------------------------------------------------------------------------

export class SystemBridgeError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

export const isWindows = () => process.platform === "win32";

function assertWindows(feature: string) {
  if (!isWindows()) {
    throw new SystemBridgeError(
      "PLATFORM_UNSUPPORTED",
      `${feature} requires a Windows host; the device bridge is unavailable on ${process.platform}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// PowerShell execution. The script is staged into a per-call temp .ps1 file:
// EncodedCommand rides the command line, which cmd.exe caps at 8K characters
// — far too small for the compiled C# interop blocks. A file path has no such
// limit, and the temp dir is wiped after every call.
// ---------------------------------------------------------------------------

export function encodePowerShellScript(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function buildPowerShellCommand(script: string): string {
  return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodePowerShellScript(script)}`;
}

async function runPowerShell(script: string, timeoutMs = 12_000): Promise<string> {
  assertWindows("PowerShell actuation");
  const dir = mkdtempSync(path.join(tmpdir(), "cc-ps1-"));
  const file = path.join(dir, "bridge.ps1");
  try {
    writeFileSync(file, script, "utf8");
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${file}"`,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Temp cleanup is best effort.
    }
  }
}

// ---------------------------------------------------------------------------
// Artifact storage — screenshots & PDF vaults under the Control Center data
// directory so backups and cleanup can reason about them as one unit.
// ---------------------------------------------------------------------------

function resolveDataDir(): string {
  const configured = process.env.CONTROL_CENTER_DATA_DIR?.trim();
  if (configured && path.isAbsolute(configured)) return configured;
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || tmpdir();
    return path.join(base, "Control Center");
  }
  if (process.platform === "darwin") {
    return path.join(process.env.HOME || tmpdir(), "Library", "Application Support", "Control Center");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(process.env.HOME || tmpdir(), ".local", "share"), "control-center");
}

export function screenshotDir(): string {
  return path.join(resolveDataDir(), "os-artifacts", "screenshots");
}

export function pdfDir(): string {
  return path.join(resolveDataDir(), "os-artifacts", "pdf");
}

function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Pure sanitizer: rejects traversal, devices, and reserved Windows names.
const RESERVED_NAMES = new Set(["con", "prn", "aux", "nul"]);

export function sanitizeArtifactName(raw: string): string {
  const input = (raw || "").trim();
  // Reject any path-like or traversal input before it can be normalized away
  // by the platform (backslashes are not separators on POSIX, so basename
  // alone is not enough to be platform-independent).
  if (!input || input === "." || input === "..") {
    throw new SystemBridgeError("INVALID_NAME", "Artifact name is required.");
  }
  if (input.includes("..") || input.includes("/") || input.includes("\\")) {
    throw new SystemBridgeError("INVALID_NAME", "Artifact name must be a plain file name.");
  }
  const base = input.replace(/[\x00-\x1f]/g, "");
  const stem = base.replace(/\.(png|pdf|jpg|jpeg)$/i, "").toLowerCase();
  if (RESERVED_NAMES.has(stem)) {
    throw new SystemBridgeError("INVALID_NAME", `"${stem}" is a reserved device name.`);
  }
  return base;
}

function artifactDirFor(kind: ArtifactKind): string {
  return kind === "screenshots" ? screenshotDir() : pdfDir();
}

export function resolveArtifactPath(kind: ArtifactKind, name: string): string {
  const safeName = sanitizeArtifactName(name);
  if (kind === "screenshots" && !/\.(png|jpe?g)$/i.test(safeName)) {
    throw new SystemBridgeError("INVALID_NAME", "Screenshot files must be .png or .jpg.");
  }
  if (kind === "pdf" && !/\.pdf$/i.test(safeName)) {
    throw new SystemBridgeError("INVALID_NAME", "PDF vault files must be .pdf.");
  }
  const resolved = path.join(artifactDirFor(kind), safeName);
  if (path.dirname(resolved) !== artifactDirFor(kind)) {
    throw new SystemBridgeError("INVALID_NAME", "Artifact path escaped its vault.");
  }
  return resolved;
}

export function listArtifacts(kind: ArtifactKind, limit = 40): ArtifactInfo[] {
  const dir = artifactDirFor(kind);
  if (!existsSync(dir)) return [];
  const matcher = kind === "screenshots" ? /\.(png|jpe?g)$/i : /\.pdf$/i;
  const rows: ArtifactInfo[] = [];
  for (const entry of readdirSync(dir)) {
    if (!matcher.test(entry)) continue;
    const full = path.join(dir, entry);
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
      rows.push({
        name: entry,
        bytes: st.size,
        createdAt: st.birthtime.toISOString(),
        modifiedAt: st.mtime.toISOString(),
        url: `/api/system/artifacts/${kind}/${encodeURIComponent(entry)}`,
      });
    } catch {
      // File vanished mid-listing; skip it.
    }
  }
  return rows.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, limit);
}

export function readArtifact(kind: ArtifactKind, name: string): Buffer {
  const filePath = resolveArtifactPath(kind, name);
  if (!existsSync(filePath)) {
    throw new SystemBridgeError("NOT_FOUND", `"${name}" is not in the ${kind} vault.`);
  }
  return readFileSync(filePath);
}

export function deleteArtifact(kind: ArtifactKind, name: string): boolean {
  const filePath = resolveArtifactPath(kind, name);
  if (!existsSync(filePath)) return false;
  rmSync(filePath);
  return true;
}

// ---------------------------------------------------------------------------
// Pure safety gates — shared with tests, no PowerShell required.
// ---------------------------------------------------------------------------

export type InputPermission = {
  allowed: boolean;
  reason: string;
};

// Real mouse/keyboard arbitration. "agent_owned" never touches the user's
// devices (virtual playback only). "auto_idle" takes the real devices only
// while the user is away. "takeover" was explicitly granted by the user.
export const DEFAULT_IDLE_THRESHOLD_SECONDS = 4;

export function resolveInputPermission(
  mode: InputMode,
  userIdleSeconds: number | null,
  idleThresholdSeconds = DEFAULT_IDLE_THRESHOLD_SECONDS,
): InputPermission {
  if (mode === "takeover") {
    return { allowed: true, reason: "User granted explicit takeover of the real mouse and keyboard." };
  }
  if (mode === "auto_idle") {
    if (userIdleSeconds === null) {
      return { allowed: false, reason: "User idle time could not be measured; refusing real input." };
    }
    if (userIdleSeconds >= idleThresholdSeconds) {
      return { allowed: true, reason: `User idle for ${userIdleSeconds}s (threshold ${idleThresholdSeconds}s); devices are free.` };
    }
    return { allowed: false, reason: `User is actively using the devices (idle ${userIdleSeconds}s < ${idleThresholdSeconds}s).` };
  }
  return { allowed: false, reason: "Agent-owned mode: virtual playback only, real devices untouched." };
}

// Volume levels clamp to the 0-100 scalar range Windows exposes.
export function clampVolume(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(100, Math.round(level)));
}

// Hotkeys the agent may synthesize. Anything system-level (Win, Alt+F4,
// Ctrl+Alt+Del, lock/reboot chords) is refused outright.
const HOTKEY_PATTERN = /^(?:(?:ctrl|control)\+)?(?:(?:alt|option)\+)?(?:shift\+)?(?:[a-z0-9]|f([1-9]|1[0-2])|enter|escape|esc|tab|space|backspace|delete|home|end|pageup|pagedown|up|down|left|right)$/i;

export function validateHotkey(combo: string): { ok: true; sendKeys: string } | { ok: false; reason: string } {
  const normalized = (combo || "").trim().replace(/\s+/g, "");
  if (!normalized) return { ok: false, reason: "Hotkey combination is required." };
  if (/^(win|meta|super)(\+|$)/i.test(normalized)) {
    return { ok: false, reason: "Windows-key chords are blocked by the safety guardrails." };
  }
  if (/^ctrl\+alt\+(del|delete)$/i.test(normalized)) {
    return { ok: false, reason: "Ctrl+Alt+Del is a secure-attention sequence and cannot be synthesized." };
  }
  if (/^alt\+f4$/i.test(normalized)) {
    return { ok: false, reason: "Alt+F4 (window kill) is blocked by the safety guardrails." };
  }
  if (!HOTKEY_PATTERN.test(normalized)) {
    return { ok: false, reason: `"${combo}" is not a recognized single hotkey (Ctrl/Alt/Shift + key).` };
  }
  return { ok: true, sendKeys: mapHotkeyToSendKeys(normalized) };
}

function mapHotkeyToSendKeys(normalized: string): string {
  const parts = normalized.toLowerCase().split("+");
  let prefix = "";
  const key = parts[parts.length - 1];
  for (const part of parts.slice(0, -1)) {
    if (part === "ctrl" || part === "control") prefix += "^";
    if (part === "alt" || part === "option") prefix += "%";
    if (part === "shift") prefix += "+";
  }
  const fnMatch = key.match(/^f([1-9]|1[0-2])$/);
  if (fnMatch) return `${prefix}{F${fnMatch[1]}}`;
  const keyMap: Record<string, string> = {
    enter: "{ENTER}",
    escape: "{ESC}",
    esc: "{ESC}",
    tab: "{TAB}",
    space: " ",
    backspace: "{BACKSPACE}",
    delete: "{DELETE}",
    home: "{HOME}",
    end: "{END}",
    pageup: "{PGUP}",
    pagedown: "{PGDN}",
    up: "{UP}",
    down: "{DOWN}",
    left: "{LEFT}",
    right: "{RIGHT}",
  };
  const mapped = keyMap[key] || key;
  return `${prefix}${mapped}`;
}

// SendKeys treats ^%~+(){}[] as operators; escape every literal occurrence.
export function escapeSendKeysText(text: string): string {
  return (text || "").replace(/([+^%~(){}[\]])/g, "{$1}").replace(/\r?\n/g, "{ENTER}");
}

const CLI_BLOCKED_PATTERNS = [
  "rm -rf",
  "format ",
  "del /f",
  "del /s",
  "rd /s",
  "rmdir /s",
  "mkfs",
  ":(){ :|:& };:",
  "diskpart",
  "cipher /w",
  "reg delete hkey",
  "remove-item -recurse",
  "remove-item -force",
  "shutdown",
  "restart-computer",
  "stop-computer",
  "bcdedit",
  "vssadmin delete",
  "net user",
  "wmic useraccount",
  "reg delete",
  "taskkill /f /im wininit",
  "attrib -s -h",
];

export function isBlockedCommand(command: string): string | null {
  const cmd = (command || "").toLowerCase();
  for (const pattern of CLI_BLOCKED_PATTERNS) {
    if (cmd.includes(pattern)) return pattern;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared C# interop blocks (compiled once per PowerShell invocation).
// ---------------------------------------------------------------------------

const CS_AUDIO = `
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr n);
    int UnregisterControlChangeNotify(IntPtr n);
    int GetChannelCount(out uint c);
    int SetMasterVolumeLevel(float l, Guid g);
    int SetMasterVolumeLevelScalar(float l, Guid g);
    int GetMasterVolumeLevel(out float l);
    int GetMasterVolumeLevelScalar(out float l);
    int SetChannelVolumeLevel(uint c, float l, Guid g);
    int SetChannelVolumeLevelScalar(uint c, float l, Guid g);
    int GetChannelVolumeLevel(uint c, out float l);
    int GetChannelVolumeLevelScalar(uint c, out float l);
    int SetMute(bool m, Guid g);
    int GetMute(out bool m);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid iid, uint clsCtx, IntPtr p, out IAudioEndpointVolume o);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int d, int f, IntPtr p);
    int GetDefaultAudioEndpoint(int d, int r, out IMMDevice dev);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorCom {}
public static class Vol {
    static IAudioEndpointVolume Endpoint() {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
        IMMDevice dev;
        en.GetDefaultAudioEndpoint(0, 1, out dev);
        Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        IAudioEndpointVolume v;
        dev.Activate(ref iid, 23, IntPtr.Zero, out v);
        return v;
    }
    public static double GetVolume() {
        float l; Endpoint().GetMasterVolumeLevelScalar(out l);
        return Math.Round(l * 100.0);
    }
    public static double SetVolume(double pct) {
        float l = (float)Math.Max(0.0, Math.Min(100.0, pct)) / 100.0f;
        Endpoint().SetMasterVolumeLevelScalar(l, Guid.Empty);
        return GetVolume();
    }
    public static bool GetMute() {
        bool m; Endpoint().GetMute(out m); return m;
    }
    public static void SetMute(bool m) { Endpoint().SetMute(m, Guid.Empty); }
}`;

const CS_SYSTEM = `
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Sys {
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder t, int c);
    public static double IdleSeconds() {
        LASTINPUTINFO info = new LASTINPUTINFO();
        info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
        if (!GetLastInputInfo(ref info)) return -1;
        long now = (long)Environment.TickCount & 0xFFFFFFFFL;
        long last = (long)info.dwTime;
        if (last > now) return -1;
        return (now - last) / 1000.0;
    }
    public static string ForegroundTitle() {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "";
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(h, sb, 512);
        return sb.ToString();
    }
}`;

const CS_INPUT = `
using System;
using System.Runtime.InteropServices;
public static class UserInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    public const uint MOVE = 0x0001;
    public const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
    public const uint MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040, WHEEL = 0x0800;
    public const uint KEYUP = 0x0002;
    public static void MoveRelative(int dx, int dy) {
        mouse_event(MOVE, (uint)dx, (uint)dy, 0, UIntPtr.Zero);
    }
    public static void Click(uint downFlag, uint upFlag) {
        mouse_event(downFlag, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(30 + (int)(new Random().NextDouble() * 50));
        mouse_event(upFlag, 0, 0, 0, UIntPtr.Zero);
    }
    public static void Wheel(int notches) {
        mouse_event(WHEEL, 0, 0, (uint)(notches * -120), UIntPtr.Zero);
    }
    public static void MediaKey(byte vk) {
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(40);
        keybd_event(vk, 0, KEYUP, UIntPtr.Zero);
    }
}`;

const PS_BOOTSTRAP = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
CS_AUDIO
'@
Add-Type -TypeDefinition @'
CS_SYSTEM
'@
Add-Type -TypeDefinition @'
CS_INPUT
'@
`.replace("CS_AUDIO", CS_AUDIO).replace("CS_SYSTEM", CS_SYSTEM).replace("CS_INPUT", CS_INPUT);

function bootstrap(): string {
  return PS_BOOTSTRAP;
}

function parseJsonOutput<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new SystemBridgeError("EMPTY_RESPONSE", "The device bridge returned no data.", true);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // PowerShell may wrap output in progress/console noise — take the last line.
    const lastLine = trimmed.split(/\r?\n/).filter(Boolean).pop() || trimmed;
    try {
      return JSON.parse(lastLine) as T;
    } catch {
      throw new SystemBridgeError("BAD_RESPONSE", "Could not parse the device bridge response.", true);
    }
  }
}

// ---------------------------------------------------------------------------
// Volume & mute — real master audio endpoint control.
// ---------------------------------------------------------------------------

export type VolumeStatus = { volume: number; muted: boolean };

export async function getVolumeStatus(): Promise<VolumeStatus> {
  assertWindows("Volume control");
  const out = await runPowerShell(`${bootstrap()}\n[PSCustomObject]@{ volume = [Vol]::GetVolume(); muted = [Vol]::GetMute() } | ConvertTo-Json -Compress`, 10_000);
  const parsed = parseJsonOutput<{ volume: number; muted: boolean }>(out);
  return { volume: clampVolume(parsed.volume), muted: Boolean(parsed.muted) };
}

export async function setVolumeLevel(level: number): Promise<VolumeStatus> {
  assertWindows("Volume control");
  const target = clampVolume(level);
  const out = await runPowerShell(`${bootstrap()}\n[Vol]::SetVolume(${target}) | Out-Null; [PSCustomObject]@{ volume = [Vol]::GetVolume(); muted = [Vol]::GetMute() } | ConvertTo-Json -Compress`, 10_000);
  const parsed = parseJsonOutput<{ volume: number; muted: boolean }>(out);
  return { volume: clampVolume(parsed.volume), muted: Boolean(parsed.muted) };
}

export async function stepVolume(delta: number): Promise<VolumeStatus> {
  const current = await getVolumeStatus();
  return setVolumeLevel(current.volume + delta);
}

export async function setMuted(muted: boolean): Promise<VolumeStatus> {
  assertWindows("Mute control");
  const flag = muted ? "$true" : "$false";
  const out = await runPowerShell(`${bootstrap()}\n[Vol]::SetMute(${flag}); [PSCustomObject]@{ volume = [Vol]::GetVolume(); muted = [Vol]::GetMute() } | ConvertTo-Json -Compress`, 10_000);
  const parsed = parseJsonOutput<{ volume: number; muted: boolean }>(out);
  return { volume: clampVolume(parsed.volume), muted: Boolean(parsed.muted) };
}

// ---------------------------------------------------------------------------
// Media transport — hardware media keys reach YouTube/Spotify/etc. globally.
// ---------------------------------------------------------------------------

const MEDIA_VK: Record<MediaAction, number> = {
  play: 0xB3, // VK_MEDIA_PLAY_PAUSE
  pause: 0xB3,
  toggle: 0xB3,
  next: 0xB0, // VK_MEDIA_NEXT_TRACK
  previous: 0xB1, // VK_MEDIA_PREV_TRACK
  stop: 0xB2, // VK_MEDIA_STOP
};

export async function sendMediaKey(action: MediaAction): Promise<{ sent: MediaAction }> {
  assertWindows("Media key control");
  const vk = MEDIA_VK[action];
  await runPowerShell(`${bootstrap()}\n[UserInput]::MediaKey(${vk}) | Out-Null; Write-Output 'ok'`, 8_000);
  return { sent: action };
}

// ---------------------------------------------------------------------------
// Browser & app control.
// ---------------------------------------------------------------------------

export async function openUrlInDefaultBrowser(rawUrl: string): Promise<{ url: string; opened: true }> {
  assertWindows("Open in browser");
  let url = (rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SystemBridgeError("INVALID_URL", "Only http and https URLs can be opened.");
  }
  const cleanUrl = parsed.toString().replace(/'/g, "''");
  await runPowerShell(
    `try { Start-Process -FilePath '${cleanUrl}' -ErrorAction Stop } catch { Start-Process 'cmd.exe' -ArgumentList '/c', 'start', '""', '${cleanUrl}' }`,
    10_000,
  );
  return { url: parsed.toString(), opened: true };
}

export async function openNewBrowserTab(targetUrl?: string): Promise<{ url: string; opened: true }> {
  assertWindows("Open new browser tab");
  const trimmed = (targetUrl || "").trim();
  if (!trimmed || trimmed === "about:blank" || trimmed.toLowerCase() === "new tab") {
    await runPowerShell(
      `try { Start-Process 'cmd.exe' -ArgumentList '/c', 'start', '""', 'about:blank' } catch { Start-Process 'cmd.exe' -ArgumentList '/c', 'start', '""', 'chrome.exe' }`,
      10_000,
    );
    return { url: "about:blank", opened: true };
  }
  return await openUrlInDefaultBrowser(trimmed);
}

export type ShellCommandResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  ok: boolean;
};

export async function executeShellCommand(
  command: string,
  cwd?: string,
  timeoutMs = 30_000,
): Promise<ShellCommandResult> {
  assertWindows("Shell command execution");
  const cmd = (command || "").trim();
  if (!cmd) throw new SystemBridgeError("MISSING_COMMAND", "Specify a command to execute.");

  const blocked = isBlockedCommand(cmd);
  if (blocked) {
    throw new SystemBridgeError("BLOCKED", `Command blocked by security guardrails: forbidden pattern '${blocked}'.`);
  }

  const start = Date.now();
  const workDir = cwd && existsSync(cwd) ? cwd : process.cwd();

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: workDir,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      shell: "powershell.exe",
    });
    return {
      command: cmd,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
      durationMs: Date.now() - start,
      ok: true,
    };
  } catch (err: any) {
    return {
      command: cmd,
      stdout: (err.stdout || "").trim(),
      stderr: (err.stderr || err.message || "Command execution failed").trim(),
      exitCode: typeof err.code === "number" ? err.code : 1,
      durationMs: Date.now() - start,
      ok: false,
    };
  }
}

const APP_ALIASES: Record<string, string> = {
  notepad: "notepad.exe",
  calculator: "calc.exe",
  calc: "calc.exe",
  paint: "mspaint.exe",
  explorer: "explorer.exe",
  files: "explorer.exe",
  terminal: "wt.exe",
  cmd: "cmd.exe",
  powershell: "powershell.exe",
  edge: "msedge.exe",
  chrome: "chrome.exe",
  firefox: "firefox.exe",
  spotify: "spotify.exe",
  vscode: "code.exe",
  code: "code.exe",
  steam: "steam.exe",
  discord: "discord.exe",
  slack: "slack.exe",
  zoom: "zoom.exe",
  vlc: "vlc.exe",
  forza: "steam://rungameid/1551360",
  "forza 5": "steam://rungameid/1551360",
  "forza horizon 5": "steam://rungameid/1551360",
  taskmanager: "taskmgr.exe",
  taskmgr: "taskmgr.exe",
  controlpanel: "control.exe",
  settings: "ms-settings:",
  mail: "ms-mail:",
  word: "winword.exe",
  excel: "excel.exe",
  outlook: "outlook.exe",
};

export async function launchApplication(target: string): Promise<{ app: string }> {
  assertWindows("App launch");
  const key = (target || "").trim().toLowerCase();
  if (!key) throw new SystemBridgeError("MISSING_APP", "Specify an application to launch.");
  if (/[;&|`$]/.test(key)) {
    throw new SystemBridgeError("BLOCKED", "Application targets must be plain names or .exe paths.");
  }
  const alias = APP_ALIASES[key];
  if (alias) {
    await runPowerShell(`Start-Process -FilePath '${alias.replace(/'/g, "''")}'`, 10_000);
    return { app: key };
  }
  if (key.startsWith("steam:") || key.startsWith("spotify:") || key.startsWith("ms-") || key.startsWith("xbox:")) {
    await runPowerShell(`Start-Process -FilePath '${key.replace(/'/g, "''")}'`, 10_000);
    return { app: key };
  }
  if (path.isAbsolute(key) && /\.(exe|lnk|bat|cmd)$/i.test(key) && existsSync(key)) {
    await runPowerShell(`Start-Process -FilePath '${key.replace(/'/g, "''")}'`, 10_000);
    return { app: path.basename(key) };
  }

  // Dynamic launch attempt for any registered Windows executable or Start Menu app
  try {
    const cleanKey = key.replace(/'/g, "''");
    await runPowerShell(
      `try { Start-Process -FilePath '${cleanKey}' -ErrorAction Stop } catch { Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'start', '""', '${cleanKey}' -WindowStyle Hidden }`,
      10_000,
    );
    return { app: key };
  } catch {
    throw new SystemBridgeError("UNKNOWN_APP", `Could not launch "${target}". Verify the application or game is installed.`);
  }
}

export async function focusWindow(titleSubstring: string): Promise<{ focused: boolean }> {
  assertWindows("Window focus");
  const needle = (titleSubstring || "").trim().replace(/'/g, "''");
  if (!needle) throw new SystemBridgeError("MISSING_WINDOW", "Specify a window title to focus.");
  const out = await runPowerShell(
    `$shell = New-Object -ComObject WScript.Shell; if ($shell.AppActivate('${needle}')) { Write-Output 'focused' } else { Write-Output 'missed' }`,
    8_000,
  );
  return { focused: out.trim().endsWith("focused") };
}

export type DesktopWindowsResult = { windows: DesktopWindow[] };

export async function listDesktopWindows(limit = 25): Promise<DesktopWindow[]> {
  assertWindows("Window listing");
  const out = await runPowerShell(
    `Get-Process | Where-Object { $_.MainWindowTitle } | Sort-Object MainWindowTitle -Unique | Select-Object -First ${Math.min(Math.max(1, limit), 50)} @{ n = 'process'; e = { $_.ProcessName } }, @{ n = 'title'; e = { $_.MainWindowTitle } } | ConvertTo-Json -Compress`,
    12_000,
  );
  const parsed = parseJsonOutput<DesktopWindow | DesktopWindow[]>(out);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.filter((r) => r && r.title).map((r) => ({ process: String(r.process || ""), title: String(r.title || "") }));
}

// ---------------------------------------------------------------------------
// Screen capture.
// ---------------------------------------------------------------------------

export type ScreenshotResult = { name: string; path: string; url: string; bytes: number };

export async function takeScreenScreenshot(label?: string): Promise<ScreenshotResult> {
  assertWindows("Screen capture");
  const dir = ensureDir(screenshotDir());
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = (label || `shot_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`)
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60) || "shot";
  const fileName = `${base}.png`;
  const target = path.join(dir, fileName).replace(/'/g, "''");

  const script = `${bootstrap()}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
$graphics.Dispose()
$bmp.Save('${target}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output 'captured'`;

  await runPowerShell(script, 15_000);
  const st = statSync(path.join(dir, fileName));
  return { name: fileName, path: path.join(dir, fileName), url: `/api/system/artifacts/screenshots/${encodeURIComponent(fileName)}`, bytes: st.size };
}

// ---------------------------------------------------------------------------
// PDF vault — headless Chromium-family print-to-pdf (Edge ships with Windows).
// ---------------------------------------------------------------------------

function findChromiumBinary(): string | null {
  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe") : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export type PdfResult = { name: string; path: string; url: string; sourceUrl: string };

export async function savePageAsPdf(rawUrl: string, label?: string): Promise<PdfResult> {
  assertWindows("Page-to-PDF");
  const browser = findChromiumBinary();
  if (!browser) {
    throw new SystemBridgeError("NO_BROWSER", "No Edge or Chrome installation found for headless PDF rendering.");
  }
  let url = (rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SystemBridgeError("INVALID_URL", "Only http and https URLs can be rendered to PDF.");
  }

  const dir = ensureDir(pdfDir());
  const base = (label || `page_${Date.now()}`)
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60) || `page_${Date.now()}`;
  const fileName = `${base}.pdf`;
  const outPath = path.join(dir, fileName).replace(/'/g, "''");
  const profileDir = path.join(tmpdir(), `cc-pdf-profile-${Date.now()}`).replace(/'/g, "''");

  const command = `& '${browser.replace(/'/g, "''")}' --headless=new --disable-gpu --no-first-run --user-data-dir='${profileDir}' --print-to-pdf='${outPath}' --no-pdf-header-footer '${parsed.toString().replace(/'/g, "''")}' | Out-Null`;
  await runPowerShell(command, 70_000);

  const finalPath = path.join(dir, fileName);
  const deadline = Date.now() + 8_000;
  while (!existsSync(finalPath) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!existsSync(finalPath)) {
    throw new SystemBridgeError("PDF_FAILED", "Headless browser did not produce a PDF (page may have blocked rendering).", true);
  }
  return { name: fileName, path: finalPath, url: `/api/system/artifacts/pdf/${encodeURIComponent(fileName)}`, sourceUrl: parsed.toString() };
}

// ---------------------------------------------------------------------------
// Device snapshot — one round-trip for the identity card telemetry.
// ---------------------------------------------------------------------------

// Dashboard panels poll the snapshot every few seconds; a short TTL keeps the
// PowerShell fan-out reasonable without going stale on the identity card.
const SNAPSHOT_TTL_MS = 10_000;
let snapshotCache: { at: number; data: DeviceSnapshot } | null = null;

export async function getDeviceSnapshot(): Promise<DeviceSnapshot> {
  if (snapshotCache && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) {
    return snapshotCache.data;
  }
  const data = await readDeviceSnapshot();
  snapshotCache = { at: Date.now(), data };
  return data;
}

async function readDeviceSnapshot(): Promise<DeviceSnapshot> {
  if (!isWindows()) {
    return {
      platform: process.platform,
      hostReady: false,
      volume: 0,
      muted: false,
      idleSeconds: null,
      foregroundTitle: "",
      cpuLoad: null,
      memoryTotalGb: null,
      memoryFreeGb: null,
      batteryPercent: null,
      charging: null,
      uptimeHours: null,
      screenWidth: null,
      screenHeight: null,
      machine: process.platform,
    };
  }

  try {
    const out = await runPowerShell(`${bootstrap()}
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$os = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$batt = Get-CimInstance Win32_Battery | Select-Object -First 1
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
[PSCustomObject]@{
  volume = [Vol]::GetVolume()
  muted = [Vol]::GetMute()
  idleSeconds = [Sys]::IdleSeconds()
  foregroundTitle = [Sys]::ForegroundTitle()
  cpuLoad = $cpu
  memoryTotalGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
  memoryFreeGb = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
  batteryPercent = if ($batt) { [int]$batt.EstimateChargePercent } else { $null }
  charging = if ($batt) { ($batt.BatteryStatus -ge 2) } else { $null }
  uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
  screenWidth = $screen.Width
  screenHeight = $screen.Height
  machine = $env:COMPUTERNAME
} | ConvertTo-Json -Compress`, 18_000);

    const raw = parseJsonOutput<Record<string, unknown>>(out);
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      platform: "win32",
      hostReady: true,
      volume: clampVolume(Number(raw.volume ?? 0)),
      muted: Boolean(raw.muted),
      idleSeconds: num(raw.idleSeconds),
      foregroundTitle: String(raw.foregroundTitle ?? ""),
      cpuLoad: num(raw.cpuLoad),
      memoryTotalGb: num(raw.memoryTotalGb),
      memoryFreeGb: num(raw.memoryFreeGb),
      batteryPercent: num(raw.batteryPercent),
      charging: typeof raw.charging === "boolean" ? raw.charging : null,
      uptimeHours: num(raw.uptimeHours),
      screenWidth: num(raw.screenWidth),
      screenHeight: num(raw.screenHeight),
      machine: String(raw.machine ?? "PC"),
    };
  } catch {
    // Bridge hiccups must never take the dashboard down — degrade gracefully.
    return {
      platform: "win32",
      hostReady: false,
      volume: 0,
      muted: false,
      idleSeconds: null,
      foregroundTitle: "",
      cpuLoad: null,
      memoryTotalGb: null,
      memoryFreeGb: null,
      batteryPercent: null,
      charging: null,
      uptimeHours: null,
      screenWidth: null,
      screenHeight: null,
      machine: "PC",
    };
  }
}

// ---------------------------------------------------------------------------
// Real mouse / keyboard — the agent borrows the user's devices when free.
// Coordinates arrive normalized 0-1000 (engine space) and are mapped to the
// actual primary-screen pixel grid.
// ---------------------------------------------------------------------------

export type RealInputGateResult =
  | { granted: true }
  | { granted: false; reason: string };

export async function gateRealInput(mode: InputMode, idleThresholdSeconds = DEFAULT_IDLE_THRESHOLD_SECONDS): Promise<RealInputGateResult> {
  if (mode === "takeover") return { granted: true };
  const idle = await getUserIdleSeconds();
  const permission = resolveInputPermission(mode, idle, idleThresholdSeconds);
  return permission.allowed ? { granted: true } : { granted: false, reason: permission.reason };
}

export async function getUserIdleSeconds(): Promise<number | null> {
  assertWindows("Idle detection");
  // Cast to int inside PowerShell so decimal-separator locales can't break the parse.
  const out = await runPowerShell(`${bootstrap()}\n[Sys]::IdleSeconds() | ForEach-Object { [math]::Floor([math]::Max(0, $_)) }`, 8_000);
  const value = Number(out.trim().split(/\r?\n/).filter(Boolean).pop());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function requireScreenSize(): Promise<{ width: number; height: number }> {
  const out = await runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms | Out-Null; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; Write-Output ('' + $b.Width + 'x' + $b.Height)`,
    8_000,
  );
  const match = out.trim().match(/(\d+)x(\d+)/);
  if (!match) throw new SystemBridgeError("SCREEN_UNKNOWN", "Could not determine the screen resolution.", true);
  return { width: Number(match[1]), height: Number(match[2]) };
}

export type RealInputResult = {
  performed: string;
  granted: true;
  screen: { width: number; height: number };
};

async function performRealInput(
  mode: InputMode,
  actionScript: (coords: { width: number; height: number }) => string,
  idleThresholdSeconds = DEFAULT_IDLE_THRESHOLD_SECONDS,
  performedLabel = "real-input",
): Promise<RealInputResult> {
  assertWindows("Real input control");
  const gate = await gateRealInput(mode, idleThresholdSeconds);
  if (!gate.granted) {
    throw new SystemBridgeError("INPUT_BUSY", gate.reason, false);
  }
  const screen = await requireScreenSize();
  await runPowerShell(`${bootstrap()}\n${actionScript(screen)}`, 12_000);
  return { performed: performedLabel, granted: true, screen };
}

export async function realMouseMove(mode: InputMode, xNorm: number, yNorm: number): Promise<RealInputResult> {
  return performRealInput(
    mode,
    (screen) => {
      const x = clampNorm(xNorm) / 1000 * (screen.width - 1);
      const y = clampNorm(yNorm) / 1000 * (screen.height - 1);
      return `[UserInput]::SetCursorPos([int]${Math.round(x)}, [int]${Math.round(y)}) | Out-Null`;
    },
    mode === "takeover" ? 0 : DEFAULT_IDLE_THRESHOLD_SECONDS,
    "mouse-move",
  );
}

export async function realMouseMoveRelative(
  mode: InputMode,
  dx: number,
  dy: number,
): Promise<{ moved: true; dx: number; dy: number }> {
  assertWindows("Relative mouse move");
  const clampedX = Math.max(-500, Math.min(500, Math.round(dx)));
  const clampedY = Math.max(-500, Math.min(500, Math.round(dy)));
  await runPowerShell(`${bootstrap()}\n[UserInput]::MoveRelative(${clampedX}, ${clampedY})`, 5_000);
  return { moved: true, dx: clampedX, dy: clampedY };
}

export async function realMouseClick(
  mode: InputMode,
  xNorm?: number,
  yNorm?: number,
  button: "left" | "right" | "middle" = "left",
  opts?: { double?: boolean },
): Promise<RealInputResult> {
  return performRealInput(
    mode,
    (screen) => {
      const move =
        xNorm !== undefined && yNorm !== undefined
          ? `[UserInput]::SetCursorPos([int]${Math.round((clampNorm(xNorm) / 1000) * (screen.width - 1))}, [int]${Math.round((clampNorm(yNorm) / 1000) * (screen.height - 1))}) | Out-Null; Start-Sleep -Milliseconds 60`
          : "";
      const flags = button === "right" ? "[UserInput]::Click([UserInput]::RIGHTDOWN, [UserInput]::RIGHTUP)" : button === "middle" ? "[UserInput]::Click([UserInput]::MIDDLEDOWN, [UserInput]::MIDDLEUP)" : "[UserInput]::Click([UserInput]::LEFTDOWN, [UserInput]::LEFTUP)";
      return `${move}${flags}${opts?.double ? `; Start-Sleep -Milliseconds 90; ${flags}` : ""}`;
    },
    mode === "takeover" ? 0 : DEFAULT_IDLE_THRESHOLD_SECONDS,
    `${button}-click`,
  );
}

export async function realMouseScroll(mode: InputMode, dyNorm: number): Promise<RealInputResult> {
  const notches = Math.max(-12, Math.min(12, Math.round(dyNorm / 120)));
  return performRealInput(
    mode,
    () => `[UserInput]::Wheel(${notches})`,
    mode === "takeover" ? 0 : DEFAULT_IDLE_THRESHOLD_SECONDS,
    "scroll",
  );
}

export async function realTypeText(mode: InputMode, text: string): Promise<RealInputResult> {
  const capped = (text || "").slice(0, 400);
  if (!capped) throw new SystemBridgeError("MISSING_TEXT", "Text to type is required.");
  const escaped = escapeSendKeysText(capped).replace(/'/g, "''");
  return performRealInput(
    mode,
    () => `Add-Type -AssemblyName System.Windows.Forms | Out-Null; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`,
    mode === "takeover" ? 0 : DEFAULT_IDLE_THRESHOLD_SECONDS,
    "type-text",
  );
}

export async function realPressHotkey(mode: InputMode, combo: string): Promise<RealInputResult> {
  const validated = validateHotkey(combo);
  if (!validated.ok) {
    throw new SystemBridgeError("HOTKEY_BLOCKED", validated.reason);
  }
  const escaped = validated.sendKeys.replace(/'/g, "''");
  return performRealInput(
    mode,
    () => `Add-Type -AssemblyName System.Windows.Forms | Out-Null; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`,
    mode === "takeover" ? 0 : DEFAULT_IDLE_THRESHOLD_SECONDS,
    `hotkey-${combo}`,
  );
}

function clampNorm(value: number): number {
  return Math.max(0, Math.min(1000, Math.round(value)));
}

// Rate limiter shared by mission loops so real-input bursts stay human-paced.
let lastRealInputAt = 0;
const MIN_REAL_INPUT_GAP_MS = 250;

export async function respectHumanPace(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, MIN_REAL_INPUT_GAP_MS - (now - lastRealInputAt));
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  lastRealInputAt = Date.now();
}
