import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import { createFlexibleTask } from "./task";
import { getCompletionDigest, upsertCompletionDigest } from "./completionDigest";

describe("completion digest data access", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("is unset for a Task until a Digest is upserted", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    expect(getCompletionDigest(task.id)).toBeUndefined();
  });

  it("upserts a Task's Completion Digest", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    const digest = upsertCompletionDigest(task.id, "Usually done on Sundays");

    expect(digest.taskId).toBe(task.id);
    expect(digest.summary).toBe("Usually done on Sundays");
  });

  it("keeps at most one Digest per Task, replacing rather than duplicating", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    upsertCompletionDigest(task.id, "First summary");
    upsertCompletionDigest(task.id, "Second summary");

    expect(getCompletionDigest(task.id)?.summary).toBe("Second summary");

    const count = getDb()
      .prepare("SELECT COUNT(*) as count FROM completion_digest WHERE task_id = ?")
      .get(task.id) as { count: number };
    expect(count.count).toBe(1);
  });

  it("cascades delete to the Completion Digest when the Task is deleted", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    upsertCompletionDigest(task.id, "Summary");

    getDb().prepare("DELETE FROM task WHERE id = ?").run(task.id);

    expect(getCompletionDigest(task.id)).toBeUndefined();
  });
});
