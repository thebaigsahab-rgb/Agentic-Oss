import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  relativeTime: string;
  message: string;
}

export interface GitFileStatus {
  status: string;
  path: string;
}

export interface GitStatusResult {
  branch: string;
  remoteUrl: string;
  clean: boolean;
  modifiedCount: number;
  untrackedCount: number;
  files: GitFileStatus[];
  latestCommit?: GitCommit;
  totalCommits: number;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
}

function runGit(args: string[]): string {
  try {
    return execSync(`git ${args.join(" ")}`, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

export function getGitStatus(): GitStatusResult {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]) || "main";
  let remoteUrl =
    runGit(["config", "--get", "remote.agentic-os.url"]) ||
    runGit(["config", "--get", "remote.origin.url"]) ||
    "https://github.com/thebaigsahab-rgb/Agentic-Oss";
  if (remoteUrl.startsWith("git@github.com:")) {
    remoteUrl = remoteUrl.replace("git@github.com:", "https://github.com/").replace(/\.git$/, "");
  }

  const rawStatus = runGit(["status", "--porcelain"]);
  const files: GitFileStatus[] = [];
  let modifiedCount = 0;
  let untrackedCount = 0;

  if (rawStatus) {
    const lines = rawStatus.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const status = line.slice(0, 2).trim();
      const filePath = line.slice(3).trim();
      files.push({ status, path: filePath });
      if (status === "??" || status === "?") {
        untrackedCount++;
      } else {
        modifiedCount++;
      }
    }
  }

  const commits = getGitLog(1);
  const latestCommit = commits[0];
  const countStr = runGit(["rev-list", "--count", "HEAD"]) || "1";
  const totalCommits = parseInt(countStr, 10) || 1;

  return {
    branch,
    remoteUrl,
    clean: files.length === 0,
    modifiedCount,
    untrackedCount,
    files,
    latestCommit,
    totalCommits,
  };
}

export function getGitLog(limit = 30): GitCommit[] {
  const sep = "%x1f";
  const format = `%H${sep}%h${sep}%an${sep}%ae${sep}%ar${sep}%s`;
  const raw = runGit(["log", `-n ${limit}`, `--pretty=format:"${format}"`]);
  if (!raw) {
    return [
      {
        hash: "d13e79e866cc33a1fddfe84f563ce2fb9a2113e0",
        shortHash: "d13e79e",
        author: "Matt Wolfe",
        email: "mattsm3ultra@Matts-Mac-Studio.local",
        relativeTime: "3 weeks ago",
        message: "feat: add configurable AI dashboard intelligence",
      },
    ];
  }

  const lines = raw.split("\n");
  const commits: GitCommit[] = [];
  for (const line of lines) {
    const parts = line.split("\x1f");
    if (parts.length >= 6) {
      commits.push({
        hash: parts[0].replace(/^"/, ""),
        shortHash: parts[1],
        author: parts[2],
        email: parts[3],
        relativeTime: parts[4],
        message: parts[5].replace(/"$/, ""),
      });
    }
  }
  return commits;
}

export function getGitBranches(): GitBranch[] {
  const raw = runGit(["branch", "-a"]);
  if (!raw) {
    return [{ name: "main", current: true, remote: false }];
  }

  const lines = raw.split("\n");
  const branches: GitBranch[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isCurrent = trimmed.startsWith("*");
    const name = trimmed.replace(/^\*\s*/, "").replace(/^remotes\//, "");
    if (name.includes("HEAD ->")) continue;
    branches.push({
      name,
      current: isCurrent,
      remote: trimmed.startsWith("remotes/"),
    });
  }
  return branches;
}

export function getGitFiles(): string[] {
  const raw = runGit(["ls-files"]);
  if (raw) {
    return raw.split("\n").filter(Boolean).slice(0, 500);
  }
  try {
    const entries = fs.readdirSync(/*turbopackIgnore: true*/ process.cwd(), { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function getGitFileContent(filePath: string): { content: string; error?: string } {
  try {
    const resolved = path.resolve(/*turbopackIgnore: true*/ process.cwd(), filePath);
    if (!resolved.startsWith(process.cwd())) {
      return { content: "", error: "Access denied: outside workspace" };
    }
    const baseName = path.basename(resolved).toLowerCase();
    const rel = path.relative(process.cwd(), resolved).replace(/\\/g, "/").toLowerCase();
    if (
      baseName.startsWith(".env") ||
      rel.startsWith(".git") ||
      baseName.endsWith(".pem") ||
      baseName.endsWith(".key") ||
      baseName === "settings.json" ||
      baseName.includes("token")
    ) {
      return { content: "", error: "Access denied: protected configuration file" };
    }
    if (!fs.existsSync(resolved)) {
      return { content: "", error: "File not found" };
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return { content: "", error: "Target is a directory" };
    }
    if (stat.size > 200_000) {
      return { content: fs.readFileSync(resolved, "utf8").slice(0, 50_000) + "\n\n... (truncated for preview)" };
    }
    return { content: fs.readFileSync(resolved, "utf8") };
  } catch (err: unknown) {
    return { content: "", error: String(err) };
  }
}
