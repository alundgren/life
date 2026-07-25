/**
 * PROTOTYPE — throwaway code for issue #6 (Planner: weekly plan generation).
 *
 * Question being answered: issue #6 hasn't been built yet (planner.ts is still an Ollama
 * heartbeat stub). Before wiring the real LLM call, does the *shape* of weekly-plan
 * generation hold up against two real scenarios — a 4-session bouldering training plan
 * (all Scheduled Tasks) and a chores list (all Flexible Tasks, 2h/week Time Budget)?
 * Specifically: do Scheduled Tasks land on their fixed weekday/time every week regardless
 * of budget; do Flexible Tasks come "due" correctly from their recurrence relative to when
 * they were last completed; and when due Flexible Tasks' durations exceed the Time Budget,
 * does a least-urgent-first cut leave a sensible one off the plan (per CONTEXT.md: left off
 * entirely, never Missed) instead of falling over? A `group` tag (not a real domain concept)
 * lets the TUI show either scenario alone or both combined.
 *
 * No I/O here — pure data + pure functions only. The TUI shell (scripts/prototype-weekly-plan.ts)
 * is the only thing allowed to touch a terminal.
 */

export type ScenarioGroup = "training" | "chores";

interface TaskDefBase {
  id: string;
  group: ScenarioGroup;
  description: string;
}

export interface ScheduledTaskDef extends TaskDefBase {
  kind: "scheduled";
  /** 0 = Sunday .. 6 = Saturday, matching src/lib/db/task.ts. */
  weekday: number;
  startTime: string;
  endTime: string;
  recurrenceIntervalWeeks: number;
}

export interface FlexibleTaskDef extends TaskDefBase {
  kind: "flexible";
  frequencyText: string;
  durationMinutes: number;
  /**
   * Prototype stand-in for what the real Planner's LLM would infer from `frequencyText`
   * each run (ADR-0002: a Flexible Task's frequency is re-interpreted, not stored structured).
   */
  intervalWeeks: number;
}

export type TaskDef = ScheduledTaskDef | FlexibleTaskDef;

export type PlannedActivityStatus = "pending" | "done" | "missed";

export interface PlannedActivity {
  taskId: string;
  date: string;
  status: PlannedActivityStatus;
  startTime?: string;
  endTime?: string;
}

export interface SkippedFlexibleTask {
  taskId: string;
  weeksOverdue: number;
}

export interface WeeklyPlan {
  weekStartDate: string;
  activities: PlannedActivity[];
  /** Due Flexible Tasks left off this week because the Time Budget ran out — never Missed. */
  skipped: SkippedFlexibleTask[];
  budgetMinutes: number;
  budgetUsedMinutes: number;
}

export interface PlannerState {
  weekStartDate: string;
  tasks: TaskDef[];
  enabledGroups: Record<ScenarioGroup, boolean>;
  budgetMinutes: number;
  /** Flexible task id -> ISO date it was last marked Done. Drives due-ness. */
  lastCompletedDate: Record<string, string>;
  currentPlan: WeeklyPlan;
  /** Finalized past weeks, most recent first. */
  history: WeeklyPlan[];
}

const WEEK_ZERO = "2026-07-27"; // a Monday; anchor for Scheduled Task recurrence

const TASKS: TaskDef[] = [
  {
    id: "train-tue",
    group: "training",
    kind: "scheduled",
    description: "Board climbing — strength focus",
    weekday: 2,
    startTime: "16:00",
    endTime: "18:00",
    recurrenceIntervalWeeks: 1,
  },
  {
    id: "train-thu",
    group: "training",
    kind: "scheduled",
    description: "Slab climbing — technique focus",
    weekday: 4,
    startTime: "16:00",
    endTime: "18:00",
    recurrenceIntervalWeeks: 1,
  },
  {
    id: "train-sat",
    group: "training",
    kind: "scheduled",
    description: "General climbing + pressing strength + stretching",
    weekday: 6,
    startTime: "10:00",
    endTime: "13:00",
    recurrenceIntervalWeeks: 1,
  },
  {
    id: "train-sun",
    group: "training",
    kind: "scheduled",
    description: "General climbing + pulling strength + stretching",
    weekday: 0,
    startTime: "10:00",
    endTime: "13:00",
    recurrenceIntervalWeeks: 1,
  },
  {
    id: "chore-bathroom",
    group: "chores",
    kind: "flexible",
    description: "Clean the bathroom",
    frequencyText: "every 3 weeks",
    durationMinutes: 30,
    intervalWeeks: 3,
  },
  {
    id: "chore-kitchen",
    group: "chores",
    kind: "flexible",
    description: "Clean the kitchen",
    frequencyText: "every 3 weeks",
    durationMinutes: 30,
    intervalWeeks: 3,
  },
  {
    id: "chore-bedroom",
    group: "chores",
    kind: "flexible",
    description: "Clean the bedroom + switch out bedclothes",
    frequencyText: "every 3 weeks",
    durationMinutes: 30,
    intervalWeeks: 3,
  },
  {
    id: "chore-laundry",
    group: "chores",
    kind: "flexible",
    description: "Wash clothes",
    frequencyText: "every week",
    durationMinutes: 15,
    intervalWeeks: 1,
  },
];

const DEFAULT_BUDGET_MINUTES = 120; // "budget 2 hours per week" — Flexible Tasks only

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weeksBetween(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

function scheduledDate(weekStartDate: string, weekday: number): string {
  const mondayOffset = weekday === 0 ? 6 : weekday - 1;
  return addDays(weekStartDate, mondayOffset);
}

export function activeTasks(state: Pick<PlannerState, "tasks" | "enabledGroups">): TaskDef[] {
  return state.tasks.filter((t) => state.enabledGroups[t.group]);
}

/**
 * Builds a Weekly Plan from scratch for `weekStartDate`, given which Tasks are active, the
 * Time Budget, and Flexible Task due-tracking. `locked` activities (already Done/Missed) are
 * kept verbatim and never reconsidered — mirrors ADR-0001: the Planner only revises Pending
 * Planned Activities within the current week.
 */
export function generatePlan(
  active: TaskDef[],
  weekStartDate: string,
  budgetMinutes: number,
  lastCompletedDate: Record<string, string>,
  locked: PlannedActivity[] = []
): WeeklyPlan {
  const lockedTaskIds = new Set(locked.map((a) => a.taskId));
  const activities: PlannedActivity[] = [...locked];

  for (const task of active) {
    if (task.kind !== "scheduled" || lockedTaskIds.has(task.id)) continue;
    const weeksSinceAnchor = weeksBetween(WEEK_ZERO, weekStartDate);
    if (weeksSinceAnchor % task.recurrenceIntervalWeeks !== 0) continue;
    activities.push({
      taskId: task.id,
      date: scheduledDate(weekStartDate, task.weekday),
      status: "pending",
      startTime: task.startTime,
      endTime: task.endTime,
    });
  }

  const lockedFlexibleMinutes = locked.reduce((sum, a) => {
    const task = active.find((t) => t.id === a.taskId);
    return task?.kind === "flexible" ? sum + task.durationMinutes : sum;
  }, 0);

  const dueFlexible = active
    .filter((t): t is FlexibleTaskDef => t.kind === "flexible" && !lockedTaskIds.has(t.id))
    .map((task) => {
      const last = lastCompletedDate[task.id];
      const weeksSinceLast = last ? weeksBetween(last, weekStartDate) : Number.POSITIVE_INFINITY;
      return { task, weeksOverdue: weeksSinceLast - task.intervalWeeks };
    })
    .filter((d) => d.weeksOverdue >= 0)
    .sort((a, b) => b.weeksOverdue - a.weeksOverdue || a.task.id.localeCompare(b.task.id));

  const skipped: SkippedFlexibleTask[] = [];
  let remainingBudget = budgetMinutes - lockedFlexibleMinutes;

  for (const { task, weeksOverdue } of dueFlexible) {
    if (task.durationMinutes <= remainingBudget) {
      activities.push({ taskId: task.id, date: weekStartDate, status: "pending" });
      remainingBudget -= task.durationMinutes;
    } else {
      skipped.push({ taskId: task.id, weeksOverdue });
    }
  }

  return {
    weekStartDate,
    activities,
    skipped,
    budgetMinutes,
    budgetUsedMinutes: budgetMinutes - remainingBudget,
  };
}

export function initialState(): PlannerState {
  const enabledGroups: Record<ScenarioGroup, boolean> = { training: true, chores: true };
  const base = { tasks: TASKS, enabledGroups };
  return {
    weekStartDate: WEEK_ZERO,
    tasks: TASKS,
    enabledGroups,
    budgetMinutes: DEFAULT_BUDGET_MINUTES,
    lastCompletedDate: {},
    currentPlan: generatePlan(activeTasks(base), WEEK_ZERO, DEFAULT_BUDGET_MINUTES, {}),
    history: [],
  };
}

/** Freezes the current week (any still-Pending activity becomes Missed) and plans the next one. */
export function tick(state: PlannerState): PlannerState {
  const finalized: WeeklyPlan = {
    ...state.currentPlan,
    activities: state.currentPlan.activities.map((a) =>
      a.status === "pending" ? { ...a, status: "missed" } : a
    ),
  };
  const nextWeekStart = addDays(state.weekStartDate, 7);
  return {
    ...state,
    weekStartDate: nextWeekStart,
    currentPlan: generatePlan(
      activeTasks(state),
      nextWeekStart,
      state.budgetMinutes,
      state.lastCompletedDate
    ),
    history: [finalized, ...state.history],
  };
}

/** Cycles a current-week activity's status pending -> done -> missed -> pending. */
export function cycleActivityStatus(state: PlannerState, taskId: string): PlannerState {
  const next: Record<PlannedActivityStatus, PlannedActivityStatus> = {
    pending: "done",
    done: "missed",
    missed: "pending",
  };

  let becameDone = false;
  const activities = state.currentPlan.activities.map((a) => {
    if (a.taskId !== taskId) return a;
    const status = next[a.status];
    if (status === "done") becameDone = true;
    return { ...a, status };
  });

  const lastCompletedDate = becameDone
    ? { ...state.lastCompletedDate, [taskId]: state.weekStartDate }
    : state.lastCompletedDate;

  return { ...state, currentPlan: { ...state.currentPlan, activities }, lastCompletedDate };
}

function regenerateCurrentWeek(state: PlannerState): PlannerState {
  const locked = state.currentPlan.activities.filter((a) => a.status !== "pending");
  return {
    ...state,
    currentPlan: generatePlan(
      activeTasks(state),
      state.weekStartDate,
      state.budgetMinutes,
      state.lastCompletedDate,
      locked
    ),
  };
}

export function setBudget(state: PlannerState, budgetMinutes: number): PlannerState {
  return regenerateCurrentWeek({ ...state, budgetMinutes: Math.max(0, budgetMinutes) });
}

export function toggleGroup(state: PlannerState, group: ScenarioGroup): PlannerState {
  return regenerateCurrentWeek({
    ...state,
    enabledGroups: { ...state.enabledGroups, [group]: !state.enabledGroups[group] },
  });
}

export function findTask(state: PlannerState, taskId: string): TaskDef | undefined {
  return state.tasks.find((t) => t.id === taskId);
}
