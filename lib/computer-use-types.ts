export type ComputerActionType =
  | "navigate"
  | "mouse_click"
  | "mouse_double_click"
  | "mouse_right_click"
  | "mouse_move"
  | "mouse_scroll"
  | "type_text"
  | "key_press"
  | "extract_data"
  | "run_cli"
  | "wait_for"
  | "take_screenshot";

// How the agent's motor system behaves:
// - agent_owned: virtual mouse/keyboard only (simulated playback in the UI) —
//   the user's real devices are never touched.
// - auto_idle: borrow the user's REAL mouse/keyboard while they are idle
//   (measured via last-input time); fall back to virtual while they are active.
// - takeover: user explicitly handed over the real devices for a while.
export type AgentInputMode = "agent_owned" | "auto_idle" | "takeover";

export type ScreenElementBoundingBox = {
  top: number; // Normalized 0 - 1000
  left: number; // Normalized 0 - 1000
  width: number; // Normalized 0 - 1000
  height: number; // Normalized 0 - 1000
};

export type ScreenElement = {
  id: string; // e.g. "elem_1", "elem_2"
  tag: string; // e.g. "button", "a", "input", "textarea"
  text?: string;
  placeholder?: string;
  href?: string;
  type?: string; // e.g. "text", "submit", "password"
  selector?: string; // CSS selector
  bbox: ScreenElementBoundingBox;
  center: { x: number; y: number }; // Normalized 0 - 1000
  clickable: boolean;
  typable: boolean;
  ariaLabel?: string;
};

export type ScreenState = {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  elements: ScreenElement[];
  activeElementId?: string;
  scrollOffset: { x: number; y: number };
  contentSnippet?: string;
  headings?: string[];
  capturedAt: string;
};

// Human-like motor model: the agent owns its own virtual mouse and keyboard,
// and every action carries a motion plan so the UI can play the movement back
// the way a human hand would move.
export type MotorWaypoint = { x: number; y: number; t: number }; // t = ms from action start

export type MotorPlan = {
  cursorPath: MotorWaypoint[];
  keystrokes?: Array<{ char: string; delayMs: number }>;
  preDelayMs: number;
  postDelayMs: number;
  clickRipple?: boolean;
  typingSurface?: string; // elementId the keyboard is focused on
};

export type ComputerActionStep = {
  id: string;
  action: ComputerActionType;
  description: string;
  target?: {
    elementId?: string;
    selector?: string;
    text?: string;
    coords?: { x: number; y: number }; // Normalized 0 - 1000
  };
  value?: string; // Text to type, URL to navigate, CLI command to run
  scrollDelta?: { dx: number; dy: number };
  keyCombination?: string; // e.g. "Control+Enter", "Escape"
  timeoutMs?: number;
  expectedResult?: string;
};

export type SkillParameter = {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  defaultValue?: string | number | boolean;
  required: boolean;
};

export type DemonstrationEvent = {
  timestamp: number;
  action: ComputerActionType;
  targetUrl?: string;
  elementId?: string;
  selector?: string;
  elementText?: string;
  coords?: { x: number; y: number };
  value?: string;
  scrollDelta?: { dx: number; dy: number };
  keyCombination?: string;
  screenshotThumb?: string;
};

export type ComputerSkill = {
  id: string;
  name: string;
  triggerPhrase: string;
  description: string;
  category: "browser" | "desktop" | "data_extraction" | "system" | "custom";
  parameters: SkillParameter[];
  steps: ComputerActionStep[];
  rawDemonstration?: DemonstrationEvent[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  runCount: number;
  successRate?: number;
};

export type MissionStatus =
  | "queued"
  | "planning"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type MissionMode = "away" | "interactive" | "scheduled";

export type MissionSubTask = {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  actions: ComputerActionStep[];
  completedActions: number;
  summary?: string;
};

export type ExecutiveDebrief = {
  summary: string;
  tasksCompleted: number;
  totalTasks: number;
  actionsExecuted: number;
  durationMs: number;
  highlights: string[];
  artifactsCreated: Array<{
    type: "brief" | "task" | "reminder" | "file" | "data_table";
    title: string;
    id?: string;
    url?: string;
  }>;
  errorsMitigated: string[];
  returnMessage: string;
};

export type AutonomousMission = {
  id: string;
  goal: string;
  status: MissionStatus;
  mode: MissionMode;
  userAway: boolean;
  plannedSubtasks: MissionSubTask[];
  currentSubtaskIndex: number;
  totalSubtasks: number;
  currentScreen?: ScreenState;
  activeAction?: ComputerActionStep;
  debrief?: ExecutiveDebrief;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  durationMs?: number;
};

export type ActionExecutionResult = {
  success: boolean;
  action: ComputerActionStep;
  screenState?: ScreenState;
  output?: unknown;
  cursorPosition?: { x: number; y: number };
  motorPlan?: MotorPlan;
  durationMs: number;
  error?: string;
  selfHealed?: boolean;
  recoveryNote?: string;
  // True when the action physically executed on the real device (browser tab,
  // mouse, keyboard, screenshot file) rather than in the virtual plane.
  real?: boolean;
  realInputNote?: string;
};

export type ComputerUseLogRecord = {
  id: string;
  missionId?: string;
  skillId?: string;
  stepNumber: number;
  actionType: ComputerActionType;
  actionPayload: ComputerActionStep;
  thought?: string;
  result: ActionExecutionResult;
  cursorPosition?: { x: number; y: number };
  screenUrl?: string;
  screenTitle?: string;
  executedAt: string;
};

export type VirtualCursorState = {
  x: number; // 0 - 1000
  y: number; // 0 - 1000
  isClicking: boolean;
  isTyping: boolean;
  lastActionText?: string;
};

// --- Shared device-bridge types (client + server) ---

export type DeviceSnapshot = {
  platform: string;
  hostReady: boolean;
  volume: number;
  muted: boolean;
  idleSeconds: number | null;
  foregroundTitle: string;
  cpuLoad: number | null;
  memoryTotalGb: number | null;
  memoryFreeGb: number | null;
  batteryPercent: number | null;
  charging: boolean | null;
  uptimeHours: number | null;
  screenWidth: number | null;
  screenHeight: number | null;
  machine: string;
};

export type ArtifactInfo = {
  name: string;
  bytes: number;
  createdAt: string;
  modifiedAt: string;
  url: string;
};

export type ArtifactKind = "screenshots" | "pdf";

export type DesktopWindow = { process: string; title: string };
