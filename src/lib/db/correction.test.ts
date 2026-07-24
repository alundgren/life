import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import { applyCorrection, listCorrections } from "./correction";
import { createFlexibleTask, getTaskById } from "./task";

describe("correction data access", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("applying a Correction updates the Task's description and inserts a correction row", () => {
    const task = createFlexibleTask({
      description: "Do 15 reps",
      frequencyText: "weekly",
      durationMinutes: 30,
    });

    applyCorrection(task.id, "Do 20 reps not 15");

    const updated = getTaskById(task.id);
    expect(updated?.description).toBe("Do 20 reps not 15");

    const corrections = listCorrections(task.id);
    expect(corrections).toHaveLength(1);
    expect(corrections[0].text).toBe("Do 20 reps not 15");
    expect(corrections[0].taskId).toBe(task.id);
  });

  it("keeps the Task's description in sync with the latest of several Corrections", () => {
    const task = createFlexibleTask({
      description: "Original",
      frequencyText: "weekly",
      durationMinutes: 30,
    });

    applyCorrection(task.id, "First correction");
    applyCorrection(task.id, "Second correction");

    expect(getTaskById(task.id)?.description).toBe("Second correction");
  });

  it("lists a Task's Corrections in chronological order", () => {
    const task = createFlexibleTask({
      description: "Original",
      frequencyText: "weekly",
      durationMinutes: 30,
    });

    applyCorrection(task.id, "First correction");
    applyCorrection(task.id, "Second correction");
    applyCorrection(task.id, "Third correction");

    const corrections = listCorrections(task.id);
    expect(corrections.map((c) => c.text)).toEqual([
      "First correction",
      "Second correction",
      "Third correction",
    ]);
  });

  it("cascades delete to Corrections when a Task is deleted", () => {
    const task = createFlexibleTask({
      description: "Original",
      frequencyText: "weekly",
      durationMinutes: 30,
    });
    applyCorrection(task.id, "First correction");

    getDb().prepare("DELETE FROM task WHERE id = ?").run(task.id);

    const remaining = getDb()
      .prepare("SELECT COUNT(*) as count FROM correction WHERE task_id = ?")
      .get(task.id) as { count: number };
    expect(remaining.count).toBe(0);
  });

  it("rejects a Correction for a task_id that doesn't exist", () => {
    expect(() => applyCorrection(999, "orphaned correction")).toThrow();
  });
});
