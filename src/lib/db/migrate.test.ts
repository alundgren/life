import { describe, expect, it } from "vitest";
import { createDbClient } from "./client";
import { runMigrations } from "./migrate";

describe("runMigrations", () => {
  it("applies all migrations to a fresh database and records them", () => {
    const db = createDbClient(":memory:");

    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toContain("placeholder_message");

    const applied = db.prepare("SELECT filename FROM schema_migrations").all();
    expect(applied.length).toBeGreaterThan(0);

    const budgets = db.prepare("SELECT mode, weekly_minutes FROM time_budget ORDER BY mode").all();
    expect(budgets).toEqual([
      { mode: "vacation", weekly_minutes: 600 },
      { mode: "work", weekly_minutes: 180 },
    ]);
  });

  it("does not re-apply already-applied migrations", () => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    const before = db
      .prepare("SELECT COUNT(*) as count FROM placeholder_message")
      .get() as { count: number };

    runMigrations(db);
    const after = db
      .prepare("SELECT COUNT(*) as count FROM placeholder_message")
      .get() as { count: number };

    expect(after.count).toBe(before.count);
  });
});
