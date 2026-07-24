import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import { getMode, setMode } from "./mode";

describe("mode data access", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("resolves to the seeded default of 'work' before any Mode is set", () => {
    expect(getMode()).toBe("work");
  });

  it("switches Mode and the singleton reflects the new value", () => {
    setMode("vacation");
    expect(getMode()).toBe("vacation");

    setMode("work");
    expect(getMode()).toBe("work");
  });
});
