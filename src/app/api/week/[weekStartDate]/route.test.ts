import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordCompletion } from "@/lib/db/completion";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { addPlannedActivity } from "@/lib/db/plannedActivity";
import { createFlexibleTask, createScheduledTask } from "@/lib/db/task";
import { createWeeklyPlan } from "@/lib/db/weeklyPlan";
import { GET as getDay } from "../../day/[date]/route";
import { GET } from "./route";

const context = (weekStartDate: string) => ({ params: Promise.resolve({ weekStartDate }) });
const dayContext = (date: string) => ({ params: Promise.resolve({ date }) });

describe("Week API", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("assembles a week of Planned Activities and ad-hoc Completions by their calendar days", async () => {
    const plan = createWeeklyPlan("2026-07-20");
    const scheduled = createScheduledTask({
      description: "Morning run",
      weekday: 2,
      startTime: "07:00",
      endTime: "07:30",
      recurrenceIntervalWeeks: 1,
    });
    const flexible = createFlexibleTask({
      description: "Clean the windows",
      frequencyText: "quarterly",
      durationMinutes: 45,
    });
    const adHocTask = createFlexibleTask({
      description: "Buy bird seed",
      frequencyText: "as needed",
      durationMinutes: 10,
    });
    const activity = addPlannedActivity({ weeklyPlanId: plan.id, taskId: scheduled.id, date: "2026-07-21" });
    addPlannedActivity({ weeklyPlanId: plan.id, taskId: flexible.id, date: "2026-07-23" });
    recordCompletion({
      taskId: scheduled.id,
      plannedActivityId: activity.id,
      completedDate: "2026-07-21",
      note: "Felt great",
    });
    recordCompletion({ taskId: adHocTask.id, completedDate: "2026-07-22", note: "At the market" });

    const response = await GET(new Request("http://localhost/api/week/2026-07-20"), context("2026-07-20"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      weekStartDate: "2026-07-20",
      plannerHasPlanned: true,
      days: [
        { date: "2026-07-20", plannedActivities: [], adHocCompletions: [] },
        {
          date: "2026-07-21",
          plannedActivities: [
            {
              id: activity.id,
              status: "done",
              startTime: "07:00",
              endTime: "07:30",
              note: "Felt great",
              task: { id: scheduled.id, kind: "scheduled", description: "Morning run" },
            },
          ],
          adHocCompletions: [],
        },
        {
          date: "2026-07-22",
          plannedActivities: [],
          adHocCompletions: [
            {
              completedDate: "2026-07-22",
              note: "At the market",
              task: { id: adHocTask.id, kind: "flexible", description: "Buy bird seed" },
            },
          ],
        },
        {
          date: "2026-07-23",
          plannedActivities: [
            { task: { id: flexible.id, kind: "flexible", description: "Clean the windows" } },
          ],
          adHocCompletions: [],
        },
        { date: "2026-07-24", plannedActivities: [], adHocCompletions: [] },
        { date: "2026-07-25", plannedActivities: [], adHocCompletions: [] },
        { date: "2026-07-26", plannedActivities: [], adHocCompletions: [] },
      ],
    });
  });

  it("returns an unplanned week with seven dates and any ad-hoc Completion in its day", async () => {
    const task = createFlexibleTask({
      description: "Buy bird seed",
      frequencyText: "as needed",
      durationMinutes: 10,
    });
    recordCompletion({ taskId: task.id, completedDate: "2026-07-22", note: "At the market" });

    const response = await GET(new Request("http://localhost/api/week/2026-07-20"), context("2026-07-20"));
    const body = await response.json();

    expect(body.plannerHasPlanned).toBe(false);
    expect(body.days.map((day: { date: string }) => day.date)).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]);
    expect(body.days[2].adHocCompletions).toMatchObject([
      { completedDate: "2026-07-22", task: { id: task.id, description: "Buy bird seed" } },
    ]);
  });

  it("reports an existing empty Weekly Plan as planned", async () => {
    createWeeklyPlan("2026-07-20");

    const response = await GET(new Request("http://localhost/api/week/2026-07-20"), context("2026-07-20"));

    expect(await response.json()).toMatchObject({
      plannerHasPlanned: true,
      days: Array.from({ length: 7 }, (_, offset) => ({
        date: `2026-07-${String(20 + offset).padStart(2, "0")}`,
        plannedActivities: [],
        adHocCompletions: [],
      })),
    });
  });

  it("returns the same entry from the Day route", async () => {
    const task = createFlexibleTask({
      description: "Buy bird seed",
      frequencyText: "as needed",
      durationMinutes: 10,
    });
    recordCompletion({ taskId: task.id, completedDate: "2026-07-22", note: "At the market" });

    const week = await GET(new Request("http://localhost/api/week/2026-07-20"), context("2026-07-20"));
    const day = await getDay(new Request("http://localhost/api/day/2026-07-22"), dayContext("2026-07-22"));

    expect(await day.json()).toEqual((await week.json()).days[2]);
  });

  it("keeps a linked Completion note with its activity when their dates differ", async () => {
    const plan = createWeeklyPlan("2026-07-20");
    const task = createFlexibleTask({
      description: "Buy bird seed",
      frequencyText: "as needed",
      durationMinutes: 10,
    });
    const activity = addPlannedActivity({ weeklyPlanId: plan.id, taskId: task.id, date: "2026-07-22" });
    recordCompletion({
      taskId: task.id,
      plannedActivityId: activity.id,
      completedDate: "2026-08-03",
      note: "Bought a larger bag",
    });

    const response = await getDay(new Request("http://localhost/api/day/2026-07-22"), dayContext("2026-07-22"));

    expect(await response.json()).toMatchObject({
      date: "2026-07-22",
      plannedActivities: [{ id: activity.id, note: "Bought a larger bag" }],
      adHocCompletions: [],
    });
  });

  it("rejects malformed dates and week starts that are not Mondays", async () => {
    expect(
      (await GET(new Request("http://localhost/api/week/not-a-date"), context("not-a-date"))).status
    ).toBe(400);
    expect(
      (await GET(new Request("http://localhost/api/week/2026-07-21"), context("2026-07-21"))).status
    ).toBe(400);
    expect(
      (await getDay(new Request("http://localhost/api/day/2026-99-99"), dayContext("2026-99-99"))).status
    ).toBe(400);
  });
});
