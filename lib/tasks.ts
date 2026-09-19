import type { TaskItem } from "./types";
import { safeRandomUUID } from "./uuid";

const RECURRENCES = new Set(["One-time", "Daily", "Weekly", "Monthly"]);
const RECURRING_RECURRENCES = new Set(["Daily", "Weekly", "Monthly"]);
const RAPID_COMPLETION_GUARD_MS = 750;

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromTaskValue(value: string, fallback: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(
      fallback.getFullYear(),
      fallback.getMonth(),
      fallback.getDate(),
      12,
    );
  }
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function addRecurrence(date: Date, recurrence: string, anchorDay?: number) {
  const next = new Date(date);
  if (recurrence === "Daily") next.setDate(next.getDate() + 1);
  if (recurrence === "Weekly") next.setDate(next.getDate() + 7);
  if (recurrence === "Monthly") {
    const desiredDay = anchorDay || next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const finalDay = new Date(
      next.getFullYear(),
      next.getMonth() + 1,
      0,
      12,
    ).getDate();
    next.setDate(Math.min(desiredDay, finalDay));
  }
  return next;
}

export function nextRecurringDue(
  value: string,
  recurrence: string,
  now = new Date(),
  anchorDay?: number,
) {
  if (!RECURRING_RECURRENCES.has(recurrence)) return localDateValue(now);
  let next = dateFromTaskValue(value, now);
  const today = dateFromTaskValue(localDateValue(now), now);
  const recurrenceAnchor =
    recurrence === "Monthly" && Number.isInteger(anchorDay) && anchorDay! >= 1 && anchorDay! <= 31
      ? anchorDay
      : next.getDate();
  do {
    next = addRecurrence(next, recurrence, recurrenceAnchor);
  } while (next <= today);
  return localDateValue(next);
}

export function completeTaskItems(
  tasks: TaskItem[],
  taskId: TaskItem["id"],
  options: {
    now?: Date;
    occurrenceId?: TaskItem["id"];
    expectedDue?: string;
  } = {},
) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (
    !task ||
    task.done ||
    (options.expectedDue !== undefined && task.due !== options.expectedDue)
  ) return tasks;
  const now = options.now || new Date();
  const recentlyCompleted = tasks.some((candidate) => {
    if (!candidate.done || candidate.seriesId !== task.id || !candidate.completedAt)
      return false;
    const elapsed = now.getTime() - Date.parse(candidate.completedAt);
    return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < RAPID_COMPLETION_GUARD_MS;
  });
  if (recentlyCompleted) return tasks;
  const completedAt = now.toISOString();
  if (!RECURRING_RECURRENCES.has(task.recurrence)) {
    return tasks.map((candidate) =>
      candidate.id === taskId ? { ...candidate, done: true, completedAt } : candidate,
    );
  }
  const occurrence: TaskItem = {
    ...task,
    id: options.occurrenceId || safeRandomUUID(),
    done: true,
    completedAt,
    seriesId: task.id,
  };
  const recurrenceAnchorDay =
    task.recurrence === "Monthly"
      ? task.recurrenceAnchorDay || dateFromTaskValue(task.due, now).getDate()
      : undefined;
  const advanced = tasks.map((candidate) =>
    candidate.id === taskId
      ? {
          ...candidate,
          due: nextRecurringDue(
            candidate.due,
            candidate.recurrence,
            now,
            recurrenceAnchorDay,
          ),
          done: false,
          completedAt: undefined,
          recurrenceAnchorDay,
        }
      : candidate,
  );
  return [occurrence, ...advanced];
}

function taskIdentity(task: Pick<TaskItem, "id">) {
  return `${typeof task.id}:${String(task.id)}`;
}

export function preserveRecurringCompletionHistory(
  existing: TaskItem[],
  incoming: TaskItem[],
) {
  const immutable = new Map(
    existing
      .filter((task) => task.done && task.seriesId !== undefined)
      .map((task) => [taskIdentity(task), task]),
  );
  const retained = new Set<string>();
  const merged = incoming.map((task) => {
    const key = taskIdentity(task);
    const prior = immutable.get(key);
    if (!prior) return task;
    retained.add(key);
    return prior;
  });
  for (const [key, task] of immutable) {
    if (!retained.has(key)) merged.push(task);
  }
  return merged;
}

function cleanId(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? value
    : safeRandomUUID();
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function cleanTaskItems(value: unknown): TaskItem[] {
  if (!Array.isArray(value)) throw new Error("Tasks must be a list.");
  if (value.length > 10_000) throw new Error("The task list is too large.");
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<TaskItem>;
    const title = cleanText(candidate.title).trim();
    if (!title) return [];
    const recurrence = cleanText(candidate.recurrence, "One-time");
    return [{
      id: cleanId(candidate.id),
      title,
      description: cleanText(
        candidate.description,
        "No additional details.",
      ),
      due: cleanText(candidate.due, "Today"),
      recurrence: RECURRENCES.has(recurrence) ? recurrence : "One-time",
      priority: cleanText(candidate.priority, "Normal"),
      done: candidate.done === true,
      createdAt: cleanText(candidate.createdAt) || undefined,
      completedAt: cleanText(candidate.completedAt) || undefined,
      seriesId:
        typeof candidate.seriesId === "string" ||
        typeof candidate.seriesId === "number"
          ? candidate.seriesId
          : undefined,
      recurrenceAnchorDay:
        typeof candidate.recurrenceAnchorDay === "number" &&
        Number.isInteger(candidate.recurrenceAnchorDay) &&
        candidate.recurrenceAnchorDay >= 1 &&
        candidate.recurrenceAnchorDay <= 31
          ? candidate.recurrenceAnchorDay
          : undefined,
    }];
  });
}
