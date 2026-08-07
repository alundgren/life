import { getDb } from "@/lib/db/client";

interface PlannerLockRow {
  running: number;
  in_flight: number;
}

function readLock(): PlannerLockRow {
  return getDb().prepare("SELECT running, in_flight FROM planner_lock WHERE id = 1").get() as PlannerLockRow;
}

/** Whether the Planner's background loop is active in this process. */
export function isPlannerRunning(): boolean {
  return readLock().running === 1;
}

export function setPlannerRunning(running: boolean): void {
  getDb()
    .prepare("UPDATE planner_lock SET running = :running WHERE id = 1")
    .run({ running: running ? 1 : 0 });
}

/** Whether a Planner run is currently mid-flight, so callers can avoid racing it. */
export function isPlannerRunInFlight(): boolean {
  return readLock().in_flight === 1;
}

/**
 * Atomically claims the in-flight slot; false means another run already holds it. The
 * UPDATE...WHERE is the entire check-and-set, so two module instances of this file (or any
 * other caller) can never both succeed for the same slot.
 */
export function tryAcquirePlannerRun(): boolean {
  const result = getDb()
    .prepare("UPDATE planner_lock SET in_flight = 1 WHERE id = 1 AND in_flight = 0")
    .run();
  return result.changes > 0;
}

export function releasePlannerRun(): void {
  getDb().prepare("UPDATE planner_lock SET in_flight = 0 WHERE id = 1").run();
}
