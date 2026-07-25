import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { listUnprocessedCompletions } from "@/lib/db/completion";
import { addPlannedActivity, getPlannedActivityById } from "@/lib/db/plannedActivity";
import { createFlexibleTask, createScheduledTask } from "@/lib/db/task";
import { createWeeklyPlan } from "@/lib/db/weeklyPlan";
import { POST as postCompletion } from "../completions/route";
import { GET } from "./route";

function getRequest(date?: string): Request {
  const query = date === undefined ? "" : `?date=${date}`;
  return new Request(`http://localhost/api/planned-activities${query}`);
}

function completionRequest(body: unknown): Request {
  return new Request("http://localhost/api/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("daily view API", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("returns a date's Planned Activities with Task detail, slot fields, and timed-first order", async () => {
    const plan = createWeeklyPlan("2026-07-20");
    const late = createScheduledTask({
      description: "Evening training",
      weekday: 2,
      startTime: "18:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });
    const early = createScheduledTask({
      description: "Morning run",
      weekday: 2,
      startTime: "07:00",
      endTime: "07:30",
      recurrenceIntervalWeeks: 1,
    });
    const flexible = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    addPlannedActivity({ weeklyPlanId: plan.id, taskId: late.id, date: "2026-07-21" });
    addPlannedActivity({ weeklyPlanId: plan.id, taskId: flexible.id, date: "2026-07-21" });
    addPlannedActivity({ weeklyPlanId: plan.id, taskId: early.id, date: "2026-07-21" });
    addPlannedActivity({ weeklyPlanId: plan.id, taskId: early.id, date: "2026-07-22" });

    const response = await GET(getRequest("2026-07-21"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{
      task: { description: string; kind: string };
      startTime?: string;
      endTime?: string;
    }>;

    expect(body.map((activity) => activity.task.description)).toEqual([
      "Morning run",
      "Evening training",
      "Clean the windows",
    ]);
    expect(body[0]).toMatchObject({
      startTime: "07:00",
      endTime: "07:30",
      task: { kind: "scheduled" },
    });
    expect(body[2].startTime).toBeUndefined();
    expect(body[2].task.kind).toBe("flexible");
  });

  it("returns an empty list when no Weekly Plan or no activity exists for the date", async () => {
    const noPlan = await GET(getRequest("2026-07-21"));
    expect(await noPlan.json()).toEqual([]);

    createWeeklyPlan("2026-07-20");
    const emptyDay = await GET(getRequest("2026-07-21"));
    expect(await emptyDay.json()).toEqual([]);
  });

  it("rejects missing or malformed date parameters", async () => {
    expect((await GET(getRequest())).status).toBe(400);
    expect((await GET(getRequest("2026-99-99"))).status).toBe(400);
  });

  it("records a linked Completion and marks the Planned Activity Done in one request", async () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const activity = addPlannedActivity({
      weeklyPlanId: plan.id,
      taskId: task.id,
      date: "2026-07-21",
    });

    const response = await postCompletion(
      completionRequest({
        taskId: task.id,
        plannedActivityId: activity.id,
        completedDate: "2026-07-21",
        note: "  Took longer than expected  ",
      })
    );

    expect(response.status).toBe(201);
    const completion = await response.json();
    expect(completion).toMatchObject({
      taskId: task.id,
      plannedActivityId: activity.id,
      completedDate: "2026-07-21",
      note: "Took longer than expected",
    });
    expect(completion.processedAt).toBeUndefined();
    expect(getPlannedActivityById(activity.id)?.status).toBe("done");
    expect(listUnprocessedCompletions().map((c) => c.id)).toEqual([completion.id]);
  });

  it("records a standalone Completion with no Planned Activity and stores whitespace-only note as null", async () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });

    const response = await postCompletion(
      completionRequest({ taskId: task.id, completedDate: "2026-07-21", note: "   " })
    );

    expect(response.status).toBe(201);
    const completion = await response.json();
    expect(completion.plannedActivityId).toBeUndefined();
    expect(completion.note).toBeUndefined();
  });

  it("rejects invalid Completion requests before writing", async () => {
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const otherTask = createFlexibleTask({
      description: "Wash the car",
      frequencyText: "monthly",
      durationMinutes: 30,
    });
    const plan = createWeeklyPlan("2026-07-20");
    const otherActivity = addPlannedActivity({
      weeklyPlanId: plan.id,
      taskId: otherTask.id,
      date: "2026-07-21",
    });

    const cases = [
      { taskId: 999, completedDate: "2026-07-21" },
      { taskId: task.id, completedDate: "bad-date" },
      { taskId: task.id, completedDate: "2026-07-21", plannedActivityId: otherActivity.id },
    ];

    for (const body of cases) {
      const response = await postCompletion(completionRequest(body));
      expect(response.status).toBe(400);
      expect((await response.json()) as { error: string }).toHaveProperty("error");
    }

    expect(
      (getDb().prepare("SELECT COUNT(*) as count FROM completion").get() as { count: number }).count
    ).toBe(0);
  });

  it("rejects completing an already-Done Planned Activity and leaves one Completion behind", async () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
    const activity = addPlannedActivity({
      weeklyPlanId: plan.id,
      taskId: task.id,
      date: "2026-07-21",
    });
    const body = {
      taskId: task.id,
      completedDate: "2026-07-21",
      plannedActivityId: activity.id,
    };

    expect((await postCompletion(completionRequest(body))).status).toBe(201);
    const second = await postCompletion(completionRequest(body));

    expect(second.status).toBe(409);
    expect(
      (getDb().prepare("SELECT COUNT(*) as count FROM completion").get() as { count: number }).count
    ).toBe(1);
  });
});
