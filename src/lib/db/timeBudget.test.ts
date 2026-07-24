import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import { getTimeBudget, setTimeBudget } from "./timeBudget";

describe("time budget data access", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("is unset for a Mode until configured", () => {
    expect(getTimeBudget("work")).toBeUndefined();
    expect(getTimeBudget("vacation")).toBeUndefined();
  });

  it("stores and reads a Mode's Time Budget", () => {
    setTimeBudget("work", 180);
    expect(getTimeBudget("work")).toBe(180);
  });

  it("keeps each Mode's Time Budget independent of the other", () => {
    setTimeBudget("work", 180);
    setTimeBudget("vacation", 600);

    expect(getTimeBudget("work")).toBe(180);
    expect(getTimeBudget("vacation")).toBe(600);
  });

  it("updates a Mode's Time Budget in place when set again", () => {
    setTimeBudget("work", 180);
    setTimeBudget("work", 240);

    expect(getTimeBudget("work")).toBe(240);
  });

  it("accepts a Time Budget of zero minutes", () => {
    setTimeBudget("vacation", 0);
    expect(getTimeBudget("vacation")).toBe(0);
  });
});
