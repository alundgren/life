import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { createFlexibleTask, createScheduledTask } from "@/lib/db/task";
import { PATCH } from "./[id]/route";
import { GET, POST } from "./route";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function patchContext(id: number | string) {
  return { params: Promise.resolve({ id: String(id) }) };
}

describe("/api/tasks", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("lists Scheduled and Flexible Tasks", async () => {
    createScheduledTask({
      description: "Training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });
    createFlexibleTask({
      description: "Windows",
      frequencyText: "quarterly",
      durationMinutes: 45,
    });

    const response = GET();
    const body = (await response.json()) as { tasks: unknown[] };

    expect(response.status).toBe(200);
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "scheduled", description: "Training" }),
        expect.objectContaining({ kind: "flexible", description: "Windows" }),
      ])
    );
  });

  it("creates each kind and includes it in later lists", async () => {
    const scheduledResponse = await POST(
      jsonRequest({
        kind: "scheduled",
        description: "Training",
        weekday: 2,
        startTime: "16:00",
        endTime: "19:00",
        recurrenceIntervalWeeks: 1,
      })
    );
    const flexibleResponse = await POST(
      jsonRequest({
        kind: "flexible",
        description: "Windows",
        frequencyText: "quarterly",
        durationMinutes: 45,
      })
    );

    expect(scheduledResponse.status).toBe(201);
    expect(flexibleResponse.status).toBe(201);

    const listResponse = GET();
    const body = (await listResponse.json()) as { tasks: unknown[] };
    expect(body.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "scheduled", description: "Training" }),
        expect.objectContaining({ kind: "flexible", description: "Windows" }),
      ])
    );
  });

  it("edits each kind directly", async () => {
    const scheduled = createScheduledTask({
      description: "Training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });
    const flexible = createFlexibleTask({
      description: "Windows",
      frequencyText: "quarterly",
      durationMinutes: 45,
    });

    const scheduledResponse = await PATCH(
      jsonRequest({
        kind: "scheduled",
        description: "Morning training",
        weekday: 4,
        startTime: "07:30",
        endTime: "08:45",
        recurrenceIntervalWeeks: 2,
      }),
      patchContext(scheduled.id)
    );
    const flexibleResponse = await PATCH(
      jsonRequest({
        kind: "flexible",
        description: "Kitchen deep clean",
        frequencyText: "monthly",
        durationMinutes: 90,
      }),
      patchContext(flexible.id)
    );

    const scheduledBody = (await scheduledResponse.json()) as { task: unknown };
    const flexibleBody = (await flexibleResponse.json()) as { task: unknown };

    expect(scheduledResponse.status).toBe(200);
    expect(scheduledBody.task).toEqual(
      expect.objectContaining({
        kind: "scheduled",
        description: "Morning training",
        weekday: 4,
        startTime: "07:30",
        endTime: "08:45",
        recurrenceIntervalWeeks: 2,
      })
    );
    expect(flexibleResponse.status).toBe(200);
    expect(flexibleBody.task).toEqual(
      expect.objectContaining({
        kind: "flexible",
        description: "Kitchen deep clean",
        frequencyText: "monthly",
        durationMinutes: 90,
      })
    );
  });

  it.each([
    [{ kind: "scheduled", description: "", weekday: 1, startTime: "09:00", endTime: "10:00", recurrenceIntervalWeeks: 1 }, "Description"],
    [{ kind: "scheduled", description: "X", weekday: 7, startTime: "09:00", endTime: "10:00", recurrenceIntervalWeeks: 1 }, "Weekday"],
    [{ kind: "scheduled", description: "X", weekday: 1, startTime: "09:00", endTime: "09:00", recurrenceIntervalWeeks: 1 }, "End time"],
    [{ kind: "scheduled", description: "X", weekday: 1, startTime: "09:00", endTime: "10:00", recurrenceIntervalWeeks: 0 }, "Recurrence"],
    [{ kind: "flexible", description: "X", frequencyText: "", durationMinutes: 30 }, "Frequency"],
    [{ kind: "flexible", description: "X", frequencyText: "monthly", durationMinutes: 0 }, "Duration"],
  ])("returns a client error for invalid input", async (body, messagePart) => {
    const response = await POST(jsonRequest(body));
    const responseBody = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(responseBody.error).toContain(messagePart);
  });

  it("returns not found when editing a missing or mismatched Task", async () => {
    const flexible = createFlexibleTask({
      description: "Windows",
      frequencyText: "quarterly",
      durationMinutes: 45,
    });

    const missingResponse = await PATCH(
      jsonRequest({
        kind: "scheduled",
        description: "Training",
        weekday: 2,
        startTime: "16:00",
        endTime: "19:00",
        recurrenceIntervalWeeks: 1,
      }),
      patchContext(999)
    );
    const mismatchResponse = await PATCH(
      jsonRequest({
        kind: "scheduled",
        description: "Training",
        weekday: 2,
        startTime: "16:00",
        endTime: "19:00",
        recurrenceIntervalWeeks: 1,
      }),
      patchContext(flexible.id)
    );

    expect(missingResponse.status).toBe(404);
    expect(mismatchResponse.status).toBe(404);
  });
});
