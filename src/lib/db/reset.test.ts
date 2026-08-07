import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "./client";
import { applyCorrection } from "./correction";
import { recordCompletion } from "./completion";
import { upsertCompletionDigest } from "./completionDigest";
import { runMigrations } from "./migrate";
import { createModelCall } from "./modelCall";
import { getMode, setMode } from "./mode";
import { touchPlannerHeartbeat } from "./plannerHeartbeat";
import { createPlannerRun } from "./plannerRun";
import { resetAllData } from "./reset";
import { createFlexibleTask } from "./task";
import { getTimeBudget, setTimeBudget } from "./timeBudget";
import { createWeeklyPlanWithActivities } from "./weeklyPlan";

function tableCount(table: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
    .count;
}

describe("resetAllData", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("empties every domain table seeded with data", () => {
    const task = createFlexibleTask({
      description: "Vacuum",
      frequencyText: "weekly",
      durationMinutes: 20,
    });
    applyCorrection(task.id, "Vacuum the whole flat");
    const completion = recordCompletion({ taskId: task.id, completedDate: "2026-07-20" });
    upsertCompletionDigest(task.id, "Usually done on Sundays");
    createWeeklyPlanWithActivities("2026-07-20", [{ taskId: task.id, date: "2026-07-21" }]);
    createModelCall({
      calledAt: "2026-07-20T10:00:00.000Z",
      kind: "plan-generation",
      model: "test-model",
      requestText: "prompt",
      responseText: "{}",
      status: "ok",
      durationMs: 10,
    });
    createPlannerRun({ ranAt: "2026-07-20T10:00:00.000Z", status: "ok", result: "did stuff" });
    touchPlannerHeartbeat("2026-07-20T10:00:00.000Z");
    getDb().prepare("INSERT INTO simulated_clock (id, now) VALUES (1, @now)").run({
      now: "2026-07-20T10:00:00.000Z",
    });
    setMode("vacation");
    setTimeBudget("work", 240);
    setTimeBudget("vacation", 900);
    expect(completion.id).toBeGreaterThan(0);

    resetAllData();

    for (const table of [
      "task",
      "task_scheduled",
      "task_flexible",
      "correction",
      "completion",
      "completion_digest",
      "weekly_plan",
      "planned_activity",
      "model_call",
      "planner_run",
      "planner_heartbeat",
      "simulated_clock",
    ]) {
      expect(tableCount(table)).toBe(0);
    }
  });

  it("restores Mode and Time Budgets to their migration-seeded defaults", () => {
    setMode("vacation");
    setTimeBudget("work", 240);
    setTimeBudget("vacation", 900);

    resetAllData();

    expect(getMode()).toBe("work");
    expect(getTimeBudget("work")).toBe(180);
    expect(getTimeBudget("vacation")).toBe(600);
  });

  it("leaves schema_migrations untouched", () => {
    const before = tableCount("schema_migrations");

    resetAllData();

    expect(tableCount("schema_migrations")).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it("is a no-op-safe operation to run against an already-empty database", () => {
    resetAllData();
    resetAllData();

    expect(getMode()).toBe("work");
    expect(getTimeBudget("work")).toBe(180);
  });
});
