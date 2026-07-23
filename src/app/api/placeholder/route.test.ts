import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, getDb, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { GET } from "./route";

describe("GET /api/placeholder", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("returns the seeded message read from SQLite", async () => {
    const response = GET();
    const body = (await response.json()) as { message: string | null };

    expect(body.message).toBe(
      "Hello from SQLite — the UI to API to SQLite path works."
    );
  });

  it("returns planner status with no recorded runs", async () => {
    const response = GET();
    const body = (await response.json()) as { planner: unknown };

    expect(body.planner).toEqual({
      running: false,
      lastRunAt: null,
      lastStatus: null,
      lastResult: null,
    });
  });

  it("returns the most recent Planner heartbeat", async () => {
    getDb()
      .prepare("INSERT INTO planner_run (ran_at, status, result) VALUES (?, ?, ?)")
      .run("2026-07-23T00:00:00.000Z", "ok", "pong");

    const response = GET();
    const body = (await response.json()) as {
      planner: {
        running: boolean;
        lastRunAt: string | null;
        lastStatus: string | null;
        lastResult: string | null;
      };
    };

    expect(body.planner).toEqual({
      running: false,
      lastRunAt: "2026-07-23T00:00:00.000Z",
      lastStatus: "ok",
      lastResult: "pong",
    });
  });
});
