import { getDb } from "@/lib/db/client";
import { getCurrentTime } from "@/lib/simulatedClock";

export interface WeeklyPlan {
  id: number;
  weekStartDate: string;
  createdAt: string;
  updatedAt: string;
  /** The timestamp of the last Planner generation or revision. */
  revisedAt: string;
}

interface WeeklyPlanRow {
  id: number;
  week_start_date: string;
  created_at: string;
  updated_at: string;
  revised_at: string;
}

function rowToWeeklyPlan(row: WeeklyPlanRow): WeeklyPlan {
  return {
    id: row.id,
    weekStartDate: row.week_start_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revisedAt: row.revised_at,
  };
}

/** Creates a Weekly Plan for a given week. week_start_date is unique — one plan per week. */
export function createWeeklyPlan(weekStartDate: string): WeeklyPlan {
  const now = getCurrentTime().toISOString();
  getDb()
    .prepare(
      "INSERT INTO weekly_plan (week_start_date, created_at, updated_at, revised_at) VALUES (@weekStartDate, @createdAt, @updatedAt, @revisedAt)"
    )
    .run({ weekStartDate, createdAt: now, updatedAt: now, revisedAt: now });
  return getWeeklyPlanByWeek(weekStartDate)!;
}

export interface NewPlannedActivity {
  taskId: number;
  date: string;
}

/**
 * Creates a Weekly Plan together with all of its Planned Activities in one transaction, so a
 * generated plan can never be committed half-empty and then look "already generated".
 */
export function createWeeklyPlanWithActivities(
  weekStartDate: string,
  activities: NewPlannedActivity[]
): WeeklyPlan {
  const db = getDb();
  const insertPlan = db.prepare(
    "INSERT INTO weekly_plan (week_start_date, created_at, updated_at, revised_at) VALUES (@weekStartDate, @createdAt, @updatedAt, @revisedAt)"
  );
  const insertActivity = db.prepare(
    `INSERT INTO planned_activity (weekly_plan_id, task_id, date, status, created_at)
     VALUES (@weeklyPlanId, @taskId, @date, 'pending', @createdAt)`
  );

  db.transaction(() => {
    const now = getCurrentTime().toISOString();
    const planId = Number(insertPlan.run({ weekStartDate, createdAt: now, updatedAt: now, revisedAt: now }).lastInsertRowid);
    for (const activity of activities) {
      insertActivity.run({ weeklyPlanId: planId, ...activity, createdAt: now });
    }
  })();

  return getWeeklyPlanByWeek(weekStartDate)!;
}

/**
 * Replaces only a plan's pending Flexible Planned Activities from `fromDate` onward. Scheduled,
 * done, missed and past-dated activities remain untouched. The activities and Planner watermark
 * change together.
 */
export function replaceRevisablePlannedActivities(
  weeklyPlanId: number,
  fromDate: string,
  activities: NewPlannedActivity[]
): void {
  const db = getDb();
  const deleteActivities = db.prepare(
    `DELETE FROM planned_activity
     WHERE weekly_plan_id = @weeklyPlanId AND status = 'pending' AND date >= @fromDate
       AND task_id IN (SELECT task_id FROM task_flexible)`
  );
  const insertActivity = db.prepare(
    `INSERT INTO planned_activity (weekly_plan_id, task_id, date, status, created_at)
     VALUES (@weeklyPlanId, @taskId, @date, 'pending', @createdAt)`
  );
  const stampPlan = db.prepare(
    `UPDATE weekly_plan
     SET revised_at = @revisedAt, updated_at = @updatedAt
     WHERE id = @weeklyPlanId`
  );

  db.transaction(() => {
    const now = getCurrentTime().toISOString();
    deleteActivities.run({ weeklyPlanId, fromDate });
    for (const activity of activities) {
      insertActivity.run({ weeklyPlanId, ...activity, createdAt: now });
    }
    stampPlan.run({ weeklyPlanId, revisedAt: now, updatedAt: now });
  })();
}

export function getWeeklyPlanByWeek(weekStartDate: string): WeeklyPlan | undefined {
  const row = getDb()
    .prepare(
      `SELECT id, week_start_date, created_at, updated_at, revised_at
       FROM weekly_plan WHERE week_start_date = @weekStartDate`
    )
    .get({ weekStartDate }) as WeeklyPlanRow | undefined;
  return row ? rowToWeeklyPlan(row) : undefined;
}
