import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import { createFlexibleTask } from "./task";
import { createWeeklyPlan } from "./weeklyPlan";
import { addPlannedActivity } from "./plannedActivity";
import {
  getLatestCompletionDatesByTask,
  hasCompletionsSince,
  listCompletionsForDateRange,
  listUnprocessedCompletions,
  markCompletionProcessed,
  recordCompletion,
} from "./completion";

describe("completion data access", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("records a standalone Completion with no Planned Activity", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    const completion = recordCompletion({ taskId: task.id, completedDate: "2026-07-21" });

    expect(completion.taskId).toBe(task.id);
    expect(completion.plannedActivityId).toBeUndefined();
    expect(completion.note).toBeUndefined();
    expect(completion.processedAt).toBeUndefined();
  });

  it("records a Completion linked to a Planned Activity, with a note", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const plan = createWeeklyPlan("2026-07-20");
    const activity = addPlannedActivity({ weeklyPlanId: plan.id, taskId: task.id, date: "2026-07-21" });

    const completion = recordCompletion({
      taskId: task.id,
      completedDate: "2026-07-21",
      plannedActivityId: activity.id,
      note: "Took longer than expected",
    });

    expect(completion.plannedActivityId).toBe(activity.id);
    expect(completion.note).toBe("Took longer than expected");
  });

  it("sets planned_activity_id to null when the linked Planned Activity is deleted", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const plan = createWeeklyPlan("2026-07-20");
    const activity = addPlannedActivity({ weeklyPlanId: plan.id, taskId: task.id, date: "2026-07-21" });
    const completion = recordCompletion({
      taskId: task.id,
      completedDate: "2026-07-21",
      plannedActivityId: activity.id,
    });

    getDb().prepare("DELETE FROM planned_activity WHERE id = ?").run(activity.id);

    const row = getDb()
      .prepare("SELECT planned_activity_id FROM completion WHERE id = ?")
      .get(completion.id) as { planned_activity_id: number | null };
    expect(row.planned_activity_id).toBeNull();
  });

  it("filters to only unprocessed Completions", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const first = recordCompletion({ taskId: task.id, completedDate: "2026-07-21" });
    const second = recordCompletion({ taskId: task.id, completedDate: "2026-07-22" });

    markCompletionProcessed(first.id);

    const unprocessed = listUnprocessedCompletions();
    expect(unprocessed.map((c) => c.id)).toEqual([second.id]);
  });

  it("marks a Completion processed with a processed_at timestamp", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const completion = recordCompletion({ taskId: task.id, completedDate: "2026-07-21" });

    markCompletionProcessed(completion.id);

    const row = getDb()
      .prepare("SELECT processed_at FROM completion WHERE id = ?")
      .get(completion.id) as { processed_at: string | null };
    expect(row.processed_at).not.toBeNull();
  });

  it("reports the most recent Completion date per Task, omitting Tasks never completed", () => {
    const cleaned = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const neverDone = createFlexibleTask({
      description: "Descale the kettle",
      frequencyText: "about twice a year",
      durationMinutes: 20,
    });
    recordCompletion({ taskId: cleaned.id, completedDate: "2026-07-21" });
    recordCompletion({ taskId: cleaned.id, completedDate: "2026-06-30" });

    const latest = getLatestCompletionDatesByTask();

    expect(latest.get(cleaned.id)).toBe("2026-07-21");
    expect(latest.has(neverDone.id)).toBe(false);
  });

  it("finds Completions at the inclusive Planner watermark and reads a week's Completions", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const completion = recordCompletion({
      taskId: task.id,
      completedDate: "2026-07-29",
      note: "Finished early",
    });
    getDb()
      .prepare("UPDATE completion SET created_at = ? WHERE id = ?")
      .run("2026-07-29 12:00:00", completion.id);

    expect(hasCompletionsSince("2026-07-29 12:00:00")).toBe(true);
    expect(hasCompletionsSince("2026-07-29 12:00:01")).toBe(false);
    expect(listCompletionsForDateRange("2026-07-27", "2026-08-02").map((item) => item.note)).toEqual([
      "Finished early",
    ]);
  });

  it("cascades delete to Completions when the Task is deleted", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    recordCompletion({ taskId: task.id, completedDate: "2026-07-21" });

    getDb().prepare("DELETE FROM task WHERE id = ?").run(task.id);

    const remaining = getDb()
      .prepare("SELECT COUNT(*) as count FROM completion WHERE task_id = ?")
      .get(task.id) as { count: number };
    expect(remaining.count).toBe(0);
  });
});
