import { getDb } from "@/lib/db/client";

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
  getDb()
    .prepare("INSERT INTO weekly_plan (week_start_date, revised_at) VALUES (?, datetime('now'))")
    .run(weekStartDate);
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
    "INSERT INTO weekly_plan (week_start_date, revised_at) VALUES (?, datetime('now'))"
  );
  const insertActivity = db.prepare(
    `INSERT INTO planned_activity (weekly_plan_id, task_id, date, status)
     VALUES (?, ?, ?, 'pending')`
  );

  db.transaction(() => {
    const planId = Number(insertPlan.run(weekStartDate).lastInsertRowid);
    for (const activity of activities) {
      insertActivity.run(planId, activity.taskId, activity.date);
    }
  })();

  return getWeeklyPlanByWeek(weekStartDate)!;
}

/**
 * Replaces only a plan's pending Planned Activities from `fromDate` onward. Done, missed and
 * past-dated activities remain untouched. The activities and Planner watermark change together.
 */
export function replaceRevisablePlannedActivities(
  weeklyPlanId: number,
  fromDate: string,
  activities: NewPlannedActivity[]
): void {
  const db = getDb();
  const deleteActivities = db.prepare(
    `DELETE FROM planned_activity
     WHERE weekly_plan_id = ? AND status = 'pending' AND date >= ?`
  );
  const insertActivity = db.prepare(
    `INSERT INTO planned_activity (weekly_plan_id, task_id, date, status)
     VALUES (?, ?, ?, 'pending')`
  );
  const stampPlan = db.prepare(
    `UPDATE weekly_plan
     SET revised_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`
  );

  db.transaction(() => {
    deleteActivities.run(weeklyPlanId, fromDate);
    for (const activity of activities) {
      insertActivity.run(weeklyPlanId, activity.taskId, activity.date);
    }
    stampPlan.run(weeklyPlanId);
  })();
}

export function getWeeklyPlanByWeek(weekStartDate: string): WeeklyPlan | undefined {
  const row = getDb()
    .prepare(
      `SELECT id, week_start_date, created_at, updated_at, revised_at
       FROM weekly_plan WHERE week_start_date = ?`
    )
    .get(weekStartDate) as WeeklyPlanRow | undefined;
  return row ? rowToWeeklyPlan(row) : undefined;
}
