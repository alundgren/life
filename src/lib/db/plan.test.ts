import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import {
  addPlannedActivity,
  createWeeklyPlan,
  getWeeklyPlanByWeek,
  listPlannedActivitiesForPlan,
  listUnprocessedCompletions,
  markCompletionProcessed,
  recordCompletion,
  updatePlannedActivityStatus,
  upsertCompletionDigest,
} from "./plan";
import { createFlexibleTask, createScheduledTask } from "./task";

describe("plan and completion data access", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("creates a Weekly Plan and adds Planned Activities to it", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "monthly",
      durationMinutes: 45,
    });

    const activity = addPlannedActivity({
      weeklyPlanId: plan.id,
      taskId: task.id,
      date: "2026-07-21",
    });

    expect(getWeeklyPlanByWeek("2026-07-20")).toEqual(plan);
    expect(activity.status).toBe("pending");
    expect(listPlannedActivitiesForPlan(plan.id)).toEqual([activity]);
  });

  it("enforces one Weekly Plan per week", () => {
    createWeeklyPlan("2026-07-20");

    expect(() => createWeeklyPlan("2026-07-20")).toThrow();
  });

  it("updates Planned Activity status", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Water plants",
      frequencyText: "weekly",
      durationMinutes: 10,
    });
    const activity = addPlannedActivity({
      weeklyPlanId: plan.id,
      taskId: task.id,
      date: "2026-07-21",
    });

    const done = updatePlannedActivityStatus(activity.id, "done");

    expect(done.status).toBe("done");
    expect(listPlannedActivitiesForPlan(plan.id)[0].status).toBe("done");
  });

  it("joins a Scheduled Task's slot while Flexible Tasks have no slot", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const scheduled = createScheduledTask({
      description: "Strength training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });
    const flexible = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "monthly",
      durationMinutes: 45,
    });

    addPlannedActivity({
      weeklyPlanId: plan.id,
      taskId: scheduled.id,
      date: "2026-07-21",
    });
    addPlannedActivity({
      weeklyPlanId: plan.id,
      taskId: flexible.id,
      date: "2026-07-22",
    });

    const activities = listPlannedActivitiesForPlan(plan.id);
    const scheduledActivity = activities.find((activity) => activity.taskId === scheduled.id)!;
    const flexibleActivity = activities.find((activity) => activity.taskId === flexible.id)!;

    expect(scheduledActivity.taskKind).toBe("scheduled");
    expect(scheduledActivity.scheduledWeekday).toBe(2);
    expect(scheduledActivity.scheduledStartTime).toBe("16:00");
    expect(scheduledActivity.scheduledEndTime).toBe("19:00");
    expect(scheduledActivity.scheduledRecurrenceIntervalWeeks).toBe(1);
    expect(flexibleActivity.taskKind).toBe("flexible");
    expect(flexibleActivity.scheduledWeekday).toBeNull();
    expect(flexibleActivity.scheduledStartTime).toBeNull();
    expect(flexibleActivity.scheduledEndTime).toBeNull();
    expect(flexibleActivity.scheduledRecurrenceIntervalWeeks).toBeNull();
  });

  it("records standalone and linked Completions", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "monthly",
      durationMinutes: 45,
    });
    const activity = addPlannedActivity({
      weeklyPlanId: plan.id,
      taskId: task.id,
      date: "2026-07-21",
    });

    const standalone = recordCompletion({
      taskId: task.id,
      completedDate: "2026-07-20",
      note: "Done early",
    });
    const linked = recordCompletion({
      taskId: task.id,
      plannedActivityId: activity.id,
      completedDate: "2026-07-21",
    });

    expect(standalone.plannedActivityId).toBeNull();
    expect(standalone.note).toBe("Done early");
    expect(linked.plannedActivityId).toBe(activity.id);
    expect(linked.note).toBeNull();
  });

  it("sets a linked Completion's planned_activity_id to null when the Planned Activity is deleted", () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "monthly",
      durationMinutes: 45,
    });
    const activity = addPlannedActivity({
      weeklyPlanId: plan.id,
      taskId: task.id,
      date: "2026-07-21",
    });
    const completion = recordCompletion({
      taskId: task.id,
      plannedActivityId: activity.id,
      completedDate: "2026-07-21",
    });

    getDb().prepare("DELETE FROM planned_activity WHERE id = ?").run(activity.id);

    const row = getDb()
      .prepare("SELECT planned_activity_id FROM completion WHERE id = ?")
      .get(completion.id) as { planned_activity_id: number | null };
    expect(row.planned_activity_id).toBeNull();
  });

  it("lists only unprocessed Completions", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "monthly",
      durationMinutes: 45,
    });
    const first = recordCompletion({
      taskId: task.id,
      completedDate: "2026-07-20",
      note: "First",
    });
    const second = recordCompletion({
      taskId: task.id,
      completedDate: "2026-07-21",
      note: "Second",
    });

    markCompletionProcessed(first.id);

    expect(listUnprocessedCompletions()).toEqual([second]);
  });

  it("keeps one Completion Digest per Task", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "monthly",
      durationMinutes: 45,
    });

    const first = upsertCompletionDigest(task.id, "First summary");
    const second = upsertCompletionDigest(task.id, "Updated summary");

    expect(first.taskId).toBe(task.id);
    expect(second.taskId).toBe(task.id);
    expect(second.summary).toBe("Updated summary");

    const count = getDb()
      .prepare("SELECT COUNT(*) as count FROM completion_digest WHERE task_id = ?")
      .get(task.id) as { count: number };
    expect(count.count).toBe(1);
  });
});
