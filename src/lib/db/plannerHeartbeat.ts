import { getDb } from "@/lib/db/client";

interface PlannerHeartbeatRow {
  last_checked_at: string;
}

/** Marks that the Planner loop ticked, whether or not the tick had any effect. */
export function touchPlannerHeartbeat(checkedAt: string): void {
  getDb()
    .prepare(
      `INSERT INTO planner_heartbeat (id, last_checked_at) VALUES (1, :checkedAt)
       ON CONFLICT(id) DO UPDATE SET last_checked_at = excluded.last_checked_at`
    )
    .run({ checkedAt });
}

/** When the Planner loop last ticked, or null before its first tick. */
export function getPlannerLastCheckedAt(): string | null {
  const row = getDb()
    .prepare("SELECT last_checked_at FROM planner_heartbeat WHERE id = 1")
    .get() as PlannerHeartbeatRow | undefined;
  return row?.last_checked_at ?? null;
}
