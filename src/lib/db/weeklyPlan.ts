import { getDb } from "@/lib/db/client";
import type { AddPlannedActivityInput } from "@/lib/db/plannedActivity";

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

export interface CreateWeeklyPlanWithActivitiesInput {
  weekStartDate: string;
  activities: Omit<AddPlannedActivityInput, "weeklyPlanId">[];
}

/** Creates a Weekly Plan and all of its Planned Activities atomically. */
export function createWeeklyPlanWithActivities(
  input: CreateWeeklyPlanWithActivitiesInput
): WeeklyPlan {
  const db = getDb();
  const insertPlan = db.prepare("INSERT INTO weekly_plan (week_start_date) VALUES (?)");
  const insertActivity = db.prepare(
    `INSERT INTO planned_activity (weekly_plan_id, task_id, date, status)
     VALUES (?, ?, ?, ?)`
  );

  const planId = db.transaction(() => {
    const result = insertPlan.run(input.weekStartDate);
    const id = Number(result.lastInsertRowid);
    for (const activity of input.activities) {
      insertActivity.run(id, activity.taskId, activity.date, activity.status ?? "pending");
    }
    return id;
  })();

  const plan = getWeeklyPlanByWeek(input.weekStartDate);
  if (!plan || plan.id !== planId) {
    throw new Error("Created Weekly Plan could not be read back.");
  }
  return plan;
}

export function getWeeklyPlanByWeek(weekStartDate: string): WeeklyPlan | undefined {
  const row = getDb()
    .prepare(
      "SELECT id, week_start_date, created_at, updated_at FROM weekly_plan WHERE week_start_date = ?"
    )
    .get(weekStartDate) as WeeklyPlanRow | undefined;
  return row ? rowToWeeklyPlan(row) : undefined;
}
