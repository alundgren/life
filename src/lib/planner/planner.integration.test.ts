import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { listPlannedActivitiesForPlan } from "@/lib/db/plannedActivity";
import { createFlexibleTask, createScheduledTask } from "@/lib/db/task";
import { setTimeBudget } from "@/lib/db/timeBudget";
import { getWeeklyPlanByWeek } from "@/lib/db/weeklyPlan";
import { getPlannerStatus, runPlannerOnce } from "./planner";

// Developer-only: this drives a real Ollama with a real model and is never part of the
// verification gate. It runs only when RUN_OLLAMA_INTEGRATION_TESTS is set, so a stray
// `pnpm test:integration` in an environment without Ollama skips instead of hanging.
const OPTED_IN = Boolean(process.env.RUN_OLLAMA_INTEGRATION_TESTS);
const INFERENCE_TIMEOUT_MS = 180_000;

function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function weekStartDate(now: Date): string {
  return formatLocalDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  );
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return formatLocalDate(new Date(year, month - 1, day + days));
}

describe.skipIf(!OPTED_IN)("weekly plan generation against a real Ollama", () => {
  beforeEach(() => {
    vi.stubEnv("SQLITE_DB_PATH", "/tmp/unused.db");
    vi.stubEnv("OLLAMA_HOST", process.env.OLLAMA_HOST ?? "http://localhost:11434");
    vi.stubEnv("OLLAMA_MODEL", process.env.OLLAMA_MODEL ?? "qwen2.5:3b");
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
    vi.unstubAllEnvs();
  });

  it(
    "produces a Weekly Plan whose Planned Activities are all internally consistent",
    async () => {
      // The developer's real training week and chores list.
      const taskIds = [
        createScheduledTask({
          description: "Bouldering: board and strength",
          weekday: 2,
          startTime: "16:00",
          endTime: "18:00",
          recurrenceIntervalWeeks: 1,
        }),
        createScheduledTask({
          description: "Bouldering: slab and technique",
          weekday: 4,
          startTime: "16:00",
          endTime: "18:00",
          recurrenceIntervalWeeks: 1,
        }),
        createScheduledTask({
          description: "Bouldering: general climbing, pressing, stretching",
          weekday: 6,
          startTime: "10:00",
          endTime: "13:00",
          recurrenceIntervalWeeks: 1,
        }),
        createScheduledTask({
          description: "Bouldering: general climbing, pulling, stretching",
          weekday: 0,
          startTime: "10:00",
          endTime: "13:00",
          recurrenceIntervalWeeks: 1,
        }),
        createFlexibleTask({
          description: "Clean the bathroom",
          frequencyText: "about every three weeks",
          durationMinutes: 30,
        }),
        createFlexibleTask({
          description: "Clean the kitchen",
          frequencyText: "about every three weeks",
          durationMinutes: 30,
        }),
        createFlexibleTask({
          description: "Clean the bedroom and change the bedclothes",
          frequencyText: "about every three weeks",
          durationMinutes: 30,
        }),
        createFlexibleTask({
          description: "Do the laundry",
          frequencyText: "about every week",
          durationMinutes: 15,
        }),
      ].map((task) => task.id);
      setTimeBudget("work", 120);

      await runPlannerOnce();

      const status = getPlannerStatus();
      expect(status.lastStatus, `Planner run failed: ${status.lastResult}`).toBe("ok");

      const weekStart = weekStartDate(new Date());
      const plan = getWeeklyPlanByWeek(weekStart);
      expect(plan).toBeDefined();

      const activities = listPlannedActivitiesForPlan(plan!.id);
      expect(activities.length).toBeGreaterThan(0);

      const weekEnd = addDays(weekStart, 6);
      for (const activity of activities) {
        expect(taskIds).toContain(activity.taskId);
        expect(activity.date >= weekStart).toBe(true);
        expect(activity.date <= weekEnd).toBe(true);
        expect(activity.status).toBe("pending");
      }
    },
    INFERENCE_TIMEOUT_MS
  );
});
