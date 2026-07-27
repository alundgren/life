import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { recordCompletion } from "@/lib/db/completion";
import { setMode } from "@/lib/db/mode";
import { listPlannedActivitiesForPlan } from "@/lib/db/plannedActivity";
import { createFlexibleTask, createScheduledTask } from "@/lib/db/task";
import { setTimeBudget } from "@/lib/db/timeBudget";
import { createWeeklyPlanWithActivities, getWeeklyPlanByWeek } from "@/lib/db/weeklyPlan";

vi.mock("@/lib/ollama/client", () => ({
  callOllama: vi.fn(),
}));

import { callOllama } from "@/lib/ollama/client";
import { getPlannerStatus, runPlannerOnce, startPlanner, stopPlanner } from "./planner";

const callOllamaMock = vi.mocked(callOllama);

function seedDb() {
  vi.stubEnv("SQLITE_DB_PATH", "/tmp/unused.db");
  vi.stubEnv("OLLAMA_HOST", "http://localhost:11434");
  vi.stubEnv("OLLAMA_MODEL", "test-model");
  const db = createDbClient(":memory:");
  runMigrations(db);
  setDb(db);
  callOllamaMock.mockReset();
}

describe("planner lifecycle", () => {
  beforeEach(seedDb);

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

  it("marks the planner running immediately and runs once right away", async () => {
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    startPlanner(1000);

    expect(getPlannerStatus().running).toBe(true);
    await vi.waitFor(() => expect(callOllamaMock).toHaveBeenCalledTimes(1));
  });

  it("stops scheduling further runs after stop", async () => {
    vi.useFakeTimers();
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(0);
    stopPlanner();
    expect(getPlannerStatus().running).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(callOllamaMock).toHaveBeenCalledTimes(1);
  });

  it("runs again on each interval tick while running", async () => {
    vi.useFakeTimers();
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(callOllamaMock).toHaveBeenCalledTimes(3);
  });

  it("does not start a second interval when already running", async () => {
    vi.useFakeTimers();
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(0);
    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(callOllamaMock).toHaveBeenCalledTimes(2);
  });
});

describe("weekly plan generation", () => {
  // Wednesday, so the week being planned is Monday 2026-07-27 through Sunday 2026-08-02.
  const WEEK_START = "2026-07-27";

  function createTraining() {
    return createScheduledTask({
      description: "Bouldering: board and strength",
      weekday: 2,
      startTime: "16:00",
      endTime: "18:00",
      recurrenceIntervalWeeks: 1,
    });
  }

  function createLaundry() {
    return createFlexibleTask({
      description: "Do the laundry",
      frequencyText: "about every week",
      durationMinutes: 15,
    });
  }

  beforeEach(() => {
    seedDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0));
  });

  afterEach(() => {
    stopPlanner();
    resetDb();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("creates a Weekly Plan for the current week with a Pending Planned Activity per entry", async () => {
    const training = createTraining();
    const laundry = createLaundry();
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: training.id, date: "2026-07-28" },
          { taskId: laundry.id, date: "2026-07-31" },
        ],
      })
    );

    await runPlannerOnce();

    const plan = getWeeklyPlanByWeek(WEEK_START);
    expect(plan).toBeDefined();
    const activities = listPlannedActivitiesForPlan(plan!.id);
    expect(activities.map((a) => [a.taskId, a.date, a.status])).toEqual([
      [training.id, "2026-07-28", "pending"],
      [laundry.id, "2026-07-31", "pending"],
    ]);

    const status = getPlannerStatus();
    expect(status.lastStatus).toBe("ok");
    expect(status.lastResult).toBe("Planned week 2026-07-27: 2 Planned Activities.");
  });

  it("carries a Scheduled Task's time slot and leaves a Flexible Task day-level", async () => {
    const training = createTraining();
    const laundry = createLaundry();
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: training.id, date: "2026-07-28" },
          { taskId: laundry.id, date: "2026-07-31" },
        ],
      })
    );

    await runPlannerOnce();

    const activities = listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id);
    const scheduled = activities.find((a) => a.taskId === training.id)!;
    const flexible = activities.find((a) => a.taskId === laundry.id)!;
    expect([scheduled.startTime, scheduled.endTime]).toEqual(["16:00", "18:00"]);
    expect([flexible.startTime, flexible.endTime]).toEqual([undefined, undefined]);
  });

  it("asks Ollama for JSON, for the week being planned", async () => {
    createLaundry();
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    await runPlannerOnce();

    expect(callOllamaMock).toHaveBeenCalledWith(expect.any(String), {
      host: "http://localhost:11434",
      model: "test-model",
      format: "json",
    });

    const prompt = callOllamaMock.mock.calls[0][0];
    expect(prompt).toContain(WEEK_START);
    expect(prompt).toContain("2026-08-02");
  });

  it("tells Ollama the Mode, the Time Budget, and each Task's description and Duration", async () => {
    setMode("vacation");
    setTimeBudget("vacation", 600);
    createTraining();
    createLaundry();
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    await runPlannerOnce();

    const prompt = callOllamaMock.mock.calls[0][0];
    expect(prompt).toContain("vacation");
    expect(prompt).toContain("600 minutes");
    expect(prompt).toContain("Bouldering: board and strength");
    expect(prompt).toContain("120 minutes");
    expect(prompt).toContain("Do the laundry");
    expect(prompt).toContain("15 minutes");
    expect(prompt).toContain("about every week");
  });

  it("tells Ollama when each Flexible Task was last completed", async () => {
    const laundry = createLaundry();
    createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    recordCompletion({ taskId: laundry.id, completedDate: "2026-07-20" });
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    await runPlannerOnce();

    const prompt = callOllamaMock.mock.calls[0][0];
    expect(prompt).toContain("last completed 2026-07-20");
    expect(prompt).toContain("never completed");
  });

  it("reads a plan out of a response wrapped in prose and a code fence", async () => {
    const laundry = createLaundry();
    callOllamaMock.mockResolvedValue(
      'Sure! Here is your week:\n```json\n{"activities": [{"taskId": ' +
        laundry.id +
        ', "date": "2026-07-30"}]}\n```\nHope that helps.'
    );

    await runPlannerOnce();

    const activities = listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id);
    expect(activities.map((a) => a.date)).toEqual(["2026-07-30"]);
  });

  it("drops unknown Tasks, bad dates, dates outside the week and duplicates, keeping the rest", async () => {
    const laundry = createLaundry();
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: laundry.id, date: "2026-07-30" },
          { taskId: 9999, date: "2026-07-30" },
          { taskId: laundry.id, date: "not-a-date" },
          { taskId: laundry.id, date: "2026-08-05" },
          { taskId: laundry.id, date: "2026-07-30" },
          { taskId: laundry.id, date: "2026-07-31" },
        ],
      })
    );

    await runPlannerOnce();

    const activities = listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id);
    expect(activities.map((a) => a.date)).toEqual(["2026-07-30", "2026-07-31"]);
  });

  it("records an error and writes nothing when no entry survives validation", async () => {
    createLaundry();
    callOllamaMock.mockResolvedValue("I am afraid I cannot help with that.");

    await runPlannerOnce();

    expect(getWeeklyPlanByWeek(WEEK_START)).toBeUndefined();
    const status = getPlannerStatus();
    expect(status.lastStatus).toBe("error");
    expect(status.lastResult).toContain("no usable");
  });

  it("records the error message and leaves other weeks' plans alone when Ollama fails", async () => {
    const laundry = createLaundry();
    const lastWeek = createWeeklyPlanWithActivities("2026-07-20", [
      { taskId: laundry.id, date: "2026-07-22" },
    ]);
    callOllamaMock.mockRejectedValue(new Error("connection refused"));

    await runPlannerOnce();

    expect(getWeeklyPlanByWeek(WEEK_START)).toBeUndefined();
    expect(listPlannedActivitiesForPlan(lastWeek.id)).toHaveLength(1);
    const status = getPlannerStatus();
    expect(status.lastStatus).toBe("error");
    expect(status.lastResult).toBe("connection refused");
  });

  it("skips a week that already has a Weekly Plan without calling Ollama", async () => {
    const laundry = createLaundry();
    callOllamaMock.mockResolvedValue(
      JSON.stringify({ activities: [{ taskId: laundry.id, date: "2026-07-30" }] })
    );

    await runPlannerOnce();
    const planned = listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id);

    await runPlannerOnce();

    expect(callOllamaMock).toHaveBeenCalledTimes(1);
    expect(listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id)).toEqual(planned);
    const status = getPlannerStatus();
    expect(status.lastStatus).toBe("ok");
    expect(status.lastResult).toBe("Week 2026-07-27 already planned.");
  });

  it("does not throw when no Tasks are defined", async () => {
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    await expect(runPlannerOnce()).resolves.toBeUndefined();
    expect(getWeeklyPlanByWeek(WEEK_START)).toBeUndefined();
  });
});
