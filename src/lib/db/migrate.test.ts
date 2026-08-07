import { describe, expect, it } from "vitest";
import { createDbClient } from "./client";
import { runMigrations } from "./migrate";

describe("runMigrations", () => {
  it("applies the schema migrations to a fresh database and records them", () => {
    const db = createDbClient(":memory:");

    runMigrations(db);

    const applied = db.prepare("SELECT filename FROM schema_migrations").all();
    expect(applied).toEqual([
      { filename: "0001_initial_schema.sql" },
      { filename: "0002_planner_heartbeat.sql" },
      { filename: "0003_planner_lock.sql" },
    ]);

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
      .prepare("SELECT COUNT(*) as count FROM mode")
      .get() as { count: number };

    runMigrations(db);
    const after = db
      .prepare("SELECT COUNT(*) as count FROM mode")
      .get() as { count: number };

    expect(after.count).toBe(before.count);
  });

  it("removes SQLite's ambient timestamp defaults from domain tables", () => {
    const db = createDbClient(":memory:");
    runMigrations(db);

    for (const [table, column] of [
      ["task", "created_at"],
      ["correction", "created_at"],
      ["mode", "updated_at"],
      ["weekly_plan", "created_at"],
      ["weekly_plan", "updated_at"],
      ["planned_activity", "created_at"],
      ["completion", "created_at"],
      ["completion_digest", "updated_at"],
    ]) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        dflt_value: string | null;
      }>;
      expect(columns.find((entry) => entry.name === column)?.dflt_value).toBeNull();
    }
  });
});
