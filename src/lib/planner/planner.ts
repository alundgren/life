import { attachModelCallOutcome } from "@/lib/db/modelCall";
import {
  getLatestCompletionDatesByTask,
  hasCompletionsSince,
  listCompactionEligibleCompletionsByTask,
  listCompletionsForDateRange,
  listUnprocessedCompletions,
  markCompletionProcessed,
  type Completion,
} from "@/lib/db/completion";
import {
  getCompletionDigestSummariesByTask,
  replaceCompletionDigestAndDeleteCompletions,
} from "@/lib/db/completionDigest";
import { applyCorrection, hasCorrectionsSince } from "@/lib/db/correction";
import { getMode, type ModeValue } from "@/lib/db/mode";
import { listPlannedActivitiesForPlan, type PlannedActivity } from "@/lib/db/plannedActivity";
import { getPlannerLastCheckedAt, touchPlannerHeartbeat } from "@/lib/db/plannerHeartbeat";
import { createPlannerRun, getLatestPlannerRun } from "@/lib/db/plannerRun";
import {
  listTasks,
  taskDurationMinutes,
  type FlexibleTask,
  type ScheduledTask,
  type Task,
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
import {
  addCalendarDays,
  formatLocalDate,
  getCurrentTime,
  isSimulatedClockEnabled,
} from "@/lib/simulatedClock";

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
  lastCheckedAt: string | null;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastResult: string | null;
}

let running = false;
let runInFlight = false;
let timer: ReturnType<typeof setInterval> | undefined;

/** Starts the background Planner loop: runs immediately, then every intervalMs. */
export function startPlanner(intervalMs: number = RUN_INTERVAL_MS): void {
  if (isSimulatedClockEnabled()) {
    return;
  }
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
  const lastRun = getLatestPlannerRun();

  return {
    running,
    lastCheckedAt: getPlannerLastCheckedAt(),
    lastRunAt: lastRun?.ranAt ?? null,
    lastStatus: lastRun?.status ?? null,
    lastResult: lastRun ? lastRun.result : null,
  };
}

function weekStartForCalendarDate(date: string): string {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addCalendarDays(date, -((weekday + 6) % 7));
}

/** The Monday of the week the given moment falls in, in the application timezone. */
function currentWeekStart(now: Date): string {
  return weekStartForCalendarDate(formatLocalDate(now));
}

/** The seven dates of the week starting on the given Monday. */
function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, offset) => addCalendarDays(weekStart, offset));
}

function weekStartForDate(date: string): string {
  // Older SQLite rows use a UTC `YYYY-MM-DD HH:MM:SS` value; interpret that legacy
  // format explicitly rather than letting Date parse it in the host timezone.
  const instant = new Date(date.includes("T") ? date : `${date.replace(" ", "T")}Z`);
  return weekStartForCalendarDate(formatLocalDate(instant));
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

function taskLine(
  task: FlexibleTask,
  lastCompletionDate: string | undefined,
  completionDigest: string | undefined
): string {
  const duration = `${taskDurationMinutes(task)} minutes`;
  return (
    `- id ${task.id} | flexible | "${task.description}" | ${duration} | ` +
    `wanted ${task.frequencyText}, ` +
    `${lastCompletionDate === undefined ? "never completed" : `last completed ${lastCompletionDate}`}` +
    (completionDigest === undefined ? "" : `, completion digest: "${completionDigest}"`)
  );
}

function buildPrompt(
  weekStart: string,
  dates: string[],
  mode: ModeValue,
  timeBudgetMinutes: number | undefined,
  flexibleTasks: FlexibleTask[],
  fixedPlacements: ScheduledPlacement[],
  lastCompletionDates: Map<number, string>,
  completionDigests: Map<number, string>
): string {
  // dates[0] is the Monday, so the weekday name follows from the offset.
  const days = dates.map((date, offset) => `${date} (${WEEKDAY_NAMES[(offset + 1) % 7]})`).join("\n");
  const taskLines = flexibleTasks
    .map((task) => taskLine(task, lastCompletionDates.get(task.id), completionDigests.get(task.id)))
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
  completionDigests: Map<number, string>,
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
      lastCompletionDates,
      completionDigests
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
interface ParsedPlannedActivities {
  activities: NewPlannedActivity[];
  proposed: number;
  unknownTasks: number;
  outsideWeek: number;
  duplicates: number;
}

function parsePlannedActivities(
  response: string,
  knownTaskIds: Set<number>,
  datesInWeek: Set<string>,
  blockedTaskDates: Set<string> = new Set()
): ParsedPlannedActivities | undefined {
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
  let unknownTasks = 0;
  let outsideWeek = 0;
  let duplicates = 0;

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { taskId, date } = entry as { taskId?: unknown; date?: unknown };
    if (typeof taskId !== "number" || !Number.isInteger(taskId) || !knownTaskIds.has(taskId)) {
      unknownTasks++;
      continue;
    }
    if (typeof date !== "string" || !datesInWeek.has(date)) {
      outsideWeek++;
      continue;
    }
    const key = `${taskId}:${date}`;
    if (seen.has(key) || blockedTaskDates.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    activities.push({ taskId, date });
  }

  return { activities, proposed: entries.length, unknownTasks, outsideWeek, duplicates };
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

/** Attaching a diagnostic outcome must be as harmless as creating the diagnostic row. */
function attachOutcome(modelCallId: number | undefined, outcome: string): void {
  if (modelCallId === undefined) {
    return;
  }
  try {
    attachModelCallOutcome(modelCallId, outcome);
  } catch {
    // The Planner still owns its normal result even if the side-channel fails.
  }
}

function planOutcome(parsed: ParsedPlannedActivities, deferred: number, written: number): string {
  const dropped = [
    `${parsed.unknownTasks} dropped as unknown Task`,
    `${parsed.outsideWeek} dropped outside the week`,
    `${parsed.duplicates} duplicates dropped`,
  ];
  return `${parsed.proposed} proposed; ${dropped.join(", ")}; ${deferred} deferred for the Time Budget; ${written} planned.`;
}

interface CorrectionExtractionResult {
  applied: number;
  failedTasks: number;
  hadNotes: boolean;
}

interface CompletionCompactionResult {
  tasksCompacted: number;
  completionsFolded: number;
}

function correctionPrompt(task: Task, completions: Completion[]): string {
  const notes = completions
    .filter((completion) => completion.note?.trim())
    .map((completion) => `- completed ${completion.completedDate} | note: "${completion.note}"`)
    .join("\n");

  return [
    "You keep a recurring Task's description accurate from Completion notes.",
    "Decide whether the notes imply that what this Task involves has changed.",
    "Return JSON only in exactly this shape: {\"correction\": \"complete replacement description\"}.",
    "Use {\"correction\": null} when no change is needed.",
    "A correction must be the complete new Task description, never a diff or addendum.",
    "Describe only what the Task involves. Do not change its Frequency, Duration, weekday, times, or recurrence.",
    "",
    `Task id: ${task.id}`,
    `Task kind: ${task.kind}`,
    `Current description: "${task.description}"`,
    "Unprocessed Completion notes:",
    notes,
  ].join("\n");
}

type ParsedCorrection =
  | { status: "applied"; text: string }
  | { status: "unchanged" }
  | { status: "unusable" };

function parseCorrection(response: string, currentDescription: string): ParsedCorrection {
  const json = extractJsonObject(response);
  if (json === undefined) {
    return { status: "unusable" };
  }

  try {
    const correction = (JSON.parse(json) as { correction?: unknown }).correction;
    if (correction === null) {
      return { status: "unchanged" };
    }
    if (typeof correction !== "string") return { status: "unusable" };
    const text = correction.trim();
    return text && text !== currentDescription
      ? { status: "applied", text }
      : { status: "unchanged" };
  } catch {
    return { status: "unusable" };
  }
}

/** Considers unprocessed Completion notes, applying at most one Correction per Task. */
async function extractCorrections(tasks: Task[]): Promise<CorrectionExtractionResult> {
  const completionsByTask = new Map<number, Completion[]>();
  for (const completion of listUnprocessedCompletions()) {
    const completions = completionsByTask.get(completion.taskId) ?? [];
    completions.push(completion);
    completionsByTask.set(completion.taskId, completions);
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const result: CorrectionExtractionResult = { applied: 0, failedTasks: 0, hadNotes: false };

  for (const [taskId, completions] of completionsByTask) {
    const task = tasksById.get(taskId);
    const hasNotes = completions.some((completion) => completion.note?.trim());

    if (!hasNotes) {
      completions.forEach((completion) => markCompletionProcessed(completion.id));
      continue;
    }

    result.hadNotes = true;
    if (task === undefined) {
      continue;
    }

    try {
      const env = getEnv();
      const { response, modelCallId } = await callOllama(correctionPrompt(task, completions), {
        host: env.OLLAMA_HOST,
        model: env.OLLAMA_MODEL,
        kind: "correction-extraction",
        format: "json",
      });
      const correction = parseCorrection(response, task.description);
      if (correction.status === "applied") {
        applyCorrection(task.id, correction.text);
        result.applied++;
      }
      attachOutcome(
        modelCallId,
        correction.status === "applied"
          ? "Correction applied."
          : correction.status === "unchanged"
            ? "No Correction needed."
            : "Response could not be parsed; no Correction applied."
      );
      completions.forEach((completion) => markCompletionProcessed(completion.id));
    } catch {
      result.failedTasks++;
    }
  }

  return result;
}

function extractionResultPrefix(result: CorrectionExtractionResult): string {
  if (!result.hadNotes) {
    return "";
  }
  const corrections = `${result.applied} ${result.applied === 1 ? "Correction" : "Corrections"} applied.`;
  if (result.failedTasks === 0) {
    return `${corrections} `;
  }
  return `${corrections} ${result.failedTasks} ${
    result.failedTasks === 1 ? "Task was" : "Tasks were"
  } deferred after extraction failure. `;
}

function completionDigestPrompt(
  task: Task,
  previousDigest: string | undefined,
  completions: Completion[]
): string {
  const completionLines = completions
    .map(
      (completion) =>
        `- completed ${completion.completedDate} | note: "${completion.note ?? "(none)"}"`
    )
    .join("\n");

  return [
    "You maintain a short rolling Completion Digest for a recurring Task.",
    "Rewrite one complete summary that preserves useful long-run patterns from the previous Digest and these ageing-out Completions.",
    "The raw Completion records are about to be deleted, so retain anything worth carrying forward.",
    "Respond with JSON only in exactly this shape: {\"summary\": \"rolling summary\"}.",
    "Keep the summary concise and do not mention that you are summarising records.",
    "",
    `Task id: ${task.id}`,
    `Task description: "${task.description}"`,
    `Previous Completion Digest: ${previousDigest === undefined ? "(none)" : `"${previousDigest}"`}`,
    "Ageing-out Completions:",
    completionLines,
  ].join("\n");
}

function parseCompletionDigest(response: string): string | undefined {
  const json = extractJsonObject(response);
  if (json === undefined) {
    return undefined;
  }

  try {
    const summary = (JSON.parse(json) as { summary?: unknown }).summary;
    return typeof summary === "string" && summary.trim() ? summary.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Rewrites and deletes each Task's eligible Completion batch independently. */
async function compactCompletions(tasks: Task[]): Promise<CompletionCompactionResult> {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const digestsByTask = getCompletionDigestSummariesByTask();
  const result: CompletionCompactionResult = { tasksCompacted: 0, completionsFolded: 0 };

  for (const [taskId, completions] of listCompactionEligibleCompletionsByTask()) {
    const task = tasksById.get(taskId);
    if (task === undefined) {
      continue;
    }

    try {
      const env = getEnv();
      const { response, modelCallId } = await callOllama(
        completionDigestPrompt(task, digestsByTask.get(taskId), completions),
        {
          host: env.OLLAMA_HOST,
          model: env.OLLAMA_MODEL,
          kind: "completion-digest",
          format: "json",
        }
      );
      const summary = parseCompletionDigest(response);
      if (summary === undefined) {
        attachOutcome(modelCallId, "Response could not be parsed; no Completion Digest was written.");
        continue;
      }

      replaceCompletionDigestAndDeleteCompletions(
        taskId,
        summary,
        completions.map((completion) => completion.id)
      );
      result.tasksCompacted++;
      result.completionsFolded += completions.length;
      attachOutcome(modelCallId, `Completion Digest written; ${completions.length} Completions folded.`);
    } catch {
      // A failed Task remains entirely intact and will be retried on the next Planner run.
    }
  }

  return result;
}

function compactionResultSuffix(result: CompletionCompactionResult): string {
  if (result.tasksCompacted === 0) {
    return "";
  }
  return ` ${result.tasksCompacted} ${
    result.tasksCompacted === 1 ? "Task was" : "Tasks were"
  } compacted; ${result.completionsFolded} ${
    result.completionsFolded === 1 ? "Completion was" : "Completions were"
  } folded into Completion Digests.`;
}

/**
 * Generates this week's Weekly Plan when none exists. An existing plan is revised only after new
 * Completion or Correction feedback has arrived since the Planner last wrote it.
 */
export async function runPlannerOnce(): Promise<void> {
  if (runInFlight) {
    touchPlannerHeartbeat(getCurrentTime().toISOString());
    return;
  }

  runInFlight = true;
  let extraction: CorrectionExtractionResult = { applied: 0, failedTasks: 0, hadNotes: false };
  let compaction: CompletionCompactionResult = { tasksCompacted: 0, completionsFolded: 0 };
  const recordResult = (status: "ok" | "error", result: string, planWritten = false) => {
    if (
      status === "ok" &&
      extraction.applied === 0 &&
      compaction.tasksCompacted === 0 &&
      !planWritten
    ) {
      return;
    }
    createPlannerRun({
      ranAt: getCurrentTime().toISOString(),
      status,
      result: `${extractionResultPrefix(extraction)}${result}${compactionResultSuffix(compaction)}`,
    });
  };

  try {
    touchPlannerHeartbeat(getCurrentTime().toISOString());
    const now = getCurrentTime();
    const weekStart = currentWeekStart(now);
    extraction = await extractCorrections(listTasks());
    compaction = await compactCompletions(listTasks());
    const tasks = listTasks();
    const existingPlan = getWeeklyPlanByWeek(weekStart);
    if (existingPlan && !hasCompletionsSince(existingPlan.revisedAt) && !hasCorrectionsSince(existingPlan.revisedAt)) {
      recordResult("ok", `Week ${weekStart} already planned.`);
      return;
    }

    const dates = weekDates(weekStart);
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
        recordResult("ok", `Week ${weekStart} has nothing due.`);
        return;
      }

      createWeeklyPlanWithActivities(
        weekStart,
        fixedPlacements.map(({ activity }) => activity)
      );
      recordResult(
        "ok",
        `Planned week ${weekStart}: ${fixedPlacements.length} Scheduled and 0 model-placed Planned Activities.`,
        true
      );
      return;
    }

    if (existingPlan && flexibleTasks.length === 0) {
      recordResult("ok", `Week ${weekStart} already planned.`);
      return;
    }

    const today = formatLocalDate(now);
    const lastCompletionDates = getLatestCompletionDatesByTask();
    const completionDigests = getCompletionDigestSummariesByTask();
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
          completionDigests,
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
          lastCompletionDates,
          completionDigests
        );

    const env = getEnv();
    const { response, modelCallId } = await callOllama(prompt, {
      host: env.OLLAMA_HOST,
      model: env.OLLAMA_MODEL,
      kind: existingPlan ? "plan-revision" : "plan-generation",
      format: "json",
    });

    const parsedActivities = parsePlannedActivities(
      response,
      new Set(flexibleTasks.map((task) => task.id)),
      new Set(existingPlan ? dates.filter((date) => date >= today) : dates),
      new Set(frozenActivities.map((activity) => `${activity.taskId}:${activity.date}`))
    );

    if (parsedActivities === undefined) {
      attachOutcome(modelCallId, "Response could not be parsed; 0 Planned Activities written.");
      recordResult("error", `Ollama returned no usable response for week ${weekStart}.`);
      return;
    }

    const { activities, deferred } = applyTimeBudget(
      parsedActivities.activities,
      flexibleTasks,
      timeBudgetMinutes,
      frozenActivities
    );

    if (existingPlan) {
      replaceRevisablePlannedActivities(existingPlan.id, today, activities);
      attachOutcome(modelCallId, planOutcome(parsedActivities, deferred, activities.length));
      recordResult(
        "ok",
        `Revised week ${weekStart} from ${today}: ${activities.length} Planned ${
          activities.length === 1 ? "Activity" : "Activities"
        }.${deferredResultSuffix(deferred)}`,
        true
      );
      return;
    }

    const plannedActivities = [...fixedPlacements.map(({ activity }) => activity), ...activities];
    if (plannedActivities.length === 0) {
      attachOutcome(modelCallId, planOutcome(parsedActivities, deferred, 0));
      recordResult(
        "ok",
        `Week ${weekStart} has nothing due.${deferredResultSuffix(deferred)}`
      );
      return;
    }

    createWeeklyPlanWithActivities(weekStart, plannedActivities);
    attachOutcome(modelCallId, planOutcome(parsedActivities, deferred, activities.length));
    recordResult(
      "ok",
      `Planned week ${weekStart}: ${fixedPlacements.length} Scheduled and ${activities.length} model-placed Planned Activities.${deferredResultSuffix(deferred)}`,
      true
    );
  } catch (error) {
    recordResult("error", error instanceof Error ? error.message : String(error));
  } finally {
    runInFlight = false;
  }
}
