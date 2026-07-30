import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import {
  createFlexibleTask,
  createScheduledTask,
  getTaskById,
  listTasks,
  taskDurationMinutes,
  updateFlexibleTask,
  updateScheduledTask,
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
      .prepare("SELECT COUNT(*) as count FROM task_scheduled WHERE task_id = @taskId")
      .get({ taskId: scheduled.id }) as { count: number };
    const flexibleChildCount = getDb()
      .prepare("SELECT COUNT(*) as count FROM task_flexible WHERE task_id = @taskId")
      .get({ taskId: flexible.id }) as { count: number };
    const scheduledHasFlexibleChild = getDb()
      .prepare("SELECT COUNT(*) as count FROM task_flexible WHERE task_id = @taskId")
      .get({ taskId: scheduled.id }) as { count: number };
    const flexibleHasScheduledChild = getDb()
      .prepare("SELECT COUNT(*) as count FROM task_scheduled WHERE task_id = @taskId")
      .get({ taskId: flexible.id }) as { count: number };

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

    getDb().prepare("DELETE FROM task WHERE id = @id").run({ id: task.id });

    const childCount = getDb()
      .prepare("SELECT COUNT(*) as count FROM task_scheduled WHERE task_id = @taskId")
      .get({ taskId: task.id }) as { count: number };
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

  it("updates a Scheduled Task's fields and reads back the updated typed form", () => {
    const created = createScheduledTask({
      description: "Strength training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });

    const updated = updateScheduledTask(created.id, {
      description: "Mobility work",
      weekday: 4,
      startTime: "07:00",
      endTime: "07:45",
      recurrenceIntervalWeeks: 2,
    });

    expect(updated).toBeDefined();
    expect(updated).toEqual(getTaskById(created.id));
    if (updated?.kind !== "scheduled") {
      throw new Error("expected a scheduled task");
    }
    expect(updated.kind).toBe("scheduled");
    expect(updated.description).toBe("Mobility work");
    expect(updated.weekday).toBe(4);
    expect(updated.startTime).toBe("07:00");
    expect(updated.endTime).toBe("07:45");
    expect(updated.recurrenceIntervalWeeks).toBe(2);
  });

  it("updates a Flexible Task's fields and reads back the updated typed form", () => {
    const created = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    const updated = updateFlexibleTask(created.id, {
      description: "Wash the car",
      frequencyText: "roughly monthly",
      durationMinutes: 30,
    });

    expect(updated).toBeDefined();
    expect(updated).toEqual(getTaskById(created.id));
    if (updated?.kind !== "flexible") {
      throw new Error("expected a flexible task");
    }
    expect(updated.kind).toBe("flexible");
    expect(updated.description).toBe("Wash the car");
    expect(updated.frequencyText).toBe("roughly monthly");
    expect(updated.durationMinutes).toBe(30);
  });

  it("updates the parent task row and its scheduled child row together", () => {
    const created = createScheduledTask({
      description: "Training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });

    updateScheduledTask(created.id, {
      description: "Renamed",
      weekday: 5,
      startTime: "08:00",
      endTime: "09:00",
      recurrenceIntervalWeeks: 3,
    });

    const parent = getDb()
      .prepare("SELECT description FROM task WHERE id = @id")
      .get({ id: created.id }) as { description: string };
    const child = getDb()
      .prepare("SELECT weekday, recurrence_interval_weeks FROM task_scheduled WHERE task_id = @taskId")
      .get({ taskId: created.id }) as { weekday: number; recurrence_interval_weeks: number };

    expect(parent.description).toBe("Renamed");
    expect(child.weekday).toBe(5);
    expect(child.recurrence_interval_weeks).toBe(3);
  });

  it("returns undefined when updating a non-existent id, writing nothing", () => {
    expect(
      updateScheduledTask(999, {
        description: "Ghost",
        weekday: 1,
        startTime: "09:00",
        endTime: "10:00",
        recurrenceIntervalWeeks: 1,
      })
    ).toBeUndefined();
    expect(
      updateFlexibleTask(999, {
        description: "Ghost",
        frequencyText: "monthly",
        durationMinutes: 30,
      })
    ).toBeUndefined();
    expect(listTasks()).toHaveLength(0);
  });

  it("rejects a wrong-kind update without touching the stored Task", () => {
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

    // Flexible update against a Scheduled id, and vice versa: both refuse.
    expect(
      updateFlexibleTask(scheduled.id, {
        description: "Hijacked",
        frequencyText: "weekly",
        durationMinutes: 10,
      })
    ).toBeUndefined();
    expect(
      updateScheduledTask(flexible.id, {
        description: "Hijacked",
        weekday: 0,
        startTime: "00:00",
        endTime: "01:00",
        recurrenceIntervalWeeks: 1,
      })
    ).toBeUndefined();

    // Stored values are untouched.
    expect(getTaskById(scheduled.id)).toEqual(scheduled);
    expect(getTaskById(flexible.id)).toEqual(flexible);
    // No stray child rows were written into the other kind's table.
    const scheduledStrayChild = getDb()
      .prepare("SELECT COUNT(*) as count FROM task_flexible WHERE task_id = @taskId")
      .get({ taskId: scheduled.id }) as { count: number };
    const flexibleStrayChild = getDb()
      .prepare("SELECT COUNT(*) as count FROM task_scheduled WHERE task_id = @taskId")
      .get({ taskId: flexible.id }) as { count: number };
    expect(scheduledStrayChild.count).toBe(0);
    expect(flexibleStrayChild.count).toBe(0);
  });
});
