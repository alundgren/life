import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import {
  createFlexibleTask,
  createScheduledTask,
  getTaskById,
  listTasks,
  taskDurationMinutes,
} from "./task";

describe("task data access", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("creates a Scheduled Task and reads it back in typed form", () => {
    const created = createScheduledTask({
      description: "Strength training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });

    expect(created.kind).toBe("scheduled");

    const fetched = getTaskById(created.id);
    expect(fetched).toEqual(created);
    if (fetched?.kind !== "scheduled") {
      throw new Error("expected a scheduled task");
    }
    expect(fetched.weekday).toBe(2);
    expect(fetched.startTime).toBe("16:00");
    expect(fetched.endTime).toBe("19:00");
    expect(fetched.recurrenceIntervalWeeks).toBe(1);
  });

  it("creates a Flexible Task and reads it back in typed form", () => {
    const created = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    expect(created.kind).toBe("flexible");

    const fetched = getTaskById(created.id);
    expect(fetched).toEqual(created);
    if (fetched?.kind !== "flexible") {
      throw new Error("expected a flexible task");
    }
    expect(fetched.frequencyText).toBe("about every three months");
    expect(fetched.durationMinutes).toBe(45);
  });

  it("writes a task row and its matching child row together, never one without the other", () => {
    const scheduled = createScheduledTask({
      description: "Training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });
    const flexible = createFlexibleTask({
      description: "Chore",
      frequencyText: "monthly",
      durationMinutes: 30,
    });

    const scheduledChildCount = getDb()
      .prepare("SELECT COUNT(*) as count FROM task_scheduled WHERE task_id = ?")
      .get(scheduled.id) as { count: number };
    const flexibleChildCount = getDb()
      .prepare("SELECT COUNT(*) as count FROM task_flexible WHERE task_id = ?")
      .get(flexible.id) as { count: number };
    const scheduledHasFlexibleChild = getDb()
      .prepare("SELECT COUNT(*) as count FROM task_flexible WHERE task_id = ?")
      .get(scheduled.id) as { count: number };
    const flexibleHasScheduledChild = getDb()
      .prepare("SELECT COUNT(*) as count FROM task_scheduled WHERE task_id = ?")
      .get(flexible.id) as { count: number };

    expect(scheduledChildCount.count).toBe(1);
    expect(flexibleChildCount.count).toBe(1);
    expect(scheduledHasFlexibleChild.count).toBe(0);
    expect(flexibleHasScheduledChild.count).toBe(0);
  });

  it("lists both kinds of Task", () => {
    createScheduledTask({
      description: "Training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });
    createFlexibleTask({
      description: "Chore",
      frequencyText: "monthly",
      durationMinutes: 30,
    });

    const tasks = listTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.kind).sort()).toEqual(["flexible", "scheduled"]);
  });

  it("derives a Scheduled Task's Duration from end_time − start_time", () => {
    const task = createScheduledTask({
      description: "Training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:30",
      recurrenceIntervalWeeks: 1,
    });

    expect(taskDurationMinutes(task)).toBe(210);
  });

  it("uses a Flexible Task's stored duration_minutes directly", () => {
    const task = createFlexibleTask({
      description: "Chore",
      frequencyText: "monthly",
      durationMinutes: 45,
    });

    expect(taskDurationMinutes(task)).toBe(45);
  });

  it("cascades delete to the child kind-table row when a Task is deleted", () => {
    const task = createScheduledTask({
      description: "Training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });

    getDb().prepare("DELETE FROM task WHERE id = ?").run(task.id);

    const childCount = getDb()
      .prepare("SELECT COUNT(*) as count FROM task_scheduled WHERE task_id = ?")
      .get(task.id) as { count: number };
    expect(childCount.count).toBe(0);
    expect(getTaskById(task.id)).toBeUndefined();
  });

  it("rejects a kind outside 'scheduled' | 'flexible'", () => {
    expect(() =>
      getDb().prepare("INSERT INTO task (kind, description) VALUES ('bogus', 'x')").run()
    ).toThrow();
  });

  it("rejects a weekday outside 0-6", () => {
    expect(() =>
      createScheduledTask({
        description: "Training",
        weekday: 7,
        startTime: "16:00",
        endTime: "19:00",
        recurrenceIntervalWeeks: 1,
      })
    ).toThrow();
  });

  it("rejects a recurrence_interval_weeks below 1", () => {
    expect(() =>
      createScheduledTask({
        description: "Training",
        weekday: 2,
        startTime: "16:00",
        endTime: "19:00",
        recurrenceIntervalWeeks: 0,
      })
    ).toThrow();
  });

  it("rejects a duration_minutes that isn't positive", () => {
    expect(() =>
      createFlexibleTask({
        description: "Chore",
        frequencyText: "monthly",
        durationMinutes: 0,
      })
    ).toThrow();
  });
});
