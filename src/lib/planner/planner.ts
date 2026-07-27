import { getDb } from "@/lib/db/client";
import { listLatestCompletionDatesByTask } from "@/lib/db/completion";
import { getEnv } from "@/lib/env";
import { callOllama } from "@/lib/ollama/client";
import { getMode } from "@/lib/db/mode";
import { taskDurationMinutes, listTasks, type Task } from "@/lib/db/task";
import { getTimeBudget } from "@/lib/db/timeBudget";
import { createWeeklyPlanWithActivities, getWeeklyPlanByWeek } from "@/lib/db/weeklyPlan";

const RUN_INTERVAL_MS = 15 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface PlannerStatus {
  running: boolean;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastResult: string | null;
}

let running = false;
let timer: ReturnType<typeof setInterval> | undefined;

/** Starts the background Planner loop: runs immediately, then every intervalMs. */
export function startPlanner(intervalMs: number = RUN_INTERVAL_MS): void {
  if (running) {
    return;
  }
  running = true;
  void runPlannerOnce();
  timer = setInterval(() => void runPlannerOnce(), intervalMs);
}

export function stopPlanner(): void {
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

export function getPlannerStatus(): PlannerStatus {
  const row = getDb()
    .prepare("SELECT ran_at, status, result FROM planner_run ORDER BY id DESC LIMIT 1")
    .get() as { ran_at: string; status: string; result: string | null } | undefined;

  return {
    running,
    lastRunAt: row?.ran_at ?? null,
    lastStatus: (row?.status as "ok" | "error" | undefined) ?? null,
    lastResult: row ? row.result : null,
  };
}

/** Generates this week's Weekly Plan if one does not already exist, recording the run outcome. */
export async function runPlannerOnce(): Promise<void> {
  const env = getEnv();
  const recordRun = getDb().prepare(
    "INSERT INTO planner_run (ran_at, status, result) VALUES (?, ?, ?)"
  );
  const week = currentWeek();

  try {
    if (getWeeklyPlanByWeek(week.startDate)) {
      recordRun.run(new Date().toISOString(), "ok", `Week ${week.startDate} already planned.`);
      return;
    }

    const tasks = listTasks();
    const mode = getMode();
    const timeBudgetMinutes = getTimeBudget(mode);
    const latestCompletionDates = listLatestCompletionDatesByTask();
    const prompt = buildPlanningPrompt({
      week,
      tasks,
      mode,
      timeBudgetMinutes,
      latestCompletionDates,
    });
    const response = await callOllama(prompt, {
      host: env.OLLAMA_HOST,
      model: env.OLLAMA_MODEL,
      format: "json",
    });
    const activities = validatePlannedActivities(response, tasks, week);
    if (activities.length === 0) {
      throw new Error(`Ollama returned no usable Planned Activities for week ${week.startDate}.`);
    }

    createWeeklyPlanWithActivities({
      weekStartDate: week.startDate,
      activities,
    });
    recordRun.run(
      new Date().toISOString(),
      "ok",
      `Planned ${activities.length} Planned Activities for week ${week.startDate}.`
    );
  } catch (error) {
    recordRun.run(
      new Date().toISOString(),
      "error",
      error instanceof Error ? error.message : String(error)
    );
  }
}

interface PlanningWeek {
  startDate: string;
  dates: string[];
}

interface BuildPlanningPromptInput {
  week: PlanningWeek;
  tasks: Task[];
  mode: string;
  timeBudgetMinutes: number | undefined;
  latestCompletionDates: Map<number, string>;
}

interface ParsedActivity {
  taskId: unknown;
  date: unknown;
}

interface ParsedResponse {
  activities?: unknown;
}

function currentWeek(date = new Date()): PlanningWeek {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);

  const dates = Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    return formatLocalDate(day);
  });

  return { startDate: dates[0], dates };
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildPlanningPrompt(input: BuildPlanningPromptInput): string {
  const taskLines = input.tasks.map((task) => {
    const duration = taskDurationMinutes(task);
    if (task.kind === "scheduled") {
      return [
        `- id=${task.id}`,
        "kind=scheduled",
        `description="${task.description}"`,
        `durationMinutes=${duration}`,
        `weekday=${task.weekday}`,
        `startTime=${task.startTime}`,
        `endTime=${task.endTime}`,
        `recurrenceIntervalWeeks=${task.recurrenceIntervalWeeks}`,
      ].join("; ");
    }

    return [
      `- id=${task.id}`,
      "kind=flexible",
      `description="${task.description}"`,
      `durationMinutes=${duration}`,
      `frequency="${task.frequencyText}"`,
      `lastCompleted=${input.latestCompletionDates.get(task.id) ?? "never completed"}`,
    ].join("; ");
  });

  return [
    "Generate a Weekly Plan of Planned Activities for the single user.",
    `Week start: ${input.week.startDate}.`,
    `Week dates: ${input.week.dates.join(", ")}.`,
    `Current Mode: ${input.mode}.`,
    `Weekly Time Budget: ${input.timeBudgetMinutes ?? 0} minutes.`,
    "Tasks:",
    taskLines.length > 0 ? taskLines.join("\n") : "- none",
    "Return JSON only, as one object with this exact shape:",
    '{"activities":[{"taskId":1,"date":"YYYY-MM-DD"}]}',
    "Use only existing task ids. Dates must be one of the listed week dates.",
    "Scheduled Tasks should use their configured weekday and recurrence. Flexible Tasks have no time slot.",
  ].join("\n");
}

function validatePlannedActivities(
  response: string,
  tasks: Task[],
  week: PlanningWeek
): { taskId: number; date: string; status: "pending" }[] {
  const parsed = JSON.parse(extractFirstJsonObject(response)) as ParsedResponse;
  if (!Array.isArray(parsed.activities)) {
    return [];
  }

  const taskIds = new Set(tasks.map((task) => task.id));
  const weekDates = new Set(week.dates);
  const seen = new Set<string>();
  const validActivities: { taskId: number; date: string; status: "pending" }[] = [];

  for (const activity of parsed.activities as ParsedActivity[]) {
    if (typeof activity !== "object" || activity === null) {
      continue;
    }
    const taskId = activity.taskId;
    const date = activity.date;
    if (
      typeof taskId !== "number" ||
      !Number.isInteger(taskId) ||
      typeof date !== "string" ||
      !DATE_PATTERN.test(date)
    ) {
      continue;
    }
    if (!taskIds.has(taskId) || !weekDates.has(date)) {
      continue;
    }

    const key = `${taskId}:${date}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    validActivities.push({ taskId, date, status: "pending" });
  }

  return validActivities;
}

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error("Ollama response did not contain a JSON object.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  throw new Error("Ollama response contained incomplete JSON.");
}
