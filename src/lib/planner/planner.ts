import { getDb } from "@/lib/db/client";
import {
  getLatestCompletionDatesByTask,
  hasCompletionsSince,
  listCompletionsForDateRange,
  type Completion,
} from "@/lib/db/completion";
import { hasCorrectionsSince } from "@/lib/db/correction";
import { getMode, type ModeValue } from "@/lib/db/mode";
import { listPlannedActivitiesForPlan, type PlannedActivity } from "@/lib/db/plannedActivity";
import {
  listTasks,
  taskDurationMinutes,
  type FlexibleTask,
  type ScheduledTask,
} from "@/lib/db/task";
import { getTimeBudget } from "@/lib/db/timeBudget";
import {
  createWeeklyPlanWithActivities,
  getWeeklyPlanByWeek,
  replaceRevisablePlannedActivities,
  type NewPlannedActivity,
} from "@/lib/db/weeklyPlan";
import { getEnv } from "@/lib/env";
import { callOllama } from "@/lib/ollama/client";

const RUN_INTERVAL_MS = 15 * 60 * 1000;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

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

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The Monday of the week the given moment falls in, in server-local time. */
function currentWeekStart(now: Date): string {
  const daysSinceMonday = (now.getDay() + 6) % 7;
  return formatLocalDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday)
  );
}

/** The seven dates of the week starting on the given Monday. */
function weekDates(weekStart: string): string[] {
  const [year, month, day] = weekStart.split("-").map(Number);
  return Array.from({ length: 7 }, (_, offset) =>
    formatLocalDate(new Date(year, month - 1, day + offset))
  );
}

function weekStartForDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return currentWeekStart(new Date(year, month - 1, day));
}

function scheduledTaskRecursInWeek(task: ScheduledTask, weekStart: string): boolean {
  const anchorWeek = weekStartForDate(task.createdAt);
  const [anchorYear, anchorMonth, anchorDay] = anchorWeek.split("-").map(Number);
  const [weekYear, weekMonth, weekDay] = weekStart.split("-").map(Number);
  const weeksSinceAnchor =
    (Date.UTC(weekYear, weekMonth - 1, weekDay) -
      Date.UTC(anchorYear, anchorMonth - 1, anchorDay)) /
    (7 * 24 * 60 * 60 * 1000);

  return weeksSinceAnchor >= 0 && weeksSinceAnchor % task.recurrenceIntervalWeeks === 0;
}

interface ScheduledPlacement {
  task: ScheduledTask;
  activity: NewPlannedActivity;
}

function scheduledPlacements(
  tasks: ScheduledTask[],
  weekStart: string,
  dates: string[]
): ScheduledPlacement[] {
  return tasks.flatMap((task) => {
    if (!scheduledTaskRecursInWeek(task, weekStart)) {
      return [];
    }
    return [{ task, activity: { taskId: task.id, date: dates[(task.weekday + 6) % 7] } }];
  });
}

function assumedBusyHours(mode: ModeValue): string {
  return mode === "work" ? "Mon-Fri 09:00-17:00" : "the week is mostly open";
}

function taskLine(task: FlexibleTask, lastCompletionDate: string | undefined): string {
  const duration = `${taskDurationMinutes(task)} minutes`;
  return (
    `- id ${task.id} | flexible | "${task.description}" | ${duration} | ` +
    `wanted ${task.frequencyText}, ` +
    `${lastCompletionDate === undefined ? "never completed" : `last completed ${lastCompletionDate}`}`
  );
}

function buildPrompt(
  weekStart: string,
  dates: string[],
  mode: ModeValue,
  timeBudgetMinutes: number | undefined,
  flexibleTasks: FlexibleTask[],
  fixedPlacements: ScheduledPlacement[],
  lastCompletionDates: Map<number, string>
): string {
  // dates[0] is the Monday, so the weekday name follows from the offset.
  const days = dates.map((date, offset) => `${date} (${WEEKDAY_NAMES[(offset + 1) % 7]})`).join("\n");
  const taskLines = flexibleTasks
    .map((task) => taskLine(task, lastCompletionDates.get(task.id)))
    .join("\n");
  const fixedPlacementLines = fixedPlacements
    .map(
      ({ task, activity }) =>
        `- ${activity.date} | ${WEEKDAY_NAMES[task.weekday]} | ${task.startTime}-${task.endTime} | ` +
        `"${task.description}" | ${taskDurationMinutes(task)} minutes`
    )
    .join("\n");

  return [
    "You plan a single week of recurring personal tasks.",
    "",
    `Week starting Monday ${weekStart}. Its seven days are:`,
    days,
    "",
    `Current mode: ${mode}; assumed-busy hours: ${assumedBusyHours(mode)}.`,
    `Weekly time budget for flexible tasks: ${timeBudgetMinutes ?? "unknown"} minutes`,
    "",
    "Fixed Scheduled Task placements (immovable; honour them regardless of assumed-busy hours):",
    fixedPlacementLines || "(none)",
    "",
    "Flexible Tasks to place:",
    taskLines || "(none)",
    "",
    "Place each Flexible Task on a day of your choosing when its frequency says it is due,",
    "keeping the total duration of flexible tasks within the weekly time budget.",
    "List Flexible Tasks most-urgent-first; entries beyond the Time Budget will be dropped.",
    "Do not move, duplicate, or include a fixed Scheduled Task in your response.",
    "",
    "Respond with JSON only, in exactly this shape, using only the ids and dates above:",
    '{"activities": [{"taskId": 1, "date": "' + dates[0] + '"}]}',
  ].join("\n");
}

function activityLine(activity: PlannedActivity): string {
  return `- task id ${activity.taskId} | ${activity.date} | ${activity.status}`;
}

function completionLine(completion: Completion): string {
  return (
    `- task id ${completion.taskId} | completed ${completion.completedDate}` +
    (completion.note === undefined ? "" : ` | note: \"${completion.note}\"`)
  );
}

/** A generation prompt extended with the current-week facts needed to revise its open remainder. */
function buildRevisionPrompt(
  weekStart: string,
  dates: string[],
  today: string,
  mode: ModeValue,
  timeBudgetMinutes: number | undefined,
  flexibleTasks: FlexibleTask[],
  fixedPlacements: ScheduledPlacement[],
  lastCompletionDates: Map<number, string>,
  frozenActivities: PlannedActivity[],
  revisableActivities: PlannedActivity[],
  completions: Completion[]
): string {
  return [
    buildPrompt(
      weekStart,
      dates,
      mode,
      timeBudgetMinutes,
      flexibleTasks,
      fixedPlacements,
      lastCompletionDates
    ),
    "",
    `Today is ${today}. Revise only today and the remaining days of this week; do not plan past dates.`,
    "Frozen Planned Activities (do not duplicate or change these):",
    frozenActivities.map(activityLine).join("\n") || "(none)",
    "",
    "Current revisable remainder (replace this):",
    revisableActivities.map(activityLine).join("\n") || "(none)",
    "",
    "This week's Completions:",
    completions.map(completionLine).join("\n") || "(none)",
  ].join("\n");
}

/** The first balanced JSON object in the text, so prose or a code fence around it is tolerated. */
function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return undefined;
}

/**
 * The entries of a model response that survive validation: a known Task id, a date inside the
 * week being planned, and no repeat of a (taskId, date) pair. Bad entries are dropped, not fatal.
 */
function parsePlannedActivities(
  response: string,
  knownTaskIds: Set<number>,
  datesInWeek: Set<string>,
  blockedTaskDates: Set<string> = new Set()
): NewPlannedActivity[] | undefined {
  const json = extractJsonObject(response);
  if (json === undefined) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }

  const entries = (parsed as { activities?: unknown }).activities;
  if (!Array.isArray(entries)) {
    return undefined;
  }

  const seen = new Set<string>();
  const activities: NewPlannedActivity[] = [];

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { taskId, date } = entry as { taskId?: unknown; date?: unknown };
    if (typeof taskId !== "number" || !Number.isInteger(taskId) || !knownTaskIds.has(taskId)) {
      continue;
    }
    if (typeof date !== "string" || !datesInWeek.has(date)) {
      continue;
    }
    const key = `${taskId}:${date}`;
    if (seen.has(key) || blockedTaskDates.has(key)) {
      continue;
    }
    seen.add(key);
    activities.push({ taskId, date });
  }

  return activities;
}

/**
 * Admits model-proposed Flexible Planned Activities in response order while the remaining weekly
 * Time Budget can cover their Durations. An unconfigured budget preserves the model proposal.
 */
function applyTimeBudget(
  activities: NewPlannedActivity[],
  flexibleTasks: FlexibleTask[],
  timeBudgetMinutes: number | undefined,
  frozenActivities: PlannedActivity[] = []
): { activities: NewPlannedActivity[]; deferred: number } {
  if (timeBudgetMinutes === undefined) {
    return { activities, deferred: 0 };
  }

  const tasksById = new Map(flexibleTasks.map((task) => [task.id, task]));
  const frozenMinutes = frozenActivities.reduce((total, activity) => {
    const task = tasksById.get(activity.taskId);
    return total + (task === undefined ? 0 : taskDurationMinutes(task));
  }, 0);
  let remainingMinutes = Math.max(0, timeBudgetMinutes - frozenMinutes);
  const admitted: NewPlannedActivity[] = [];
  let deferred = 0;

  for (const activity of activities) {
    const durationMinutes = taskDurationMinutes(tasksById.get(activity.taskId)!);
    if (durationMinutes <= remainingMinutes) {
      admitted.push(activity);
      remainingMinutes -= durationMinutes;
    } else {
      deferred++;
    }
  }

  return { activities: admitted, deferred };
}

function deferredResultSuffix(deferred: number): string {
  if (deferred === 0) {
    return "";
  }
  return ` ${deferred} model-proposed Planned ${deferred === 1 ? "Activity was" : "Activities were"} deferred for the Time Budget.`;
}

/**
 * Generates this week's Weekly Plan when none exists. An existing plan is revised only after new
 * Completion or Correction feedback has arrived since the Planner last wrote it.
 */
export async function runPlannerOnce(): Promise<void> {
  const recordRun = getDb().prepare(
    "INSERT INTO planner_run (ran_at, status, result) VALUES (?, ?, ?)"
  );

  try {
    const weekStart = currentWeekStart(new Date());
    const existingPlan = getWeeklyPlanByWeek(weekStart);
    if (existingPlan && !hasCompletionsSince(existingPlan.revisedAt) && !hasCorrectionsSince(existingPlan.revisedAt)) {
      recordRun.run(new Date().toISOString(), "ok", `Week ${weekStart} already planned.`);
      return;
    }

    const dates = weekDates(weekStart);
    const tasks = listTasks();
    const mode = getMode();
    const timeBudgetMinutes = getTimeBudget(mode);
    const scheduledTasks = tasks.filter(
      (task): task is ScheduledTask => task.kind === "scheduled"
    );
    const flexibleTasks = tasks.filter(
      (task): task is FlexibleTask => task.kind === "flexible"
    );
    const fixedPlacements = scheduledPlacements(scheduledTasks, weekStart, dates);

    if (!existingPlan && flexibleTasks.length === 0) {
      if (fixedPlacements.length === 0) {
        recordRun.run(new Date().toISOString(), "ok", `Week ${weekStart} has nothing due.`);
        return;
      }

      createWeeklyPlanWithActivities(
        weekStart,
        fixedPlacements.map(({ activity }) => activity)
      );
      recordRun.run(
        new Date().toISOString(),
        "ok",
        `Planned week ${weekStart}: ${fixedPlacements.length} Scheduled and 0 model-placed Planned Activities.`
      );
      return;
    }

    if (existingPlan && flexibleTasks.length === 0) {
      recordRun.run(new Date().toISOString(), "ok", `Week ${weekStart} already planned.`);
      return;
    }

    const today = formatLocalDate(new Date());
    const lastCompletionDates = getLatestCompletionDatesByTask();
    const existingActivities = existingPlan ? listPlannedActivitiesForPlan(existingPlan.id) : [];
    const scheduledTaskIds = new Set(scheduledTasks.map((task) => task.id));
    const scheduledTasksById = new Map(scheduledTasks.map((task) => [task.id, task]));
    const promptFixedPlacements = existingPlan
      ? existingActivities.flatMap((activity) => {
          const task = scheduledTasksById.get(activity.taskId);
          return task === undefined ? [] : [{ task, activity }];
        })
      : fixedPlacements;
    const frozenActivities = existingActivities.filter(
      (activity) =>
        scheduledTaskIds.has(activity.taskId) || activity.status !== "pending" || activity.date < today
    );
    const revisableActivities = existingActivities.filter(
      (activity) =>
        !scheduledTaskIds.has(activity.taskId) && activity.status === "pending" && activity.date >= today
    );
    const prompt = existingPlan
      ? buildRevisionPrompt(
          weekStart,
          dates,
          today,
          mode,
          timeBudgetMinutes,
          flexibleTasks,
          promptFixedPlacements,
          lastCompletionDates,
          frozenActivities,
          revisableActivities,
          listCompletionsForDateRange(dates[0], dates.at(-1)!)
        )
      : buildPrompt(
          weekStart,
          dates,
          mode,
          timeBudgetMinutes,
          flexibleTasks,
          promptFixedPlacements,
          lastCompletionDates
        );

    const env = getEnv();
    const response = await callOllama(prompt, {
      host: env.OLLAMA_HOST,
      model: env.OLLAMA_MODEL,
      format: "json",
    });

    const parsedActivities = parsePlannedActivities(
      response,
      new Set(flexibleTasks.map((task) => task.id)),
      new Set(existingPlan ? dates.filter((date) => date >= today) : dates),
      new Set(frozenActivities.map((activity) => `${activity.taskId}:${activity.date}`))
    );

    if (parsedActivities === undefined) {
      recordRun.run(
        new Date().toISOString(),
        "error",
        `Ollama returned no usable response for week ${weekStart}.`
      );
      return;
    }

    const { activities, deferred } = applyTimeBudget(
      parsedActivities,
      flexibleTasks,
      timeBudgetMinutes,
      frozenActivities
    );

    if (existingPlan) {
      replaceRevisablePlannedActivities(existingPlan.id, today, activities);
      recordRun.run(
        new Date().toISOString(),
        "ok",
        `Revised week ${weekStart} from ${today}: ${activities.length} Planned ${
          activities.length === 1 ? "Activity" : "Activities"
        }.${deferredResultSuffix(deferred)}`
      );
      return;
    }

    const plannedActivities = [...fixedPlacements.map(({ activity }) => activity), ...activities];
    if (plannedActivities.length === 0) {
      recordRun.run(
        new Date().toISOString(),
        "ok",
        `Week ${weekStart} has nothing due.${deferredResultSuffix(deferred)}`
      );
      return;
    }

    createWeeklyPlanWithActivities(weekStart, plannedActivities);
    recordRun.run(
      new Date().toISOString(),
      "ok",
      `Planned week ${weekStart}: ${fixedPlacements.length} Scheduled and ${activities.length} model-placed Planned Activities.${deferredResultSuffix(deferred)}`
    );
  } catch (error) {
    recordRun.run(
      new Date().toISOString(),
      "error",
      error instanceof Error ? error.message : String(error)
    );
  }
}
