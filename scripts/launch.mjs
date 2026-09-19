import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  loadLocalEnvironment,
  npmCommand,
  resolveDataDirectory,
} from "./paths.mjs";

const cwd = process.cwd();
loadLocalEnvironment(cwd);
const args = new Set(process.argv.slice(2));
const noOpen = args.has("--no-open") || process.env.CI === "true";
const forceBuild = args.has("--rebuild");
const portArgument = process.argv.find((value) => value.startsWith("--port="));
const port = Number(portArgument?.split("=")[1] || process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(
    "Use a valid TCP port, for example: npm run launch -- --port=3001",
  );
  process.exit(1);
}

let child;
let forceStopTimer;
let stopping = false;
let shutdownRequested = false;
function stopChild(signal = "SIGTERM") {
  shutdownRequested = true;
  if (!child || stopping) return;
  stopping = true;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
    forceStopTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }, 5_000);
    forceStopTimer.unref();
  }
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => stopChild(signal));
process.on("message", (message) => {
  if (message?.type === "shutdown") stopChild();
});

const npm = npmCommand();
const runNpm = (arguments_) =>
  spawnSync(npm.command, [...npm.prefix, ...arguments_], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
const setup = runNpm(["run", "setup"]);
if (setup.status !== 0) process.exit(setup.status ?? 1);

const dataDirectory = resolveDataDirectory(cwd);
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
process.env.CONTROL_CENTER_DATA_DIR = dataDirectory;
process.env.PORT = String(port);
const url = `http://127.0.0.1:${port}`;

async function isControlCenterRunning() {
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(1_500),
      cache: "no-store",
    });
    const payload = await response.json();
    return response.ok && payload.service === "control-center";
  } catch {
    return false;
  }
}

function openBrowser() {
  if (noOpen) return;
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const commandArgs =
    process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const opener = spawn(command, commandArgs, {
    detached: true,
    stdio: "ignore",
  });
  opener.on("error", () => {
    console.log(`Open ${url} in your browser.`);
  });
  opener.unref();
}

if (await isControlCenterRunning()) {
  console.log(`Control Center is already running at ${url}`);
  openBrowser();
  process.exit(0);
}

async function newestSourceMtime(directory) {
  if (!existsSync(directory)) return 0;
  const directoryStat = await stat(directory);
  if (!directoryStat.isDirectory()) return directoryStat.mtimeMs;
  let newest = directoryStat.mtimeMs;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory()
        ? await newestSourceMtime(entryPath)
        : (await stat(entryPath)).mtimeMs,
    );
  }
  return newest;
}

const buildIdPath = path.join(cwd, ".next", "BUILD_ID");
let needsBuild = forceBuild || !existsSync(buildIdPath);
if (!needsBuild) {
  const buildMtime = (await stat(buildIdPath)).mtimeMs;
  const sourcePaths = [
    "app",
    "components",
    "lib",
    "instrumentation.ts",
    "proxy.ts",
    "next.config.ts",
    "package.json",
    "package-lock.json",
  ];
  for (const sourcePath of sourcePaths) {
    if ((await newestSourceMtime(path.join(cwd, sourcePath))) > buildMtime) {
      needsBuild = true;
      break;
    }
  }
}
if (needsBuild) {
  console.log("Building the local dashboard…");
  const build = runNpm(["run", "build"]);
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const lockPath = path.join(dataDirectory, "launcher.lock");
let lockHandle;
try {
  lockHandle = await open(lockPath, "wx", 0o600);
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  let stale = true;
  try {
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    if (Number.isInteger(lock.pid)) {
      process.kill(lock.pid, 0);
      stale = false;
    }
  } catch {
    stale = true;
  }
  if (!stale) {
    console.error(
      "Another Control Center process is already starting. Try again in a few seconds.",
    );
    process.exit(1);
  }
  await rm(lockPath, { force: true });
  lockHandle = await open(lockPath, "wx", 0o600);
}
await lockHandle.writeFile(
  `${JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() })}\n`,
);
await lockHandle.close();

let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  await rm(lockPath, { force: true }).catch(() => undefined);
}

const nextCli = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
child = spawn(
  process.execPath,
  [nextCli, "start", "--hostname", "0.0.0.0", "--port", String(port)],
  {
    cwd,
    env: process.env,
    stdio: "inherit",
  },
);
const childExit = new Promise((resolve) =>
  child.once("exit", (code, signal) => {
    clearTimeout(forceStopTimer);
    resolve({ code, signal });
  }),
);
if (shutdownRequested) stopChild();
const deadline = Date.now() + 30_000;
while (!(await isControlCenterRunning())) {
  const result = await Promise.race([
    childExit,
    new Promise((resolve) => setTimeout(() => resolve(null), 250)),
  ]);
  if (result) {
    await cleanup();
    console.error(
      "Control Center stopped before it became ready. The server output above contains the fix.",
    );
    process.exit(result.code ?? 1);
  }
  if (Date.now() > deadline) {
    stopChild();
    await childExit;
    await cleanup();
    console.error(
      `Control Center did not become ready at ${url} within 30 seconds.`,
    );
    process.exit(1);
  }
}

console.log(`\nControl Center is ready at ${url}`);
console.log(`Local data: ${dataDirectory}`);
console.log("Keep this window open. Press Ctrl+C to stop.\n");
openBrowser();

const result = await childExit;
await cleanup();
process.exit(result.code ?? (result.signal ? 0 : 1));
