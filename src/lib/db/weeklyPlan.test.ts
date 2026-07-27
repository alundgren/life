import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import { createScheduledTask } from "./task";
import { listPlannedActivitiesForPlan } from "./plannedActivity";
import {
  createWeeklyPlan,
  createWeeklyPlanWithActivities,
  getWeeklyPlanByWeek,
} from "./weeklyPlan";

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

  it("creates a Weekly Plan and its Planned Activities together", () => {
    const task = createScheduledTask({
      description: "Bouldering: board and strength",
      weekday: 2,
      startTime: "16:00",
      endTime: "18:00",
      recurrenceIntervalWeeks: 1,
    });

    const plan = createWeeklyPlanWithActivities("2026-07-20", [
      { taskId: task.id, date: "2026-07-21" },
      { taskId: task.id, date: "2026-07-23" },
    ]);

    expect(plan.weekStartDate).toBe("2026-07-20");
    const activities = listPlannedActivitiesForPlan(plan.id);
    expect(activities.map((a) => a.date)).toEqual(["2026-07-21", "2026-07-23"]);
    expect(activities.every((a) => a.status === "pending")).toBe(true);
  });

  it("leaves no Weekly Plan behind when one of its Planned Activities cannot be written", () => {
    expect(() =>
      createWeeklyPlanWithActivities("2026-07-20", [{ taskId: 999, date: "2026-07-21" }])
    ).toThrow();

    expect(getWeeklyPlanByWeek("2026-07-20")).toBeUndefined();
  });
});
