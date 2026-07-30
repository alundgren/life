import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { createModelCall, listRecentModelCalls } from "@/lib/db/modelCall";
import { setModelCallRecorder } from "@/lib/ollama/client";
import {
  getCompletionById,
  getLatestCompletionDatesByTask,
  markCompletionProcessed,
  recordCompletion,
} from "@/lib/db/completion";
import { getCompletionDigest, upsertCompletionDigest } from "@/lib/db/completionDigest";
import { applyCorrection, listCorrections } from "@/lib/db/correction";
import { setMode } from "@/lib/db/mode";
import {
  listPlannedActivitiesForPlan,
  updatePlannedActivityStatus,
} from "@/lib/db/plannedActivity";
import { createFlexibleTask, createScheduledTask, getTaskById } from "@/lib/db/task";
import { setTimeBudget } from "@/lib/db/timeBudget";
import { createWeeklyPlanWithActivities, getWeeklyPlanByWeek } from "@/lib/db/weeklyPlan";

import { getPlannerStatus, runPlannerOnce, startPlanner, stopPlanner } from "./planner";

// Planner tests use the real Ollama wrapper and stub its HTTP boundary instead of replacing it.
// This keeps every Planner path on the Model Call recording seam.
const callOllamaMock = vi.fn();
const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const response = await callOllamaMock(input, init);
  return { ok: true, json: async () => ({ response }) } as Response;
});

function promptAt(index: number): string {
  const body = callOllamaMock.mock.calls[index][1]?.body as string;
  return (JSON.parse(body) as { prompt: string }).prompt;
}

function seedDb() {
  vi.stubEnv("SQLITE_DB_PATH", "/tmp/unused.db");
  vi.stubEnv("OLLAMA_HOST", "http://localhost:11434");
  vi.stubEnv("OLLAMA_MODEL", "test-model");
  const db = createDbClient(":memory:");
  runMigrations(db);
  setDb(db);
  setModelCallRecorder(createModelCall);
  callOllamaMock.mockReset();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
}

// These cover start/stop/interval only. A Flexible Task keeps each tick on the Ollama path, and
// the mocked empty response writes no Weekly Plan, so the run count measures the loop rather
// than the "already planned" skip.
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
    createFlexibleTask({ description: "Do the laundry", frequencyText: "weekly", durationMinutes: 15 });
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    startPlanner(1000);

    expect(getPlannerStatus().running).toBe(true);
    await vi.waitFor(() => expect(callOllamaMock).toHaveBeenCalledTimes(1));
  });

  it("stops scheduling further runs after stop", async () => {
    vi.useFakeTimers();
    createFlexibleTask({ description: "Do the laundry", frequencyText: "weekly", durationMinutes: 15 });
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
    createFlexibleTask({ description: "Do the laundry", frequencyText: "weekly", durationMinutes: 15 });
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(callOllamaMock).toHaveBeenCalledTimes(3);
  });

  it("does not start a second interval when already running", async () => {
    vi.useFakeTimers();
    createFlexibleTask({ description: "Do the laundry", frequencyText: "weekly", durationMinutes: 15 });
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
    expect(status.lastResult).toBe(
      "Planned week 2026-07-27: 1 Scheduled and 1 model-placed Planned Activities."
    );
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

  it("mechanically places a Scheduled Task in Work Mode even inside assumed-busy hours", async () => {
    const training = createTraining();
    setMode("work");

    await runPlannerOnce();

    const activities = listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id);
    expect(activities.map((activity) => [activity.taskId, activity.date])).toEqual([
      [training.id, "2026-07-28"],
    ]);
    expect([activities[0].startTime, activities[0].endTime]).toEqual(["16:00", "18:00"]);
    expect(callOllamaMock).not.toHaveBeenCalled();
  });

  it("places the same Scheduled Task in Vacation Mode", async () => {
    const training = createTraining();
    setMode("vacation");

    await runPlannerOnce();

    expect(
      listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id).map((activity) => [
        activity.taskId,
        activity.date,
      ])
    ).toEqual([[training.id, "2026-07-28"]]);
    expect(callOllamaMock).not.toHaveBeenCalled();
  });

  it("places a Sunday Scheduled Task on the last day of the Monday-start week", async () => {
    const sundayTask = createScheduledTask({
      description: "Prepare for Monday",
      weekday: 0,
      startTime: "18:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });

    await runPlannerOnce();

    expect(
      listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id).map((activity) => [
        activity.taskId,
        activity.date,
      ])
    ).toEqual([[sundayTask.id, "2026-08-02"]]);
  });

  it("anchors fortnightly Scheduled Tasks to their creation week", async () => {
    const training = createScheduledTask({
      description: "Bouldering: board and strength",
      weekday: 2,
      startTime: "16:00",
      endTime: "18:00",
      recurrenceIntervalWeeks: 2,
    });

    await runPlannerOnce();
    expect(
      listPlannedActivitiesForPlan(getWeeklyPlanByWeek("2026-07-27")!.id).map(
        (activity) => activity.taskId
      )
    ).toEqual([training.id]);

    vi.setSystemTime(new Date(2026, 7, 5, 12, 0, 0));
    await runPlannerOnce();
    expect(getWeeklyPlanByWeek("2026-08-03")).toBeUndefined();

    vi.setSystemTime(new Date(2026, 7, 12, 12, 0, 0));
    await runPlannerOnce();
    expect(
      listPlannedActivitiesForPlan(getWeeklyPlanByWeek("2026-08-10")!.id).map(
        (activity) => activity.taskId
      )
    ).toEqual([training.id]);
    expect(callOllamaMock).not.toHaveBeenCalled();
  });

  it("persists Scheduled placement when Ollama returns a well-formed empty response", async () => {
    const training = createTraining();
    createLaundry();
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    await runPlannerOnce();

    expect(
      listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id).map((activity) => activity.taskId)
    ).toEqual([training.id]);
    expect(getPlannerStatus().lastStatus).toBe("ok");
  });

  it("drops model entries naming Scheduled Tasks while retaining their mechanical placement", async () => {
    const training = createTraining();
    const laundry = createLaundry();
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: training.id, date: "2026-07-31" },
          { taskId: laundry.id, date: "2026-07-31" },
        ],
      })
    );

    await runPlannerOnce();

    expect(
      listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id).map((activity) => [
        activity.taskId,
        activity.date,
      ])
    ).toEqual([
      [training.id, "2026-07-28"],
      [laundry.id, "2026-07-31"],
    ]);
  });

  it("asks Ollama for JSON, for the week being planned", async () => {
    createLaundry();
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    await runPlannerOnce();

    expect(callOllamaMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"model":"test-model"'),
      })
    );

    const prompt = promptAt(0);
    expect(prompt).toContain(WEEK_START);
    expect(prompt).toContain("2026-08-02");
    expect(getWeeklyPlanByWeek(WEEK_START)).toBeUndefined();
  });

  it("records the generated plan response with its usable outcome", async () => {
    const laundry = createLaundry();
    callOllamaMock.mockResolvedValue(
      JSON.stringify({ activities: [{ taskId: laundry.id, date: "2026-07-30" }] })
    );

    await runPlannerOnce();

    expect(listRecentModelCalls()).toMatchObject([
      {
        kind: "plan-generation",
        status: "ok",
        outcome: "1 proposed; 0 dropped as unknown Task, 0 dropped outside the week, 0 duplicates dropped; 0 deferred for the Time Budget; 1 planned.",
      },
    ]);
  });

  it("tells Ollama the Mode's busy hours and the week's immovable Scheduled placements", async () => {
    setMode("work");
    setTimeBudget("work", 600);
    createTraining();
    createLaundry();
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    await runPlannerOnce();

    const prompt = promptAt(0);
    expect(prompt).toContain("work");
    expect(prompt).toContain("assumed-busy hours: Mon-Fri 09:00-17:00");
    expect(prompt).toContain("600 minutes");
    expect(prompt).toContain("Fixed Scheduled Task placements");
    expect(prompt).toContain("2026-07-28 | Tuesday | 16:00-18:00");
    expect(prompt).toContain("Bouldering: board and strength");
    expect(prompt).toContain("120 minutes");
    expect(prompt).toContain("Do the laundry");
    expect(prompt).toContain("15 minutes");
    expect(prompt).toContain("about every week");
    expect(prompt).toContain("most-urgent-first");
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

    const prompt = promptAt(0);
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

  it("keeps Flexible Planned Activities within the Time Budget in Ollama's order", async () => {
    setTimeBudget("work", 60);
    const urgent = createFlexibleTask({
      description: "Urgent task",
      frequencyText: "weekly",
      durationMinutes: 45,
    });
    const lessUrgent = createFlexibleTask({
      description: "Less urgent task",
      frequencyText: "weekly",
      durationMinutes: 30,
    });
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: urgent.id, date: "2026-07-30" },
          { taskId: lessUrgent.id, date: "2026-07-31" },
        ],
      })
    );

    await runPlannerOnce();

    const activities = listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id);
    expect(activities.map((activity) => activity.taskId)).toEqual([urgent.id]);
    expect(getPlannerStatus().lastResult).toContain("1 model-proposed Planned Activity was deferred");
  });

  it("skips an oversized Flexible Task and continues with later entries", async () => {
    setTimeBudget("work", 60);
    const oversized = createFlexibleTask({
      description: "Oversized task",
      frequencyText: "weekly",
      durationMinutes: 75,
    });
    const smaller = createFlexibleTask({
      description: "Smaller task",
      frequencyText: "weekly",
      durationMinutes: 30,
    });
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: oversized.id, date: "2026-07-30" },
          { taskId: smaller.id, date: "2026-07-31" },
        ],
      })
    );

    await runPlannerOnce();

    expect(
      listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id).map((activity) => activity.taskId)
    ).toEqual([smaller.id]);
  });

  it("charges each placement of the same Flexible Task against the Time Budget", async () => {
    setTimeBudget("work", 60);
    const laundry = createFlexibleTask({
      description: "Do the laundry",
      frequencyText: "twice weekly",
      durationMinutes: 30,
    });
    const cleaning = createFlexibleTask({
      description: "Clean the kitchen",
      frequencyText: "weekly",
      durationMinutes: 15,
    });
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: laundry.id, date: "2026-07-29" },
          { taskId: laundry.id, date: "2026-07-30" },
          { taskId: cleaning.id, date: "2026-07-31" },
        ],
      })
    );

    await runPlannerOnce();

    expect(
      listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id).map((activity) => [
        activity.taskId,
        activity.date,
      ])
    ).toEqual([
      [laundry.id, "2026-07-29"],
      [laundry.id, "2026-07-30"],
    ]);
  });

  it("does not charge Scheduled Tasks against the Time Budget", async () => {
    setTimeBudget("work", 15);
    const training = createTraining();
    const laundry = createLaundry();
    callOllamaMock.mockResolvedValue(
      JSON.stringify({ activities: [{ taskId: laundry.id, date: "2026-07-30" }] })
    );

    await runPlannerOnce();

    expect(
      listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id).map((activity) => activity.taskId)
    ).toEqual([training.id, laundry.id]);
  });

  it("uses the Time Budget for the current Mode and treats zero as a real budget", async () => {
    setTimeBudget("work", 0);
    setTimeBudget("vacation", 30);
    const laundry = createLaundry();
    callOllamaMock.mockResolvedValue(
      JSON.stringify({ activities: [{ taskId: laundry.id, date: "2026-07-30" }] })
    );

    await runPlannerOnce();
    expect(getWeeklyPlanByWeek(WEEK_START)).toBeUndefined();
    expect(getPlannerStatus().lastResult).toContain("1 model-proposed Planned Activity was deferred");

    setMode("vacation");
    await runPlannerOnce();
    expect(
      listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id).map((activity) => activity.taskId)
    ).toEqual([laundry.id]);
  });

  it("does not enforce a Time Budget when the current Mode has no configured row", async () => {
    getDb().prepare("DELETE FROM time_budget WHERE mode = 'work'").run();
    const first = createFlexibleTask({
      description: "First task",
      frequencyText: "weekly",
      durationMinutes: 45,
    });
    const second = createFlexibleTask({
      description: "Second task",
      frequencyText: "weekly",
      durationMinutes: 45,
    });
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: first.id, date: "2026-07-30" },
          { taskId: second.id, date: "2026-07-31" },
        ],
      })
    );

    await runPlannerOnce();

    expect(
      listPlannedActivitiesForPlan(getWeeklyPlanByWeek(WEEK_START)!.id).map((activity) => activity.taskId)
    ).toEqual([first.id, second.id]);
  });

  it("records an error and writes nothing when no entry survives validation", async () => {
    createTraining();
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
    expect(status.lastResult).toBe(
      "Ollama request to http://localhost:11434 failed: Error: connection refused"
    );
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
    expect(callOllamaMock).not.toHaveBeenCalled();
  });

  it("revises the open remainder after a Completion while preserving frozen activities", async () => {
    const training = createTraining();
    const laundry = createLaundry();
    const cleaning = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const plan = createWeeklyPlanWithActivities(WEEK_START, [
      { taskId: training.id, date: "2026-07-28" },
      { taskId: laundry.id, date: "2026-07-29" },
      { taskId: training.id, date: "2026-07-30" },
    ]);
    const [past, , future] = listPlannedActivitiesForPlan(plan.id);
    updatePlannedActivityStatus(future.id, "done");
    getDb()
      .prepare("UPDATE weekly_plan SET revised_at = '2026-07-01 00:00:00' WHERE id = @id")
      .run({ id: plan.id });
    recordCompletion({
      taskId: laundry.id,
      completedDate: "2026-07-29",
      note: "Finished early",
    });
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: cleaning.id, date: "2026-07-31" },
          { taskId: laundry.id, date: "2026-07-28" },
          { taskId: training.id, date: "2026-07-30" },
          { taskId: cleaning.id, date: "2026-07-31" },
          { taskId: 9999, date: "2026-08-01" },
        ],
      })
    );

    await runPlannerOnce();

    expect(listPlannedActivitiesForPlan(plan.id).map((activity) => [activity.taskId, activity.date, activity.status])).toEqual([
      [training.id, past.date, "pending"],
      [future.taskId, future.date, "done"],
      [cleaning.id, "2026-07-31", "pending"],
    ]);
    expect(promptAt(1)).toContain("Today is 2026-07-29");
    expect(promptAt(1)).toContain("Finished early");
    expect(promptAt(1)).toContain("2026-07-28 | pending");
    expect(getPlannerStatus().lastResult).toContain("Revised week 2026-07-27");
  });

  it("charges frozen Flexible Planned Activities before revising the open remainder", async () => {
    setTimeBudget("work", 60);
    const completed = createFlexibleTask({
      description: "Completed task",
      frequencyText: "weekly",
      durationMinutes: 45,
    });
    const proposed = createFlexibleTask({
      description: "Proposed task",
      frequencyText: "weekly",
      durationMinutes: 30,
    });
    const smaller = createFlexibleTask({
      description: "Smaller task",
      frequencyText: "weekly",
      durationMinutes: 15,
    });
    const plan = createWeeklyPlanWithActivities(WEEK_START, [
      { taskId: completed.id, date: "2026-07-28" },
    ]);
    const [frozen] = listPlannedActivitiesForPlan(plan.id);
    updatePlannedActivityStatus(frozen.id, "done");
    getDb()
      .prepare("UPDATE weekly_plan SET revised_at = '2026-07-01 00:00:00' WHERE id = @id")
      .run({ id: plan.id });
    recordCompletion({ taskId: completed.id, completedDate: "2026-07-29" });
    callOllamaMock.mockResolvedValue(
      JSON.stringify({
        activities: [
          { taskId: proposed.id, date: "2026-07-30" },
          { taskId: smaller.id, date: "2026-07-31" },
        ],
      })
    );

    await runPlannerOnce();

    expect(
      listPlannedActivitiesForPlan(plan.id).map((activity) => [activity.taskId, activity.date])
    ).toEqual([
      [completed.id, "2026-07-28"],
      [smaller.id, "2026-07-31"],
    ]);
    expect(getPlannerStatus().lastResult).toContain("1 model-proposed Planned Activity was deferred");
  });

  it("revises after a Correction and uses the corrected Task description in the prompt", async () => {
    const laundry = createLaundry();
    const plan = createWeeklyPlanWithActivities(WEEK_START, [
      { taskId: laundry.id, date: "2026-07-30" },
    ]);
    getDb()
      .prepare("UPDATE weekly_plan SET revised_at = '2026-07-01 00:00:00' WHERE id = @id")
      .run({ id: plan.id });
    applyCorrection(laundry.id, "Wash bedding and towels");
    callOllamaMock.mockResolvedValue(
      JSON.stringify({ activities: [{ taskId: laundry.id, date: "2026-07-31" }] })
    );

    await runPlannerOnce();

    expect(promptAt(0)).toContain("Wash bedding and towels");
    expect(listPlannedActivitiesForPlan(plan.id).map((activity) => activity.date)).toEqual(["2026-07-31"]);
  });

  it("treats a well-formed empty revision response as an empty Flexible remainder", async () => {
    const laundry = createLaundry();
    const plan = createWeeklyPlanWithActivities(WEEK_START, [
      { taskId: laundry.id, date: "2026-07-30" },
    ]);
    getDb()
      .prepare("UPDATE weekly_plan SET revised_at = '2026-07-01 00:00:00' WHERE id = @id")
      .run({ id: plan.id });
    recordCompletion({ taskId: laundry.id, completedDate: "2026-07-29" });
    callOllamaMock.mockResolvedValue('{"activities": [{"taskId": 9999, "date": "2026-07-30"}]}');

    await runPlannerOnce();

    expect(listPlannedActivitiesForPlan(plan.id)).toEqual([]);
    expect(getWeeklyPlanByWeek(WEEK_START)?.revisedAt).not.toBe("2026-07-01 00:00:00");
    expect(getPlannerStatus().lastStatus).toBe("ok");
  });

  it("turns a Completion note into one Correction and uses it in this run's plan", async () => {
    const laundry = createLaundry();
    const completion = recordCompletion({
      taskId: laundry.id,
      completedDate: "2026-07-29",
      note: "The big rug takes closer to an hour",
    });
    callOllamaMock
      .mockResolvedValueOnce('{"correction":"Vacuum the big rug for about an hour"}')
      .mockResolvedValueOnce(
        JSON.stringify({ activities: [{ taskId: laundry.id, date: "2026-07-30" }] })
      );

    await runPlannerOnce();

    expect(getTaskById(laundry.id)?.description).toBe("Vacuum the big rug for about an hour");
    expect(listCorrections(laundry.id).map((correction) => correction.text)).toEqual([
      "Vacuum the big rug for about an hour",
    ]);
    expect(getCompletionById(completion.id)?.processedAt).toBeDefined();
    expect(callOllamaMock).toHaveBeenCalledTimes(2);
    expect(promptAt(1)).toContain("Vacuum the big rug for about an hour");
    expect(getPlannerStatus().lastResult).toBe(
      "1 Correction applied. Planned week 2026-07-27: 0 Scheduled and 1 model-placed Planned Activities."
    );
  });

  it("marks unusable responses and note-less Completions processed without applying a Correction", async () => {
    const laundry = createLaundry();
    const commentary = recordCompletion({
      taskId: laundry.id,
      completedDate: "2026-07-28",
      note: "It was raining, still fine",
    });
    const noNote = recordCompletion({ taskId: laundry.id, completedDate: "2026-07-29" });
    callOllamaMock
      .mockResolvedValueOnce("Not valid JSON")
      .mockResolvedValueOnce('{"activities":[]}');

    await runPlannerOnce();

    expect(getTaskById(laundry.id)?.description).toBe("Do the laundry");
    expect(listCorrections(laundry.id)).toEqual([]);
    expect(getCompletionById(commentary.id)?.processedAt).toBeDefined();
    expect(getCompletionById(noNote.id)?.processedAt).toBeDefined();
    expect(callOllamaMock).toHaveBeenCalledTimes(2);
  });

  it("considers several notes for one Task together and applies at most one Correction", async () => {
    const laundry = createLaundry();
    const first = recordCompletion({
      taskId: laundry.id,
      completedDate: "2026-07-28",
      note: "The small rug was replaced",
    });
    const second = recordCompletion({
      taskId: laundry.id,
      completedDate: "2026-07-29",
      note: "The big rug now takes closer to an hour",
    });
    callOllamaMock
      .mockResolvedValueOnce('{"correction":"Vacuum the big rug for about an hour"}')
      .mockResolvedValueOnce('{"activities":[]}');

    await runPlannerOnce();

    expect(listCorrections(laundry.id)).toHaveLength(1);
    expect(getCompletionById(first.id)?.processedAt).toBeDefined();
    expect(getCompletionById(second.id)?.processedAt).toBeDefined();
    expect(callOllamaMock).toHaveBeenCalledTimes(2);
  });

  it("processes a note-less Completion without an extraction call", async () => {
    const laundry = createLaundry();
    const completion = recordCompletion({ taskId: laundry.id, completedDate: "2026-07-29" });
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    await runPlannerOnce();

    expect(getCompletionById(completion.id)?.processedAt).toBeDefined();
    expect(callOllamaMock).toHaveBeenCalledTimes(1);
    expect(getPlannerStatus().lastResult).toBe("Week 2026-07-27 has nothing due.");
  });

  it("retries only the Task whose extraction failed while still planning", async () => {
    const failed = createLaundry();
    const processed = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "monthly",
      durationMinutes: 30,
    });
    const failedCompletion = recordCompletion({
      taskId: failed.id,
      completedDate: "2026-07-29",
      note: "Needs a new filter",
    });
    const processedCompletion = recordCompletion({
      taskId: processed.id,
      completedDate: "2026-07-29",
      note: "Still the same job",
    });
    callOllamaMock
      .mockRejectedValueOnce(new Error("Ollama unavailable"))
      .mockResolvedValueOnce('{"correction":null}')
      .mockResolvedValueOnce('{"activities":[]}');

    await runPlannerOnce();

    expect(getCompletionById(failedCompletion.id)?.processedAt).toBeUndefined();
    expect(getCompletionById(processedCompletion.id)?.processedAt).toBeDefined();
    expect(getWeeklyPlanByWeek(WEEK_START)).toBeUndefined();
    expect(getPlannerStatus().lastResult).toBe(
      "0 Corrections applied. 1 Task was deferred after extraction failure. Week 2026-07-27 has nothing due."
    );
  });

  it("revises an already-planned week when extraction applies a Correction", async () => {
    const laundry = createLaundry();
    const plan = createWeeklyPlanWithActivities(WEEK_START, [
      { taskId: laundry.id, date: "2026-07-30" },
    ]);
    getDb()
      .prepare("UPDATE weekly_plan SET revised_at = '2026-07-28 00:00:00' WHERE id = @id")
      .run({ id: plan.id });
    const completion = recordCompletion({
      taskId: laundry.id,
      completedDate: "2026-07-28",
      note: "The big rug takes closer to an hour",
    });
    getDb()
      .prepare("UPDATE completion SET created_at = '2026-07-27 00:00:00' WHERE id = @id")
      .run({ id: completion.id });
    callOllamaMock
      .mockResolvedValueOnce('{"correction":"Vacuum the big rug for about an hour"}')
      .mockResolvedValueOnce(
        JSON.stringify({ activities: [{ taskId: laundry.id, date: "2026-07-31" }] })
      );

    await runPlannerOnce();

    expect(listPlannedActivitiesForPlan(plan.id).map((activity) => activity.date)).toEqual([
      "2026-07-31",
    ]);
    expect(promptAt(1)).toContain("Vacuum the big rug for about an hour");
    expect(getPlannerStatus().lastResult).toContain("1 Correction applied. Revised week 2026-07-27");
  });

  it("compacts processed Completions outside the recent window before planning", async () => {
    const laundry = createLaundry();
    const completions = Array.from({ length: 12 }, (_, day) => {
      const completion = recordCompletion({
        taskId: laundry.id,
        completedDate: `2026-06-${String(day + 1).padStart(2, "0")}`,
        note: `Note ${day + 1}`,
      });
      markCompletionProcessed(completion.id);
      return completion;
    });
    callOllamaMock
      .mockResolvedValueOnce('{"summary":"Usually done earlier in the month."}')
      .mockResolvedValueOnce('{"activities":[]}');

    await runPlannerOnce();

    expect(getCompletionDigest(laundry.id)?.summary).toBe("Usually done earlier in the month.");
    expect(getCompletionById(completions[0].id)).toBeUndefined();
    expect(getCompletionById(completions[1].id)).toBeUndefined();
    expect(getCompletionById(completions[2].id)).toBeDefined();
    expect(getLatestCompletionDatesByTask().get(laundry.id)).toBe("2026-06-12");
    expect(promptAt(0)).toContain("Note 1");
    expect(getPlannerStatus().lastResult).toContain("1 Task was compacted; 2 Completions were folded");
  });

  it("leaves an eligible Task intact when its Digest response is unusable while compacting others", async () => {
    const failed = createLaundry();
    const compacted = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "monthly",
      durationMinutes: 30,
    });
    const completionsFor = (taskId: number) =>
      Array.from({ length: 11 }, (_, day) => {
        const completion = recordCompletion({
          taskId,
          completedDate: `2026-06-${String(day + 1).padStart(2, "0")}`,
        });
        markCompletionProcessed(completion.id);
        return completion;
      });
    const failedCompletions = completionsFor(failed.id);
    const compactedCompletions = completionsFor(compacted.id);
    upsertCompletionDigest(failed.id, "Previous digest");
    callOllamaMock
      .mockResolvedValueOnce("not JSON")
      .mockResolvedValueOnce('{"summary":"Usually a monthly task."}')
      .mockResolvedValueOnce('{"activities":[]}');

    await runPlannerOnce();

    expect(getCompletionDigest(failed.id)?.summary).toBe("Previous digest");
    expect(getCompletionById(failedCompletions[0].id)).toBeDefined();
    expect(getCompletionDigest(compacted.id)?.summary).toBe("Usually a monthly task.");
    expect(getCompletionById(compactedCompletions[0].id)).toBeUndefined();
    expect(getPlannerStatus().lastResult).toContain("1 Task was compacted; 1 Completion was folded");
  });

  it("does not compact unprocessed Completions outside the recent window", async () => {
    const laundry = createLaundry();
    const completions = Array.from({ length: 11 }, (_, day) =>
      recordCompletion({
        taskId: laundry.id,
        completedDate: `2026-06-${String(day + 1).padStart(2, "0")}`,
        note: day === 0 ? "Needs a new detergent" : undefined,
      })
    );
    completions.slice(1).forEach((completion) => markCompletionProcessed(completion.id));
    callOllamaMock
      .mockRejectedValueOnce(new Error("Ollama unavailable"))
      .mockResolvedValueOnce('{"activities":[]}');

    await runPlannerOnce();

    expect(getCompletionDigest(laundry.id)).toBeUndefined();
    expect(getCompletionById(completions[0].id)).toBeDefined();
    expect(callOllamaMock).toHaveBeenCalledTimes(2);
  });

  it("includes a Flexible Task's Completion Digest in generation and revision prompts", async () => {
    const laundry = createLaundry();
    upsertCompletionDigest(laundry.id, "Often takes longer than expected.");
    callOllamaMock.mockResolvedValue('{"activities":[]}');

    await runPlannerOnce();

    expect(promptAt(0)).toContain("Often takes longer than expected.");
    const plan = createWeeklyPlanWithActivities(WEEK_START, [
      { taskId: laundry.id, date: "2026-07-30" },
    ]);
    getDb()
      .prepare("UPDATE weekly_plan SET revised_at = '2026-07-01 00:00:00' WHERE id = @id")
      .run({ id: plan.id });
    recordCompletion({ taskId: laundry.id, completedDate: "2026-07-29" });
    callOllamaMock.mockClear();

    await runPlannerOnce();

    expect(promptAt(0)).toContain("Often takes longer than expected.");
  });
});
