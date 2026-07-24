import { getDb } from "@/lib/db/client";
import type { TaskKind } from "@/lib/db/task";

export type PlannedActivityStatus = "pending" | "done" | "missed";

export interface WeeklyPlan {
  id: number;
  weekStartDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlannedActivity {
  id: number;
  weeklyPlanId: number;
  taskId: number;
  date: string;
  status: PlannedActivityStatus;
  createdAt: string;
  taskKind: TaskKind;
  taskDescription: string;
  scheduledWeekday: number | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  scheduledRecurrenceIntervalWeeks: number | null;
}

export interface AddPlannedActivityInput {
  weeklyPlanId: number;
  taskId: number;
  date: string;
  status?: PlannedActivityStatus;
}

export interface Completion {
  id: number;
  taskId: number;
  plannedActivityId: number | null;
  completedDate: string;
  note: string | null;
  processedAt: string | null;
  createdAt: string;
}

export interface RecordCompletionInput {
  taskId: number;
  plannedActivityId?: number;
  completedDate: string;
  note?: string;
}

export interface CompletionDigest {
  taskId: number;
  summary: string;
  updatedAt: string;
}

interface WeeklyPlanRow {
  id: number;
  week_start_date: string;
  created_at: string;
  updated_at: string;
}

interface PlannedActivityRow {
  id: number;
  weekly_plan_id: number;
  task_id: number;
  date: string;
  status: PlannedActivityStatus;
  created_at: string;
  task_kind: TaskKind;
  task_description: string;
  scheduled_weekday: number | null;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  scheduled_recurrence_interval_weeks: number | null;
}

interface CompletionRow {
  id: number;
  task_id: number;
  planned_activity_id: number | null;
  completed_date: string;
  note: string | null;
  processed_at: string | null;
  created_at: string;
}

interface CompletionDigestRow {
  task_id: number;
  summary: string;
  updated_at: string;
}

const SELECT_PLANNED_ACTIVITY_SQL = `
  SELECT
    pa.id, pa.weekly_plan_id, pa.task_id, pa.date, pa.status, pa.created_at,
    t.kind as task_kind, t.description as task_description,
    ts.weekday as scheduled_weekday,
    ts.start_time as scheduled_start_time,
    ts.end_time as scheduled_end_time,
    ts.recurrence_interval_weeks as scheduled_recurrence_interval_weeks
  FROM planned_activity pa
  JOIN task t ON t.id = pa.task_id
  LEFT JOIN task_scheduled ts ON ts.task_id = pa.task_id
`;

function rowToWeeklyPlan(row: WeeklyPlanRow): WeeklyPlan {
  return {
    id: row.id,
    weekStartDate: row.week_start_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPlannedActivity(row: PlannedActivityRow): PlannedActivity {
  return {
    id: row.id,
    weeklyPlanId: row.weekly_plan_id,
    taskId: row.task_id,
    date: row.date,
    status: row.status,
    createdAt: row.created_at,
    taskKind: row.task_kind,
    taskDescription: row.task_description,
    scheduledWeekday: row.scheduled_weekday,
    scheduledStartTime: row.scheduled_start_time,
    scheduledEndTime: row.scheduled_end_time,
    scheduledRecurrenceIntervalWeeks: row.scheduled_recurrence_interval_weeks,
  };
}

function rowToCompletion(row: CompletionRow): Completion {
  return {
    id: row.id,
    taskId: row.task_id,
    plannedActivityId: row.planned_activity_id,
    completedDate: row.completed_date,
    note: row.note,
    processedAt: row.processed_at,
    createdAt: row.created_at,
  };
}

function rowToCompletionDigest(row: CompletionDigestRow): CompletionDigest {
  return {
    taskId: row.task_id,
    summary: row.summary,
    updatedAt: row.updated_at,
  };
}

export function createWeeklyPlan(weekStartDate: string): WeeklyPlan {
  const result = getDb()
    .prepare("INSERT INTO weekly_plan (week_start_date) VALUES (?)")
    .run(weekStartDate);
  return getWeeklyPlanById(Number(result.lastInsertRowid))!;
}

export function getWeeklyPlanByWeek(weekStartDate: string): WeeklyPlan | undefined {
  const row = getDb()
    .prepare(
      "SELECT id, week_start_date, created_at, updated_at FROM weekly_plan WHERE week_start_date = ?"
    )
    .get(weekStartDate) as WeeklyPlanRow | undefined;
  return row ? rowToWeeklyPlan(row) : undefined;
}

function getWeeklyPlanById(id: number): WeeklyPlan | undefined {
  const row = getDb()
    .prepare("SELECT id, week_start_date, created_at, updated_at FROM weekly_plan WHERE id = ?")
    .get(id) as WeeklyPlanRow | undefined;
  return row ? rowToWeeklyPlan(row) : undefined;
}

export function addPlannedActivity(input: AddPlannedActivityInput): PlannedActivity {
  const db = getDb();
  const insertActivity = db.prepare(
    "INSERT INTO planned_activity (weekly_plan_id, task_id, date, status) VALUES (?, ?, ?, ?)"
  );
  const touchPlan = db.prepare(
    "UPDATE weekly_plan SET updated_at = datetime('now') WHERE id = ?"
  );

  const activityId = db.transaction(() => {
    const result = insertActivity.run(
      input.weeklyPlanId,
      input.taskId,
      input.date,
      input.status ?? "pending"
    );
    touchPlan.run(input.weeklyPlanId);
    return Number(result.lastInsertRowid);
  })();

  return getPlannedActivityById(activityId)!;
}

export function updatePlannedActivityStatus(
  id: number,
  status: PlannedActivityStatus
): PlannedActivity {
  const db = getDb();
  const row = db
    .prepare("SELECT weekly_plan_id FROM planned_activity WHERE id = ?")
    .get(id) as { weekly_plan_id: number } | undefined;

  if (!row) {
    throw new Error(`Planned Activity ${id} does not exist`);
  }

  db.transaction(() => {
    db.prepare("UPDATE planned_activity SET status = ? WHERE id = ?").run(status, id);
    db.prepare("UPDATE weekly_plan SET updated_at = datetime('now') WHERE id = ?").run(
      row.weekly_plan_id
    );
  })();

  return getPlannedActivityById(id)!;
}

export function listPlannedActivitiesForPlan(planId: number): PlannedActivity[] {
  const rows = getDb()
    .prepare(`${SELECT_PLANNED_ACTIVITY_SQL} WHERE pa.weekly_plan_id = ? ORDER BY pa.date, pa.id`)
    .all(planId) as PlannedActivityRow[];
  return rows.map(rowToPlannedActivity);
}

function getPlannedActivityById(id: number): PlannedActivity | undefined {
  const row = getDb()
    .prepare(`${SELECT_PLANNED_ACTIVITY_SQL} WHERE pa.id = ?`)
    .get(id) as PlannedActivityRow | undefined;
  return row ? rowToPlannedActivity(row) : undefined;
}

export function recordCompletion(input: RecordCompletionInput): Completion {
  const result = getDb()
    .prepare(
      `INSERT INTO completion (task_id, planned_activity_id, completed_date, note)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      input.taskId,
      input.plannedActivityId ?? null,
      input.completedDate,
      input.note ?? null
    );
  return getCompletionById(Number(result.lastInsertRowid))!;
}

export function listUnprocessedCompletions(): Completion[] {
  const rows = getDb()
    .prepare(
      `SELECT id, task_id, planned_activity_id, completed_date, note, processed_at, created_at
       FROM completion
       WHERE processed_at IS NULL
       ORDER BY completed_date ASC, id ASC`
    )
    .all() as CompletionRow[];
  return rows.map(rowToCompletion);
}

export function markCompletionProcessed(id: number): void {
  getDb()
    .prepare("UPDATE completion SET processed_at = datetime('now') WHERE id = ?")
    .run(id);
}

function getCompletionById(id: number): Completion | undefined {
  const row = getDb()
    .prepare(
      `SELECT id, task_id, planned_activity_id, completed_date, note, processed_at, created_at
       FROM completion
       WHERE id = ?`
    )
    .get(id) as CompletionRow | undefined;
  return row ? rowToCompletion(row) : undefined;
}

export function upsertCompletionDigest(taskId: number, summary: string): CompletionDigest {
  getDb()
    .prepare(
      `INSERT INTO completion_digest (task_id, summary)
       VALUES (?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         summary = excluded.summary,
         updated_at = datetime('now')`
    )
    .run(taskId, summary);

  return getCompletionDigest(taskId)!;
}

function getCompletionDigest(taskId: number): CompletionDigest | undefined {
  const row = getDb()
    .prepare("SELECT task_id, summary, updated_at FROM completion_digest WHERE task_id = ?")
    .get(taskId) as CompletionDigestRow | undefined;
  return row ? rowToCompletionDigest(row) : undefined;
}
