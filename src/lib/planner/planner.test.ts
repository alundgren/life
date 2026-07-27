import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { recordCompletion } from "@/lib/db/completion";
import { runMigrations } from "@/lib/db/migrate";
import { setMode } from "@/lib/db/mode";
import { listPlannedActivitiesForPlan } from "@/lib/db/plannedActivity";
import { createFlexibleTask, createScheduledTask } from "@/lib/db/task";
import { setTimeBudget } from "@/lib/db/timeBudget";
import {
  createWeeklyPlanWithActivities,
  getWeeklyPlanByWeek,
} from "@/lib/db/weeklyPlan";

vi.mock("@/lib/ollama/client", () => ({
  callOllama: vi.fn(),
}));

import { callOllama } from "@/lib/ollama/client";
import { getPlannerStatus, runPlannerOnce, startPlanner, stopPlanner } from "./planner";

const callOllamaMock = vi.mocked(callOllama);

describe("planner lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00"));
    vi.stubEnv("SQLITE_DB_PATH", "/tmp/unused.db");
    vi.stubEnv("OLLAMA_HOST", "http://localhost:11434");
    vi.stubEnv("OLLAMA_MODEL", "test-model");
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
    callOllamaMock.mockReset();
  });

  afterEach(() => {
    stopPlanner();
    resetDb();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("starts stopped with no recorded runs", () => {
    expect(getPlannerStatus()).toEqual({
      running: false,
      lastRunAt: null,
      lastStatus: null,
      lastResult: null,
    });
  });

  it("creates this week's Weekly Plan from a well-formed Ollama response", async () => {
    const scheduledTask = createScheduledTask({
      description: "Board climbing and strength",
      weekday: 2,
      startTime: "16:00",
      endTime: "18:00",
      recurrenceIntervalWeeks: 1,
    });
    const flexibleTask = createFlexibleTask({
      description: "Laundry",
      frequencyText: "weekly",
      durationMinutes: 15,
    });
    createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    recordCompletion({ taskId: flexibleTask.id, completedDate: "2026-07-20" });
    setMode("vacation");
    setTimeBudget("vacation", 120);
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: scheduledTask.id, date: "2026-07-28" },
          { taskId: flexibleTask.id, date: "2026-07-30" },
        ],
      })
    );

    await runPlannerOnce();

    const plan = getWeeklyPlanByWeek("2026-07-27");
    expect(plan).toBeDefined();
    const activities = listPlannedActivitiesForPlan(plan!.id);
    expect(activities).toMatchObject([
      {
        taskId: scheduledTask.id,
        date: "2026-07-28",
        status: "pending",
        startTime: "16:00",
        endTime: "18:00",
      },
      {
        taskId: flexibleTask.id,
        date: "2026-07-30",
        status: "pending",
        startTime: undefined,
        endTime: undefined,
      },
    ]);

    const status = getPlannerStatus();
    expect(status.lastStatus).toBe("ok");
    expect(status.lastResult).toBe("Planned 2 Planned Activities for week 2026-07-27.");
    expect(status.lastRunAt).not.toBeNull();
    expect(callOllamaMock).toHaveBeenCalledWith(expect.any(String), {
      host: "http://localhost:11434",
      model: "test-model",
      format: "json",
    });

    const prompt = callOllamaMock.mock.calls[0][0];
    expect(prompt).toContain("Week start: 2026-07-27.");
    expect(prompt).toContain("Current Mode: vacation.");
    expect(prompt).toContain("Weekly Time Budget: 120 minutes.");
    expect(prompt).toContain("description=\"Board climbing and strength\"");
    expect(prompt).toContain("durationMinutes=120");
    expect(prompt).toContain("description=\"Laundry\"");
    expect(prompt).toContain("durationMinutes=15");
    expect(prompt).toContain("lastCompleted=2026-07-20");
    expect(prompt).toContain("description=\"Clean the windows\"");
    expect(prompt).toContain("lastCompleted=never completed");
  });

  it("records the error message when the Ollama call fails", async () => {
    callOllamaMock.mockRejectedValue(new Error("connection refused"));

    await runPlannerOnce();

    const status = getPlannerStatus();
    expect(status.lastStatus).toBe("error");
    expect(status.lastResult).toBe("connection refused");
    expect(getWeeklyPlanByWeek("2026-07-27")).toBeUndefined();
  });

  it("parses a JSON response wrapped in prose and a code fence", async () => {
    const task = createFlexibleTask({
      description: "Clean the kitchen",
      frequencyText: "about every three weeks",
      durationMinutes: 30,
    });
    callOllamaMock.mockResolvedValue(
      `Here is the plan:

\`\`\`json
{"activities":[{"taskId":${task.id},"date":"2026-07-31"}]}
\`\`\`

Done.`
    );

    await runPlannerOnce();

    const plan = getWeeklyPlanByWeek("2026-07-27");
    expect(listPlannedActivitiesForPlan(plan!.id)).toMatchObject([
      { taskId: task.id, date: "2026-07-31", status: "pending" },
    ]);
  });

  it("drops invalid and duplicate entries while keeping the valid part of the response", async () => {
    const task = createFlexibleTask({
      description: "Clean the bathroom",
      frequencyText: "about every three weeks",
      durationMinutes: 30,
    });
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: task.id, date: "2026-07-30" },
          { taskId: task.id, date: "2026-07-30" },
          { taskId: 999, date: "2026-07-31" },
          { taskId: task.id, date: "2026/07/31" },
          { taskId: task.id, date: "2026-08-03" },
        ],
      })
    );

    await runPlannerOnce();

    const plan = getWeeklyPlanByWeek("2026-07-27");
    expect(listPlannedActivitiesForPlan(plan!.id)).toMatchObject([
      { taskId: task.id, date: "2026-07-30", status: "pending" },
    ]);
    expect(getPlannerStatus().lastResult).toBe(
      "Planned 1 Planned Activities for week 2026-07-27."
    );
  });

  it("records an error and creates no Weekly Plan when no entries are usable", async () => {
    const task = createFlexibleTask({
      description: "Clean the bathroom",
      frequencyText: "about every three weeks",
      durationMinutes: 30,
    });
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [{ taskId: task.id, date: "2026-08-03" }],
      })
    );

    await runPlannerOnce();

    expect(getPlannerStatus().lastStatus).toBe("error");
    expect(getPlannerStatus().lastResult).toBe(
      "Ollama returned no usable Planned Activities for week 2026-07-27."
    );
    expect(getWeeklyPlanByWeek("2026-07-27")).toBeUndefined();
  });

  it("leaves an existing Weekly Plan untouched when a later run fails", async () => {
    const task = createFlexibleTask({
      description: "Laundry",
      frequencyText: "weekly",
      durationMinutes: 15,
    });
    const existingPlan = createWeeklyPlanWithActivities({
      weekStartDate: "2026-07-20",
      activities: [{ taskId: task.id, date: "2026-07-21" }],
    });
    callOllamaMock.mockRejectedValue(new Error("connection refused"));

    await runPlannerOnce();

    expect(listPlannedActivitiesForPlan(existingPlan.id)).toMatchObject([
      { taskId: task.id, date: "2026-07-21", status: "pending" },
    ]);
  });

  it("skips planning when this week already has a Weekly Plan", async () => {
    const task = createFlexibleTask({
      description: "Laundry",
      frequencyText: "weekly",
      durationMinutes: 15,
    });
    const plan = createWeeklyPlanWithActivities({
      weekStartDate: "2026-07-27",
      activities: [{ taskId: task.id, date: "2026-07-29" }],
    });

    await runPlannerOnce();

    expect(callOllamaMock).not.toHaveBeenCalled();
    expect(getPlannerStatus().lastStatus).toBe("ok");
    expect(getPlannerStatus().lastResult).toBe("Week 2026-07-27 already planned.");
    expect(listPlannedActivitiesForPlan(plan.id)).toHaveLength(1);
  });

  it("runs without throwing when no Tasks are defined", async () => {
    callOllamaMock.mockResolvedValue(JSON.stringify({ activities: [] }));

    await expect(runPlannerOnce()).resolves.toBeUndefined();

    expect(getPlannerStatus().lastStatus).toBe("error");
    expect(callOllamaMock.mock.calls[0][0]).toContain("Tasks:\n- none");
  });

  it("marks the planner running immediately and runs once right away", async () => {
    const task = createFlexibleTask({
      description: "Laundry",
      frequencyText: "weekly",
      durationMinutes: 15,
    });
    callOllamaMock.mockResolvedValue(
      JSON.stringify({ activities: [{ taskId: task.id, date: "2026-07-29" }] })
    );

    startPlanner(1000);

    expect(getPlannerStatus().running).toBe(true);
    await vi.waitFor(() => expect(callOllamaMock).toHaveBeenCalledTimes(1));
  });

  it("stops scheduling further runs after stop", async () => {
    const task = createFlexibleTask({
      description: "Laundry",
      frequencyText: "weekly",
      durationMinutes: 15,
    });
    callOllamaMock.mockResolvedValue(
      JSON.stringify({ activities: [{ taskId: task.id, date: "2026-07-29" }] })
    );

    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(0);
    stopPlanner();
    expect(getPlannerStatus().running).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(callOllamaMock).toHaveBeenCalledTimes(1);
  });

  it("runs again on each interval tick while running", async () => {
    callOllamaMock.mockResolvedValue(JSON.stringify({ activities: [] }));

    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(callOllamaMock).toHaveBeenCalledTimes(3);
  });

  it("does not start a second interval when already running", async () => {
    callOllamaMock.mockResolvedValue(JSON.stringify({ activities: [] }));

    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(0);
    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(callOllamaMock).toHaveBeenCalledTimes(2);
  });
});
