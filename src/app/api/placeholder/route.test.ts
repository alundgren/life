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

  it("returns null plannerRun when the Planner has not run yet", async () => {
    const response = GET();
    const body = (await response.json()) as { plannerRun: unknown };

    expect(body.plannerRun).toBeNull();
  });

  it("returns the most recent Planner heartbeat", async () => {
    getDb()
      .prepare("INSERT INTO planner_run (ran_at, status, result) VALUES (?, ?, ?)")
      .run("2026-07-23T00:00:00.000Z", "ok", "pong");

    const response = GET();
    const body = (await response.json()) as {
      plannerRun: { ranAt: string; status: string; result: string | null } | null;
    };

    expect(body.plannerRun).toEqual({
      ranAt: "2026-07-23T00:00:00.000Z",
      status: "ok",
      result: "pong",
    });
  });
});
