import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import { createFlexibleTask } from "./task";
import { listPlannedActivitiesForPlan } from "./plannedActivity";
import { createWeeklyPlan, createWeeklyPlanWithActivities, getWeeklyPlanByWeek } from "./weeklyPlan";

describe("weekly plan data access", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("creates a Weekly Plan for a given week and reads it back", () => {
    const plan = createWeeklyPlan("2026-07-20");

    expect(plan.weekStartDate).toBe("2026-07-20");
    expect(getWeeklyPlanByWeek("2026-07-20")).toEqual(plan);
  });

  it("is undefined for a week with no Weekly Plan", () => {
    expect(getWeeklyPlanByWeek("2026-07-20")).toBeUndefined();
  });

  it("rejects a second Weekly Plan for the same week", () => {
    createWeeklyPlan("2026-07-20");
    expect(() => createWeeklyPlan("2026-07-20")).toThrow();
  });

  it("creates a Weekly Plan and its Planned Activities in one transaction", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    const plan = createWeeklyPlanWithActivities({
      weekStartDate: "2026-07-20",
      activities: [{ taskId: task.id, date: "2026-07-21" }],
    });

    expect(getWeeklyPlanByWeek("2026-07-20")).toEqual(plan);
    expect(listPlannedActivitiesForPlan(plan.id)).toMatchObject([
      { taskId: task.id, date: "2026-07-21", status: "pending" },
    ]);
  });

  it("rolls back the Weekly Plan when an activity insert fails", () => {
    expect(() =>
      createWeeklyPlanWithActivities({
        weekStartDate: "2026-07-20",
        activities: [{ taskId: 999, date: "2026-07-21" }],
      })
    ).toThrow();

    expect(getWeeklyPlanByWeek("2026-07-20")).toBeUndefined();
  });
});
