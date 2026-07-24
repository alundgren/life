import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import type { Task } from "@/lib/db/task";
import { GET, POST } from "./route";
import { PUT } from "./[id]/route";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function putRequest(id: number | string, body: unknown): Request {
  return new Request(`http://localhost/api/tasks/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const putContext = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

const scheduledBody = {
  kind: "scheduled",
  description: "Strength training",
  weekday: 2,
  startTime: "16:00",
  endTime: "19:00",
  recurrenceIntervalWeeks: 1,
};

const flexibleBody = {
  kind: "flexible",
  description: "Clean the windows",
  frequencyText: "about every three months",
  durationMinutes: 45,
};

describe("Tasks API", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("lists both kinds of Task in the typed JSON shape", async () => {
    await POST(postRequest(scheduledBody));
    await POST(postRequest(flexibleBody));

    const listed = (await GET().json()) as Task[];
    expect(listed).toHaveLength(2);
    expect(listed.map((t) => t.kind).sort()).toEqual(["flexible", "scheduled"]);

    const scheduled = listed.find((t) => t.kind === "scheduled");
    const flexible = listed.find((t) => t.kind === "flexible");
    expect(scheduled).toMatchObject({
      kind: "scheduled",
      description: "Strength training",
      weekday: 2,
      startTime: "16:00",
      endTime: "19:00",
      recurrenceIntervalWeeks: 1,
    });
    expect(flexible).toMatchObject({
      kind: "flexible",
      description: "Clean the windows",
      frequencyText: "about every three months",
      durationMinutes: 45,
    });
  });

  it("creates a Scheduled Task and returns it, then it appears in the list", async () => {
    const response = await POST(postRequest(scheduledBody));
    expect(response.status).toBe(201);
    const created = (await response.json()) as Task;
    expect(created).toMatchObject({ kind: "scheduled", description: "Strength training" });

    const listed = (await GET().json()) as Task[];
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);
  });

  it("creates a Flexible Task and returns it, then it appears in the list", async () => {
    const response = await POST(postRequest(flexibleBody));
    expect(response.status).toBe(201);
    const created = (await response.json()) as Task;
    expect(created).toMatchObject({ kind: "flexible", frequencyText: "about every three months" });

    const listed = (await GET().json()) as Task[];
    expect(listed.map((t) => t.id)).toContain(created.id);
  });

  it("edits a Scheduled Task and reflects the new values on a later read", async () => {
    const created = (await (await POST(postRequest(scheduledBody))).json()) as Task;

    const response = await PUT(
      putRequest(created.id, {
        kind: "scheduled",
        description: "Mobility work",
        weekday: 4,
        startTime: "07:00",
        endTime: "07:45",
        recurrenceIntervalWeeks: 2,
      }),
      putContext(created.id)
    );
    expect(response.status).toBe(200);
    const updated = (await response.json()) as Task;
    expect(updated).toMatchObject({
      kind: "scheduled",
      description: "Mobility work",
      weekday: 4,
      startTime: "07:00",
      endTime: "07:45",
      recurrenceIntervalWeeks: 2,
    });

    const listed = (await GET().json()) as Task[];
    expect(listed.find((t) => t.id === created.id)).toEqual(updated);
  });

  it("edits a Flexible Task and reflects the new values on a later read", async () => {
    const created = (await (await POST(postRequest(flexibleBody))).json()) as Task;

    const response = await PUT(
      putRequest(created.id, {
        kind: "flexible",
        description: "Wash the car",
        frequencyText: "roughly monthly",
        durationMinutes: 30,
      }),
      putContext(created.id)
    );
    expect(response.status).toBe(200);
    const updated = (await response.json()) as Task;
    expect(updated).toMatchObject({
      kind: "flexible",
      description: "Wash the car",
      frequencyText: "roughly monthly",
      durationMinutes: 30,
    });

    const listed = (await GET().json()) as Task[];
    expect(listed.find((t) => t.id === created.id)).toEqual(updated);
  });

  it("returns 404 when editing a non-existent id", async () => {
    const response = await PUT(putRequest(999, scheduledBody), putContext(999));
    expect(response.status).toBe(404);
  });

  it("returns 404 when the edit kind doesn't match the stored Task", async () => {
    const created = (await (await POST(postRequest(scheduledBody))).json()) as Task;

    const response = await PUT(
      putRequest(created.id, flexibleBody),
      putContext(created.id)
    );
    expect(response.status).toBe(404);

    // The stored Scheduled Task is untouched.
    const listed = (await GET().json()) as Task[];
    expect(listed.find((t) => t.id === created.id)).toMatchObject({ kind: "scheduled" });
  });

  describe("rejects invalid create input with a 400 and a message, never a 500 or silent write", () => {
    const cases: Array<[string, unknown]> = [
      ["blank description", { ...scheduledBody, description: "   " }],
      ["bad weekday", { ...scheduledBody, weekday: 7 }],
      ["end at or before start", { ...scheduledBody, startTime: "10:00", endTime: "10:00" }],
      ["recurrence below 1", { ...scheduledBody, recurrenceIntervalWeeks: 0 }],
      ["blank frequency", { ...flexibleBody, frequencyText: "  " }],
      ["duration at or below 0", { ...flexibleBody, durationMinutes: 0 }],
    ];

    for (const [name, body] of cases) {
      it(name, async () => {
        const response = await POST(postRequest(body));
        expect(response.status).toBe(400);
        const parsed = (await response.json()) as { error: string };
        expect(typeof parsed.error).toBe("string");
        expect(parsed.error.length).toBeGreaterThan(0);

        // Nothing was written.
        expect((await GET().json()) as Task[]).toHaveLength(0);
      });
    }
  });

  it("rejects invalid edit input with a 400", async () => {
    const created = (await (await POST(postRequest(scheduledBody))).json()) as Task;

    const response = await PUT(
      putRequest(created.id, { ...scheduledBody, endTime: "16:00" }),
      putContext(created.id)
    );
    expect(response.status).toBe(400);
  });
});
