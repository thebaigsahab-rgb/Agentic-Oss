import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { npmCommand, resolveDataDirectory } from "./paths.mjs";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22) {
  console.error(
    `Control Center needs Node.js 22 or newer. You have ${process.versions.node}.`,
  );
  console.error(
    "Install the current Node.js LTS release, then run npm run setup again.",
  );
  process.exit(1);
}

const environmentPath = path.join(process.cwd(), ".env.local");
if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

const npm = npmCommand();
const runNpm = (arguments_, stdio = "inherit") =>
  spawnSync(npm.command, [...npm.prefix, ...arguments_], {
    cwd: process.cwd(),
    stdio,
  });

const lockPath = path.join(process.cwd(), "package-lock.json");
const stampPath = path.join(
  process.cwd(),
  "node_modules",
  ".control-center-lock-hash",
);
const lockHash = existsSync(lockPath)
  ? createHash("sha256")
      .update(await readFile(lockPath))
      .digest("hex")
  : "unlocked";
const installedHash = existsSync(stampPath)
  ? (await readFile(stampPath, "utf8")).trim()
  : "";
const dependencyCheck =
  existsSync(path.join(process.cwd(), "node_modules")) &&
  installedHash === lockHash
    ? runNpm(["ls", "--depth=0"], "ignore")
    : { status: 1 };
if (dependencyCheck.status !== 0 || installedHash !== lockHash) {
  console.log("Installing the locked local dependencies…");
  const result = runNpm([existsSync(lockPath) ? "ci" : "install"]);
  if (result.status !== 0) process.exit(result.status ?? 1);
  await writeFile(stampPath, `${lockHash}\n`);
}

let dataDirectory;
try {
  dataDirectory = resolveDataDirectory();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "The local data directory is invalid.",
  );
  console.error(
    "Use an absolute path in .env.local, or leave CONTROL_CENTER_DATA_DIR empty.",
  );
  process.exit(1);
}
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
await chmod(dataDirectory, 0o700).catch(() => undefined);

console.log("\nControl Center is ready.");
console.log(`Local data: ${dataDirectory}`);
console.log("Run npm run launch to build, start, and open the dashboard.\n");
