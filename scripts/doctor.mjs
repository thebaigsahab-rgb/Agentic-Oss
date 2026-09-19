import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadLocalEnvironment, resolveDataDirectory } from "./paths.mjs";

loadLocalEnvironment();
const dataDirectory = resolveDataDirectory();
const settingsPath = path.join(dataDirectory, "settings.json");
const databasePath = path.join(dataDirectory, "control-center.sqlite");
const audienceSnapshotsPath = path.join(dataDirectory, "snapshots.json");
let healthy = true;

function assertAudienceSample(sample) {
  if (
    !sample ||
    typeof sample !== "object" ||
    Array.isArray(sample) ||
    typeof sample.total !== "number" ||
    !Number.isFinite(sample.total) ||
    sample.total < 0 ||
    typeof sample.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(sample.checkedAt)) ||
    (sample.primaryLabel !== undefined &&
      !["followers", "subscribers", "page likes"].includes(sample.primaryLabel)) ||
    (sample.secondaryValue !== undefined &&
      (typeof sample.secondaryValue !== "number" ||
        !Number.isFinite(sample.secondaryValue) ||
        sample.secondaryValue < 0)) ||
    (sample.handle !== undefined && typeof sample.handle !== "string") ||
    (sample.secondaryLabel !== undefined &&
      typeof sample.secondaryLabel !== "string") ||
    (sample.source !== undefined && typeof sample.source !== "string")
  ) throw new Error("snapshot history contains an invalid entry");
}

function assertAudienceHistory(snapshots) {
  if (!snapshots || typeof snapshots !== "object" || Array.isArray(snapshots))
    throw new Error("snapshot history must be an object");
  if ("version" in snapshots) {
    if (
      snapshots.version !== 2 ||
      !snapshots.accounts ||
      typeof snapshots.accounts !== "object" ||
      Array.isArray(snapshots.accounts)
    ) throw new Error("snapshot history has an unsupported version");
    for (const history of Object.values(snapshots.accounts)) {
      if (
        !history ||
        typeof history !== "object" ||
        Array.isArray(history) ||
        typeof history.fingerprint !== "string" ||
        !Array.isArray(history.samples) ||
        history.samples.length === 0
      ) throw new Error("snapshot history contains an invalid account");
      assertAudienceSample(history.latest);
      history.samples.forEach(assertAudienceSample);
    }
    return { count: Object.keys(snapshots.accounts).length, version: "v2" };
  }
  for (const snapshot of Object.values(snapshots)) {
    assertAudienceSample(snapshot);
    const hasPreviousTotal = snapshot.previousTotal !== undefined;
    const hasPreviousDate = snapshot.previousCheckedAt !== undefined;
    if (
      hasPreviousTotal !== hasPreviousDate ||
      (hasPreviousTotal &&
        (typeof snapshot.previousTotal !== "number" ||
          !Number.isFinite(snapshot.previousTotal) ||
          snapshot.previousTotal < 0 ||
          typeof snapshot.previousCheckedAt !== "string" ||
          !Number.isFinite(Date.parse(snapshot.previousCheckedAt))))
    ) throw new Error("snapshot history contains an invalid legacy comparison");
  }
  return { count: Object.keys(snapshots).length, version: "legacy" };
}

console.log(`Node.js: ${process.versions.node}`);
console.log(`Platform: ${process.platform} ${process.arch}`);
console.log(`Local data: ${dataDirectory}`);
console.log(
  `Production build: ${existsSync(path.join(process.cwd(), ".next", "BUILD_ID")) ? "ready" : "not built yet (npm run launch will build it)"}`,
);

if (existsSync(settingsPath)) {
  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    console.log(
      `Settings: readable (${settings.industry?.sources?.length || 0} industry sources, ${settings.audience?.accounts?.length || 0} audience accounts)`,
    );
    const aiProvider = ["openai", "anthropic", "gemini", "xai", "groq", "nvidia", "lmstudio", "ollama"].includes(settings.ai?.provider)
      ? settings.ai.provider
      : "none";
    const environmentKey = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      xai: process.env.XAI_API_KEY,
      groq: process.env.GROQ_API_KEY || process.env.GROK_API_KEY,
      nvidia: process.env.NVIDIA_API_KEY,
      lmstudio: process.env.LM_STUDIO_API_KEY || process.env.LM_API_TOKEN,
      ollama: process.env.OLLAMA_LOCAL_API_KEY,
    }[aiProvider] || "";
    const storedKey = aiProvider === "none" ? "" : settings.ai?.apiKeys?.[aiProvider];
    const localAi = aiProvider === "lmstudio" || aiProvider === "ollama";
    console.log(
      aiProvider === "none"
        ? "AI curation: off (local ranking remains available)"
        : localAi
          ? `AI curation: ${aiProvider} selected (local server; key optional; loaded model checked when processing)`
          : `AI curation: ${aiProvider} selected (${storedKey || environmentKey ? "key available" : "key missing"})`,
    );
  } catch (error) {
    healthy = false;
    console.error(
      `Settings: invalid JSON (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }
} else {
  console.log("Settings: first run (no settings file yet)");
}

if (existsSync(audienceSnapshotsPath)) {
  try {
    const snapshots = JSON.parse(await readFile(audienceSnapshotsPath, "utf8"));
    const history = assertAudienceHistory(snapshots);
    console.log(
      `Audience history: readable (${history.count} accounts, ${history.version})`,
    );
  } catch (error) {
    healthy = false;
    console.error(
      `Audience history: could not be read safely (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }
} else {
  console.log("Audience history: first run (no snapshots yet)");
}

if (existsSync(databasePath)) {
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const result = database.prepare("PRAGMA quick_check").get();
    const status = String(result?.quick_check || "unknown");
    console.log(`Database: ${status}`);
    healthy = healthy && status === "ok";

    const workspaceTable = database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'workspace_state'")
      .get();
    if (workspaceTable) {
      try {
        const rows = database
          .prepare("SELECT state_key, payload_json FROM workspace_state WHERE state_key IN ('reminders', 'tasks')")
          .all();
        if (rows.length === 1)
          throw new Error("one of the two workspace rows is missing");
        for (const row of rows) {
          let payload;
          try {
            payload = JSON.parse(row.payload_json);
          } catch {
            throw new Error(`${row.state_key} contains invalid JSON`);
          }
          if (!Array.isArray(payload))
            throw new Error(`${row.state_key} is not stored as a list`);
        }
        console.log(
          rows.length === 0
            ? "Workspace: first run"
            : "Workspace: reminders and tasks are readable",
        );
      } catch (error) {
        healthy = false;
        console.error(
          `Workspace: could not be read safely (${error instanceof Error ? error.message : "unknown error"})`,
        );
      }
    }
  } catch (error) {
    healthy = false;
    console.error(
      `Database: could not be checked (${error instanceof Error ? error.message : "unknown error"})`,
    );
  } finally {
    database?.close();
  }
} else {
  console.log("Database: first run (no database yet)");
}

console.log(
  healthy ? "\nDoctor result: ready" : "\nDoctor result: needs attention",
);
process.exit(healthy ? 0 : 1);
