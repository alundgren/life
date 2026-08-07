import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "@/lib/db/client";
import { createModelCall } from "@/lib/db/modelCall";
import { runMigrations } from "@/lib/db/migrate";
import { createFlexibleTask } from "@/lib/db/task";
import { setModelCallRecorder } from "@/lib/ollama/client";
import { POST } from "./route";

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
  });

  it("runs the Planner on demand and returns 204", async () => {
    const response = await POST();

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

    const firstRun = POST();
    await vi.waitFor(() => expect(callOllamaMock).toHaveBeenCalledTimes(1));

    const secondResponse = await POST();
    expect(secondResponse.status).toBe(409);
    expect((await secondResponse.json()) as { error: string }).toEqual({
      error: "The Planner is already running.",
    });
    expect(callOllamaMock).toHaveBeenCalledTimes(1);

    resolveResponse('{"activities":[]}');
    expect((await firstRun).status).toBe(204);
  });

  it("leaves planner_run empty when there is nothing due", async () => {
    await POST();

    expect(
      (getDb().prepare("SELECT COUNT(*) AS count FROM planner_run").get() as { count: number }).count
    ).toBe(0);
  });
});
