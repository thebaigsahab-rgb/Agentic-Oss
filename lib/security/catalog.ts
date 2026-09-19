import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { Role } from "./session";

export interface ArgumentDefinition {
  type: "string" | "number" | "boolean" | "enum";
  required?: boolean;
  allowedValues?: string[];
  pattern?: RegExp;
  min?: number;
  max?: number;
  description?: string;
}

export interface CatalogRoutine {
  id: string;
  name: string;
  description: string;
  executable: string;
  requiredRole: Role;
  requiresHitl: boolean;
  argsSchema: Record<string, ArgumentDefinition>;
  buildArgs: (params: Record<string, unknown>) => string[];
}

export interface JobExecutionResult {
  commandId: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed?: boolean;
  error?: string;
}

// Track active subprocesses for panic circuit-breaker cleanup
const activeSubprocesses = new Set<ChildProcess>();

export function getActiveProcessCount(): number {
  return activeSubprocesses.size;
}

export function terminateAllSubprocesses(): number {
  let terminated = 0;
  for (const proc of activeSubprocesses) {
    try {
      if (!proc.killed) {
        proc.kill("SIGKILL");
        terminated++;
      }
    } catch {}
  }
  activeSubprocesses.clear();
  return terminated;
}

/**
 * Shell metacharacters regex.
 * Rejects any subshell, command chaining, pipe, or redirection attempt.
 */
export const SHELL_METACHARS_REGEX = /[;&|`$><(){}\[\]\r\n\0\\]/;

export function containsShellMetacharacters(input: string): boolean {
  return SHELL_METACHARS_REGEX.test(input);
}

/**
 * Validates a single parameter value against its schema definition.
 */
export function validateArgument(
  name: string,
  value: unknown,
  def: ArgumentDefinition
): { valid: boolean; error?: string; parsedValue?: unknown } {
  if (value === undefined || value === null) {
    if (def.required) {
      return { valid: false, error: `Missing required argument: '${name}'.` };
    }
    return { valid: true, parsedValue: undefined };
  }

  if (def.type === "number") {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return { valid: false, error: `Argument '${name}' must be a finite number.` };
    }
    if (def.min !== undefined && num < def.min) {
      return { valid: false, error: `Argument '${name}' must be at least ${def.min}.` };
    }
    if (def.max !== undefined && num > def.max) {
      return { valid: false, error: `Argument '${name}' must be at most ${def.max}.` };
    }
    return { valid: true, parsedValue: num };
  }

  if (def.type === "boolean") {
    return { valid: true, parsedValue: Boolean(value) };
  }

  if (def.type === "enum") {
    const strVal = String(value);
    if (containsShellMetacharacters(strVal)) {
      return { valid: false, error: `Argument '${name}' contains forbidden shell metacharacters.` };
    }
    if (!def.allowedValues || !def.allowedValues.includes(strVal)) {
      return {
        valid: false,
        error: `Argument '${name}' must be one of: ${def.allowedValues?.join(", ")}.`,
      };
    }
    return { valid: true, parsedValue: strVal };
  }

  if (def.type === "string") {
    const str = String(value);
    if (containsShellMetacharacters(str)) {
      return { valid: false, error: `Argument '${name}' contains forbidden shell metacharacters.` };
    }
    if (def.pattern && !def.pattern.test(str)) {
      return { valid: false, error: `Argument '${name}' failed pattern validation.` };
    }
    if (def.min !== undefined && str.length < def.min) {
      return { valid: false, error: `Argument '${name}' must be at least ${def.min} characters.` };
    }
    if (def.max !== undefined && str.length > def.max) {
      return { valid: false, error: `Argument '${name}' must be at most ${def.max} characters.` };
    }
    return { valid: true, parsedValue: str };
  }

  return { valid: false, error: `Unsupported argument type for '${name}'.` };
}

/**
 * Predefined Allowlisted Command Catalog.
 * No arbitrary dynamic shell string interpolation is permitted.
 */
export const COMMAND_CATALOG: Record<string, CatalogRoutine> = {
  git_status: {
    id: "git_status",
    name: "Git Status",
    description: "Queries the local git repository status in porcelain format.",
    executable: "git",
    requiredRole: "routine-only",
    requiresHitl: false,
    argsSchema: {
      submodule: { type: "boolean", required: false },
    },
    buildArgs: (params) => {
      const args = ["status", "--porcelain=v1"];
      if (params.submodule) args.push("--ignore-submodules=none");
      return args;
    },
  },

  git_log: {
    id: "git_log",
    name: "Git Log",
    description: "Reads recent commit messages.",
    executable: "git",
    requiredRole: "routine-only",
    requiresHitl: false,
    argsSchema: {
      count: { type: "number", required: false, min: 1, max: 20 },
    },
    buildArgs: (params) => {
      const count = Math.min(20, Math.max(1, Number(params.count) || 5));
      return ["log", "-n", String(count), "--oneline"];
    },
  },

  system_ping: {
    id: "system_ping",
    name: "Network Connectivity Diagnostics",
    description: "Sends ICMP echo requests to a verified hostname or IP address.",
    executable: process.platform === "win32" ? "ping.exe" : "ping",
    requiredRole: "routine-only",
    requiresHitl: false,
    argsSchema: {
      target: {
        type: "string",
        required: true,
        pattern: /^[a-zA-Z0-9.-]{1,64}$/,
        min: 1,
        max: 64,
        description: "Alphanumeric host or IPv4 address only.",
      },
      count: {
        type: "number",
        required: false,
        min: 1,
        max: 4,
      },
    },
    buildArgs: (params) => {
      const target = String(params.target);
      const count = Math.min(4, Math.max(1, Number(params.count) || 2));
      return process.platform === "win32"
        ? ["-n", String(count), target]
        : ["-c", String(count), target];
    },
  },

  open_desktop_tool: {
    id: "open_desktop_tool",
    name: "Open Desktop Productivity Tool",
    description: "Launches an allowlisted local desktop tool.",
    executable: process.platform === "win32" ? "cmd.exe" : "true",
    requiredRole: "admin",
    requiresHitl: true,
    argsSchema: {
      tool: {
        type: "enum",
        required: true,
        allowedValues: ["calc", "notepad", "mspaint", "explorer"],
      },
    },
    buildArgs: (params) => {
      const toolMap: Record<string, string> = {
        calc: "calc.exe",
        notepad: "notepad.exe",
        mspaint: "mspaint.exe",
        explorer: "explorer.exe",
      };
      const toolExe = toolMap[String(params.tool)] || "calc.exe";
      return ["/c", "start", '""', toolExe];
    },
  },
};

/**
 * Returns a catalog routine by ID.
 */
export function getCatalogRoutine(commandId: string): CatalogRoutine | null {
  return COMMAND_CATALOG[commandId] || null;
}

/**
 * Sanitized Environment: Strips API keys, passwords, and sensitive app state.
 */
export function createSanitizedEnvironment(): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV || "production",
    PATH: process.env.PATH || "",
    SYSTEMROOT: process.env.SYSTEMROOT || "C:\\Windows",
    SystemRoot: process.env.SystemRoot || "C:\\Windows",
    TEMP: process.env.TEMP || "C:\\Windows\\Temp",
    TMP: process.env.TMP || "C:\\Windows\\Temp",
    COMSPEC: process.env.COMSPEC || "C:\\Windows\\system32\\cmd.exe",
    PATHEXT: process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WS;.MSC",
  };
  return safeEnv;
}

/**
 * Isolated Sandboxed Job Runner.
 * Executes strictly via spawn with static array arguments and sanitized environment.
 */
export async function runCatalogJob(
  commandId: string,
  rawParams: Record<string, unknown> = {},
  options: { timeoutMs?: number; cwd?: string } = {}
): Promise<JobExecutionResult> {
  const routine = getCatalogRoutine(commandId);
  if (!routine) {
    throw new Error(`Command '${commandId}' is not registered in the allowlisted catalog.`);
  }

  // Strict schema validation for all parameters
  const validatedParams: Record<string, unknown> = {};
  for (const [argName, argDef] of Object.entries(routine.argsSchema)) {
    const valResult = validateArgument(argName, rawParams[argName], argDef);
    if (!valResult.valid) {
      throw new Error(`Catalog argument validation error: ${valResult.error}`);
    }
    if (valResult.parsedValue !== undefined) {
      validatedParams[argName] = valResult.parsedValue;
    }
  }

  // Construct static argument array (zero shell string interpolation)
  const args = routine.buildArgs(validatedParams);

  // Deep check: Ensure no argument contains shell metacharacters
  for (const arg of args) {
    if (containsShellMetacharacters(arg)) {
      throw new Error(`Refusing execution: synthesized argument contains shell metacharacters: ${arg}`);
    }
  }

  const timeoutMs = Math.min(30_000, options.timeoutMs ?? 10_000);
  const startTime = Date.now();
  const sanitizedEnv = createSanitizedEnvironment();

  return new Promise<JobExecutionResult>((resolve) => {
    let stdoutBuf = "";
    let stderrBuf = "";
    const MAX_BUFFER = 1024 * 1024; // 1 MB limit

    const child = spawn(routine.executable, args, {
      shell: false, // Shell interpolation explicitly disabled
      env: sanitizedEnv,
      cwd: options.cwd && existsSync(options.cwd) ? options.cwd : process.cwd(),
      windowsHide: true,
    });

    activeSubprocesses.add(child);

    let isFinished = false;
    const timer = setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        child.kill("SIGKILL");
        activeSubprocesses.delete(child);
        resolve({
          commandId,
          success: false,
          exitCode: -1,
          stdout: stdoutBuf,
          stderr: (stderrBuf + "\nProcess timed out").trim(),
          durationMs: Date.now() - startTime,
          killed: true,
          error: "Process timed out and was killed.",
        });
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBuf.length < MAX_BUFFER) {
        stdoutBuf += chunk.toString("utf-8");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBuf.length < MAX_BUFFER) {
        stderrBuf += chunk.toString("utf-8");
      }
    });

    child.on("error", (err: Error) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timer);
      activeSubprocesses.delete(child);
      resolve({
        commandId,
        success: false,
        exitCode: 1,
        stdout: stdoutBuf.trim(),
        stderr: err.message,
        durationMs: Date.now() - startTime,
        error: err.message,
      });
    });

    child.on("close", (code: number | null) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timer);
      activeSubprocesses.delete(child);
      resolve({
        commandId,
        success: code === 0,
        exitCode: code ?? 0,
        stdout: stdoutBuf.trim(),
        stderr: stderrBuf.trim(),
        durationMs: Date.now() - startTime,
      });
    });
  });
}
