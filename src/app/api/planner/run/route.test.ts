import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "@/lib/db/client";
import { createModelCall } from "@/lib/db/modelCall";
import { runMigrations } from "@/lib/db/migrate";
import { createFlexibleTask } from "@/lib/db/task";
import { setModelCallRecorder } from "@/lib/ollama/client";
import { getWeeklyPlanByWeek } from "@/lib/db/weeklyPlan";
import { POST } from "./route";

function postRequest(body?: unknown): Request {
  return new Request("http://localhost/api/planner/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const callOllamaMock = vi.fn();
const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const response = await callOllamaMock(input, init);
  return { ok: true, json: async () => ({ response }) } as Response;
});

describe("POST /api/planner/run", () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    resetDb();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("runs the Planner on demand and returns 204", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(204);
  });

  it("returns 409 without starting a second run while one is already in flight", async () => {
    createFlexibleTask({ description: "Do the laundry", frequencyText: "weekly", durationMinutes: 15 });
    let resolveResponse!: (response: string) => void;
    callOllamaMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveResponse = resolve;
        })
    );

    const firstRun = POST(postRequest());
    await vi.waitFor(() => expect(callOllamaMock).toHaveBeenCalledTimes(1));

    const secondResponse = await POST(postRequest());
    expect(secondResponse.status).toBe(409);
    expect((await secondResponse.json()) as { error: string }).toEqual({
      error: "The Planner is already running.",
    });
    expect(callOllamaMock).toHaveBeenCalledTimes(1);

    resolveResponse('{"activities":[]}');
    expect((await firstRun).status).toBe(204);
  });

  it("leaves planner_run empty when there is nothing due", async () => {
    await POST(postRequest());

    expect(
      (getDb().prepare("SELECT COUNT(*) AS count FROM planner_run").get() as { count: number }).count
    ).toBe(0);
  });

  it("forces a revision of an already-planned week when force is true", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0));
    const laundry = createFlexibleTask({
      description: "Do the laundry",
      frequencyText: "weekly",
      durationMinutes: 15,
    });
    callOllamaMock.mockResolvedValue(
      JSON.stringify({ activities: [{ taskId: laundry.id, date: "2026-07-30" }] })
    );
    await POST(postRequest());
    expect(getWeeklyPlanByWeek("2026-07-27")).toBeDefined();
    callOllamaMock.mockClear();

    await POST(postRequest());
    expect(callOllamaMock).not.toHaveBeenCalled();

    await POST(postRequest({ force: true }));
    expect(callOllamaMock).toHaveBeenCalledTimes(1);
  });
});
