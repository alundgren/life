import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
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
});
