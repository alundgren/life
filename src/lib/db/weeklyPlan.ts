import { getDb } from "@/lib/db/client";

export interface WeeklyPlan {
  id: number;
  weekStartDate: string;
  createdAt: string;
  updatedAt: string;
}

interface WeeklyPlanRow {
  id: number;
  week_start_date: string;
  created_at: string;
  updated_at: string;
}

function rowToWeeklyPlan(row: WeeklyPlanRow): WeeklyPlan {
  return {
    id: row.id,
    weekStartDate: row.week_start_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Creates a Weekly Plan for a given week. week_start_date is unique — one plan per week. */
export function createWeeklyPlan(weekStartDate: string): WeeklyPlan {
  getDb().prepare("INSERT INTO weekly_plan (week_start_date) VALUES (?)").run(weekStartDate);
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
  const insertPlan = db.prepare("INSERT INTO weekly_plan (week_start_date) VALUES (?)");
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

export function getWeeklyPlanByWeek(weekStartDate: string): WeeklyPlan | undefined {
  const row = getDb()
    .prepare(
      "SELECT id, week_start_date, created_at, updated_at FROM weekly_plan WHERE week_start_date = ?"
    )
    .get(weekStartDate) as WeeklyPlanRow | undefined;
  return row ? rowToWeeklyPlan(row) : undefined;
}
