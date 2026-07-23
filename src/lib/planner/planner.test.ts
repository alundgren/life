import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

vi.mock("@/lib/ollama/client", () => ({
  callOllama: vi.fn(),
}));

import { callOllama } from "@/lib/ollama/client";
import { getPlannerStatus, runPlannerOnce, startPlanner, stopPlanner } from "./planner";

const callOllamaMock = vi.mocked(callOllama);

describe("planner lifecycle", () => {
  beforeEach(() => {
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
    expect(getPlannerStatus()).toEqual({ running: false, lastRunAt: null, lastResult: null });
  });

  it("records a successful run and reflects it in status", async () => {
    callOllamaMock.mockResolvedValue("pong");

    await runPlannerOnce();

    const status = getPlannerStatus();
    expect(status.lastResult).toBe("pong");
    expect(status.lastRunAt).not.toBeNull();
    expect(callOllamaMock).toHaveBeenCalledWith(expect.any(String), {
      host: "http://localhost:11434",
      model: "test-model",
    });
  });

  it("records the error message when the Ollama call fails", async () => {
    callOllamaMock.mockRejectedValue(new Error("connection refused"));

    await runPlannerOnce();

    expect(getPlannerStatus().lastResult).toBe("connection refused");
  });

  it("marks the planner running immediately and runs once right away", async () => {
    callOllamaMock.mockResolvedValue("pong");

    startPlanner(1000);

    expect(getPlannerStatus().running).toBe(true);
    await vi.waitFor(() => expect(callOllamaMock).toHaveBeenCalledTimes(1));
  });

  it("stops scheduling further runs after stop", async () => {
    vi.useFakeTimers();
    callOllamaMock.mockResolvedValue("pong");

    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(0);
    stopPlanner();
    expect(getPlannerStatus().running).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(callOllamaMock).toHaveBeenCalledTimes(1);
  });

  it("runs again on each interval tick while running", async () => {
    vi.useFakeTimers();
    callOllamaMock.mockResolvedValue("pong");

    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(callOllamaMock).toHaveBeenCalledTimes(3);
  });

  it("does not start a second interval when already running", async () => {
    vi.useFakeTimers();
    callOllamaMock.mockResolvedValue("pong");

    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(0);
    startPlanner(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(callOllamaMock).toHaveBeenCalledTimes(2);
  });
});
