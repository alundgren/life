import { getDb } from "@/lib/db/client";
import { getCurrentTime } from "@/lib/simulatedClock";

export type PlannedActivityStatus = "pending" | "done" | "missed";

export interface PlannedActivity {
  id: number;
  weeklyPlanId: number;
  taskId: number;
  date: string;
  status: PlannedActivityStatus;
  createdAt: string;
  /** A Scheduled Task's slot, read via join to task_scheduled; undefined for a Flexible Task. */
  startTime: string | undefined;
  endTime: string | undefined;
}

export interface AddPlannedActivityInput {
  weeklyPlanId: number;
  taskId: number;
  date: string;
  status?: PlannedActivityStatus;
}

interface PlannedActivityRow {
  id: number;
  weekly_plan_id: number;
  task_id: number;
  date: string;
  status: PlannedActivityStatus;
  created_at: string;
  start_time: string | null;
  end_time: string | null;
}

const SELECT_PLANNED_ACTIVITY_SQL = `
  SELECT
    pa.id, pa.weekly_plan_id, pa.task_id, pa.date, pa.status, pa.created_at,
    ts.start_time, ts.end_time
  FROM planned_activity pa
  LEFT JOIN task_scheduled ts ON ts.task_id = pa.task_id
`;

function rowToPlannedActivity(row: PlannedActivityRow): PlannedActivity {
  return {
    id: row.id,
    weeklyPlanId: row.weekly_plan_id,
    taskId: row.task_id,
    date: row.date,
    status: row.status,
    createdAt: row.created_at,
    startTime: row.start_time ?? undefined,
    endTime: row.end_time ?? undefined,
  };
}

/** Adds a Planned Activity to a Weekly Plan and bumps the plan's updated_at (mid-week revision, ADR-0001). */
export function addPlannedActivity(input: AddPlannedActivityInput): PlannedActivity {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO planned_activity (weekly_plan_id, task_id, date, status, created_at)
     VALUES (@weeklyPlanId, @taskId, @date, @status, @createdAt)`
  );
  const touchPlan = db.prepare("UPDATE weekly_plan SET updated_at = @updatedAt WHERE id = @weeklyPlanId");

  const id = db.transaction(() => {
    const now = getCurrentTime().toISOString();
    const result = insert.run({ ...input, status: input.status ?? "pending", createdAt: now });
    touchPlan.run({ weeklyPlanId: input.weeklyPlanId, updatedAt: now });
    return Number(result.lastInsertRowid);
  })();

  return getPlannedActivityById(id)!;
}

/** Updates a Planned Activity's status and bumps its plan's updated_at (mid-week revision, ADR-0001). */
export function updatePlannedActivityStatus(id: number, status: PlannedActivityStatus): void {
  const db = getDb();
  const update = db.prepare("UPDATE planned_activity SET status = @status WHERE id = @id");
  const touchPlan = db.prepare(
    `UPDATE weekly_plan SET updated_at = @updatedAt
     WHERE id = (SELECT weekly_plan_id FROM planned_activity WHERE id = @id)`
  );

  db.transaction(() => {
    update.run({ id, status });
    touchPlan.run({ id, updatedAt: getCurrentTime().toISOString() });
  })();
}

export function getPlannedActivityById(id: number): PlannedActivity | undefined {
  const row = getDb()
    .prepare(`${SELECT_PLANNED_ACTIVITY_SQL} WHERE pa.id = @id`)
    .get({ id }) as PlannedActivityRow | undefined;
  return row ? rowToPlannedActivity(row) : undefined;
}

/** A Weekly Plan's Planned Activities, in date order. */
export function listPlannedActivitiesForPlan(planId: number): PlannedActivity[] {
  const rows = getDb()
    .prepare(`${SELECT_PLANNED_ACTIVITY_SQL} WHERE pa.weekly_plan_id = @planId ORDER BY pa.date, pa.id`)
    .all({ planId }) as PlannedActivityRow[];
  return rows.map(rowToPlannedActivity);
}

/** Planned Activities in an inclusive date range, with timed Scheduled Tasks before day-level Flexible Tasks. */
export function listPlannedActivitiesForDateRange(startDate: string, endDate: string): PlannedActivity[] {
  const rows = getDb()
    .prepare(
      `${SELECT_PLANNED_ACTIVITY_SQL}
       WHERE pa.date >= @startDate AND pa.date <= @endDate
       ORDER BY
         pa.date,
         CASE WHEN ts.start_time IS NULL THEN 1 ELSE 0 END,
         ts.start_time,
         pa.id`
    )
    .all({ startDate, endDate }) as PlannedActivityRow[];
  return rows.map(rowToPlannedActivity);
}
