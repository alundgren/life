import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import { createFlexibleTask } from "./task";
import { recordCompletion } from "./completion";
import {
  getCompletionDigest,
  getCompletionDigestSummariesByTask,
  replaceCompletionDigestAndDeleteCompletions,
  upsertCompletionDigest,
} from "./completionDigest";

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

  it("rewrites a Digest and deletes the named Completions in one transaction", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const first = recordCompletion({ taskId: task.id, completedDate: "2026-07-01" });
    const second = recordCompletion({ taskId: task.id, completedDate: "2026-07-02" });
    const retained = recordCompletion({ taskId: task.id, completedDate: "2026-07-03" });

    replaceCompletionDigestAndDeleteCompletions(task.id, "Usually done at the weekend", [first.id, second.id]);

    expect(getCompletionDigest(task.id)?.summary).toBe("Usually done at the weekend");
    expect(getDb().prepare("SELECT id FROM completion ORDER BY id").all()).toEqual([{ id: retained.id }]);
    expect(getCompletionDigestSummariesByTask()).toEqual(
      new Map([[task.id, "Usually done at the weekend"]])
    );
  });

  it("rolls back the Digest rewrite when deleting Completions fails", () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const completion = recordCompletion({ taskId: task.id, completedDate: "2026-07-01" });
    upsertCompletionDigest(task.id, "Previous summary");
    getDb().exec(`
      CREATE TRIGGER prevent_completion_delete
      BEFORE DELETE ON completion
      BEGIN
        SELECT RAISE(ABORT, 'delete failed');
      END;
    `);

    expect(() =>
      replaceCompletionDigestAndDeleteCompletions(task.id, "Replacement summary", [completion.id])
    ).toThrow("delete failed");
    expect(getCompletionDigest(task.id)?.summary).toBe("Previous summary");
    expect(getDb().prepare("SELECT id FROM completion WHERE id = ?").get(completion.id)).toEqual({
      id: completion.id,
    });
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
