import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import { createWeeklyPlan, getWeeklyPlanByWeek } from "./weeklyPlan";

describe("weekly plan data access", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("creates a Weekly Plan for a given week and reads it back", () => {
    const plan = createWeeklyPlan("2026-07-20");

    expect(plan.weekStartDate).toBe("2026-07-20");
    expect(getWeeklyPlanByWeek("2026-07-20")).toEqual(plan);
  });

  it("is undefined for a week with no Weekly Plan", () => {
    expect(getWeeklyPlanByWeek("2026-07-20")).toBeUndefined();
  });

  it("rejects a second Weekly Plan for the same week", () => {
    createWeeklyPlan("2026-07-20");
    expect(() => createWeeklyPlan("2026-07-20")).toThrow();
  });
});
