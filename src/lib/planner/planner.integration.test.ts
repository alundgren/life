import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { recordCompletion } from "@/lib/db/completion";
import { runMigrations } from "@/lib/db/migrate";
import { listPlannedActivitiesForPlan } from "@/lib/db/plannedActivity";
import { createFlexibleTask, createScheduledTask, listTasks } from "@/lib/db/task";
import { setTimeBudget } from "@/lib/db/timeBudget";
import { getWeeklyPlanByWeek } from "@/lib/db/weeklyPlan";
import { runPlannerOnce } from "./planner";

const describeRealOllama =
  process.env.RUN_REAL_OLLAMA_PLANNER_TESTS === "1" ? describe : describe.skip;

describeRealOllama("planner real Ollama integration", () => {
  beforeEach(() => {
    process.env.SQLITE_DB_PATH ??= "/tmp/life-planner-integration-unused.db";
    process.env.OLLAMA_HOST ??= "http://localhost:11434";
    process.env.OLLAMA_MODEL ??= "qwen2.5:3b";

    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
    setTimeBudget("work", 120);
  });

  afterEach(() => {
    resetDb();
  });

  it("generates an internally consistent Weekly Plan with the configured local model", async () => {
    createScheduledTask({
      description: "Board climbing and strength",
      weekday: 2,
      startTime: "16:00",
      endTime: "18:00",
      recurrenceIntervalWeeks: 1,
    });
    createScheduledTask({
      description: "Slab technique session",
      weekday: 4,
      startTime: "16:00",
      endTime: "18:00",
      recurrenceIntervalWeeks: 1,
    });
    const bathroom = createFlexibleTask({
      description: "Clean bathroom",
      frequencyText: "about every three weeks",
      durationMinutes: 30,
    });
    createFlexibleTask({
      description: "Do laundry",
      frequencyText: "weekly",
      durationMinutes: 15,
    });
    recordCompletion({ taskId: bathroom.id, completedDate: "2026-07-01" });

    await runPlannerOnce();

    const today = new Date();
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const weekStartDate = [
      monday.getFullYear(),
      String(monday.getMonth() + 1).padStart(2, "0"),
      String(monday.getDate()).padStart(2, "0"),
    ].join("-");
    const weekDates = new Set(
      Array.from({ length: 7 }, (_, offset) => {
        const day = new Date(monday);
        day.setDate(monday.getDate() + offset);
        return [
          day.getFullYear(),
          String(day.getMonth() + 1).padStart(2, "0"),
          String(day.getDate()).padStart(2, "0"),
        ].join("-");
      })
    );
    const taskIds = new Set(listTasks().map((task) => task.id));
    const plan = getWeeklyPlanByWeek(weekStartDate);
    expect(plan).toBeDefined();

    const activities = listPlannedActivitiesForPlan(plan!.id);
    expect(activities.length).toBeGreaterThan(0);
    for (const activity of activities) {
      expect(taskIds.has(activity.taskId)).toBe(true);
      expect(weekDates.has(activity.date)).toBe(true);
    }
  });
});
