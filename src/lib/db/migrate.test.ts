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

  it("backfills a Weekly Plan's Planner watermark from its creation timestamp", () => {
    const db = createDbClient(":memory:");
    db.exec(`
      CREATE TABLE schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE weekly_plan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_start_date TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const recordApplied = db.prepare("INSERT INTO schema_migrations (filename, applied_at) VALUES (@filename, @appliedAt)");
    const priorMigrations = [
      "0001_create_placeholder_message.sql",
      "0002_create_planner_run.sql",
      "0003_create_task.sql",
      "0004_create_correction.sql",
      "0005_create_mode.sql",
      "0006_create_time_budget.sql",
      "0007_create_weekly_plan.sql",
      "0008_create_planned_activity.sql",
      "0009_create_completion.sql",
      "0010_create_completion_digest.sql",
      "0011_seed_time_budgets.sql",
      "0013_create_model_call.sql",
      "0014_create_simulated_clock.sql",
      "0015_remove_ambient_timestamp_defaults.sql",
    ];
    for (const migration of priorMigrations) {
      recordApplied.run({ filename: migration, appliedAt: "2026-07-01 00:00:00" });
    }
    db.prepare(
      `INSERT INTO weekly_plan (week_start_date, created_at, updated_at)
       VALUES ('2026-07-27', '2026-07-27 09:00:00', '2026-07-27 09:00:00')`
    ).run();

    runMigrations(db);

    expect(
      db.prepare("SELECT revised_at FROM weekly_plan WHERE week_start_date = '2026-07-27'").get()
    ).toEqual({ revised_at: "2026-07-27 09:00:00" });
  });
});
