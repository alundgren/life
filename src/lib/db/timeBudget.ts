import { getDb } from "@/lib/db/client";
import type { ModeValue } from "@/lib/db/mode";

interface TimeBudgetRow {
  weekly_minutes: number;
}

/** A Mode's weekly chore-time budget in minutes, or undefined if not yet configured. */
export function getTimeBudget(mode: ModeValue): number | undefined {
  const row = getDb()
    .prepare("SELECT weekly_minutes FROM time_budget WHERE mode = ?")
    .get(mode) as TimeBudgetRow | undefined;
  return row?.weekly_minutes;
}

/** Sets a Mode's weekly chore-time budget, inserting or replacing the existing value. */
export function setTimeBudget(mode: ModeValue, minutes: number): void {
  getDb()
    .prepare(
      `INSERT INTO time_budget (mode, weekly_minutes) VALUES (?, ?)
       ON CONFLICT (mode) DO UPDATE SET weekly_minutes = excluded.weekly_minutes`
    )
    .run(mode, minutes);
}
