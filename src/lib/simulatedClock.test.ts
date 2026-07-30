import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "@/lib/db/client";
import { recordCompletion } from "@/lib/db/completion";
import { applyCorrection } from "@/lib/db/correction";
import { runMigrations } from "@/lib/db/migrate";
import { addPlannedActivity } from "@/lib/db/plannedActivity";
import { createFlexibleTask } from "@/lib/db/task";
import { createWeeklyPlan } from "@/lib/db/weeklyPlan";
import { getPlannerStatus, startPlanner, stopPlanner } from "@/lib/planner/planner";
import { advanceSimulatedClock, getCurrentTime } from "./simulatedClock";

describe("Simulated Clock", () => {
  beforeEach(() => {
    vi.stubEnv("SIMULATED_CLOCK", "true");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-02T12:00:00.000Z"));
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    stopPlanner();
    resetDb();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("freezes its first real-time read in the database until advanced", () => {
    expect(getCurrentTime().toISOString()).toBe("2030-01-02T12:00:00.000Z");
    vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
    expect(getCurrentTime().toISOString()).toBe("2030-01-02T12:00:00.000Z");

    expect(advanceSimulatedClock(7).toISOString()).toBe("2030-01-09T12:00:00.000Z");
    expect(getCurrentTime().toISOString()).toBe("2030-01-09T12:00:00.000Z");
  });

  it("stamps domain rows with the simulated timestamp", () => {
    getCurrentTime();
    const task = createFlexibleTask({
      description: "Laundry",
      frequencyText: "weekly",
      durationMinutes: 30,
    });
    applyCorrection(task.id, "Laundry and towels");
    const plan = createWeeklyPlan("2030-01-07");
    const activity = addPlannedActivity({ weeklyPlanId: plan.id, taskId: task.id, date: "2030-01-08" });
    recordCompletion({ taskId: task.id, plannedActivityId: activity.id, completedDate: "2030-01-08" });

    const timestamps = [
      "SELECT created_at AS value FROM task",
      "SELECT created_at AS value FROM correction",
      "SELECT created_at AS value FROM completion",
      "SELECT created_at AS value FROM weekly_plan",
      "SELECT updated_at AS value FROM weekly_plan",
      "SELECT created_at AS value FROM planned_activity",
    ];
    expect(
      timestamps.map((sql) => (getDb().prepare(sql).get() as { value: string }).value)
    ).toEqual(Array(6).fill("2030-01-02T12:00:00.000Z"));
  });

  it("does not start an automatic Planner run", () => {
    startPlanner(1);
    expect(getPlannerStatus().running).toBe(false);
    expect(getPlannerStatus().lastRunAt).toBeNull();
  });
});
