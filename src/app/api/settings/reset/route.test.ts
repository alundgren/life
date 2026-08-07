import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { createModelCall } from "@/lib/db/modelCall";
import { getMode, setMode } from "@/lib/db/mode";
import { createFlexibleTask } from "@/lib/db/task";
import { setTimeBudget } from "@/lib/db/timeBudget";
import { setModelCallRecorder } from "@/lib/ollama/client";
import { POST as runPlanner } from "../../planner/run/route";
import { POST } from "./route";

const callOllamaMock = vi.fn();
const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const response = await callOllamaMock(input, init);
  return { ok: true, json: async () => ({ response }) } as Response;
});

function resetRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/settings/reset", () => {
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

  it("rejects a missing or wrong confirmation phrase with a 400 and makes no changes", async () => {
    setMode("vacation");

    const response = await POST(resetRequest({ confirm: "please" }));

    expect(response.status).toBe(400);
    expect(getMode()).toBe("vacation");
  });

  it("rejects malformed JSON with a 400", async () => {
    const response = await POST(
      new Request("http://localhost/api/settings/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    );

    expect(response.status).toBe(400);
  });

  it("wipes data and restores defaults on a correct confirmation", async () => {
    createFlexibleTask({ description: "Vacuum", frequencyText: "weekly", durationMinutes: 20 });
    setMode("vacation");
    setTimeBudget("work", 240);

    const response = await POST(resetRequest({ confirm: "reset" }));

    expect(response.status).toBe(204);
    expect(getMode()).toBe("work");
    expect(
      (getDb().prepare("SELECT COUNT(*) AS count FROM task").get() as { count: number }).count
    ).toBe(0);
  });

  it("returns 409 and does not wipe data while a Planner run is in flight", async () => {
    createFlexibleTask({ description: "Do the laundry", frequencyText: "weekly", durationMinutes: 15 });
    let resolveResponse!: (response: string) => void;
    callOllamaMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveResponse = resolve;
        })
    );

    const plannerRun = runPlanner();
    await vi.waitFor(() => expect(callOllamaMock).toHaveBeenCalledTimes(1));

    const response = await POST(resetRequest({ confirm: "reset" }));

    expect(response.status).toBe(409);
    expect(
      (getDb().prepare("SELECT COUNT(*) AS count FROM task").get() as { count: number }).count
    ).toBe(1);

    resolveResponse('{"activities":[]}');
    await plannerRun;
  });
});
