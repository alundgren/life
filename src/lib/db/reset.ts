import { getDb } from "@/lib/db/client";
import { getCurrentTime } from "@/lib/simulatedClock";

// Children before parents, so this reads correctly even without relying on ON DELETE CASCADE.
const TABLES_IN_DELETE_ORDER = [
  "planned_activity",
  "completion",
  "completion_digest",
  "correction",
  "task_scheduled",
  "task_flexible",
  "task",
  "weekly_plan",
  "model_call",
  "planner_run",
  "planner_heartbeat",
  "simulated_clock",
  "mode",
  "time_budget",
];

/**
 * Wipes every domain table and restores Mode/Time Budget to their migration-seeded defaults,
 * in one transaction. `schema_migrations` and the SQLite file itself are left untouched.
 */
export function resetAllData(): void {
  const db = getDb();

  db.transaction(() => {
    for (const table of TABLES_IN_DELETE_ORDER) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    db.prepare("INSERT INTO mode (id, value, updated_at) VALUES (1, 'work', @updatedAt)").run({
      updatedAt: getCurrentTime().toISOString(),
    });
    db.prepare(
      "INSERT INTO time_budget (mode, weekly_minutes) VALUES ('work', 180), ('vacation', 600)"
    ).run();
  })();
}
