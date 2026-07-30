import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import { createFlexibleTask, createScheduledTask } from "./task";
import { createWeeklyPlan, getWeeklyPlanByWeek } from "./weeklyPlan";
import { addPlannedActivity, listPlannedActivitiesForPlan, updatePlannedActivityStatus } from "./plannedActivity";

describe("planned activity data access", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("adds Planned Activities to a Weekly Plan and lists them back", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    const activity = addPlannedActivity({ weeklyPlanId: plan.id, taskId: task.id, date: "2026-07-21" });

    expect(activity.status).toBe("pending");
    expect(activity.date).toBe("2026-07-21");

    const activities = listPlannedActivitiesForPlan(plan.id);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toEqual(activity);
  });

  it("transitions a Planned Activity's status from pending to done", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const activity = addPlannedActivity({ weeklyPlanId: plan.id, taskId: task.id, date: "2026-07-21" });

    updatePlannedActivityStatus(activity.id, "done");

    const [updated] = listPlannedActivitiesForPlan(plan.id);
    expect(updated.status).toBe("done");
  });

  it("transitions a Planned Activity's status from pending to missed", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const activity = addPlannedActivity({ weeklyPlanId: plan.id, taskId: task.id, date: "2026-07-21" });

    updatePlannedActivityStatus(activity.id, "missed");

    const [updated] = listPlannedActivitiesForPlan(plan.id);
    expect(updated.status).toBe("missed");
  });

  it("joins in a Scheduled Task's slot but leaves a Flexible Task's slot unset", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const scheduledTask = createScheduledTask({
      description: "Training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });
    const flexibleTask = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    addPlannedActivity({ weeklyPlanId: plan.id, taskId: scheduledTask.id, date: "2026-07-21" });
    addPlannedActivity({ weeklyPlanId: plan.id, taskId: flexibleTask.id, date: "2026-07-22" });

    const activities = listPlannedActivitiesForPlan(plan.id);
    const scheduledActivity = activities.find((a) => a.taskId === scheduledTask.id)!;
    const flexibleActivity = activities.find((a) => a.taskId === flexibleTask.id)!;

    expect(scheduledActivity.startTime).toBe("16:00");
    expect(scheduledActivity.endTime).toBe("19:00");
    expect(flexibleActivity.startTime).toBeUndefined();
    expect(flexibleActivity.endTime).toBeUndefined();
  });

  it("bumps the Weekly Plan's updated_at when a Planned Activity is added", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    getDb()
      .prepare("UPDATE weekly_plan SET updated_at = '2000-01-01T00:00:00Z' WHERE id = @id")
      .run({ id: plan.id });

    addPlannedActivity({ weeklyPlanId: plan.id, taskId: task.id, date: "2026-07-21" });

    expect(getWeeklyPlanByWeek("2026-07-20")?.updatedAt).not.toBe("2000-01-01T00:00:00Z");
  });

  it("bumps the Weekly Plan's updated_at when a Planned Activity's status changes", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const activity = addPlannedActivity({ weeklyPlanId: plan.id, taskId: task.id, date: "2026-07-21" });

    getDb()
      .prepare("UPDATE weekly_plan SET updated_at = '2000-01-01T00:00:00Z' WHERE id = @id")
      .run({ id: plan.id });

    updatePlannedActivityStatus(activity.id, "done");

    expect(getWeeklyPlanByWeek("2026-07-20")?.updatedAt).not.toBe("2000-01-01T00:00:00Z");
  });

  it("cascades delete to Planned Activities when the Weekly Plan is deleted", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    addPlannedActivity({ weeklyPlanId: plan.id, taskId: task.id, date: "2026-07-21" });

    getDb().prepare("DELETE FROM weekly_plan WHERE id = @id").run({ id: plan.id });

    expect(listPlannedActivitiesForPlan(plan.id)).toHaveLength(0);
  });

  it("cascades delete to Planned Activities when the Task is deleted", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    addPlannedActivity({ weeklyPlanId: plan.id, taskId: task.id, date: "2026-07-21" });

    getDb().prepare("DELETE FROM task WHERE id = @id").run({ id: task.id });

    expect(listPlannedActivitiesForPlan(plan.id)).toHaveLength(0);
  });
});
