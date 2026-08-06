import { getDb } from "@/lib/db/client";

export type PlannerRunStatus = "ok" | "error";

export interface PlannerRun {
  ranAt: string;
  status: PlannerRunStatus;
  result: string | null;
}

interface PlannerRunRow {
  ran_at: string;
  status: PlannerRunStatus;
  result: string | null;
}

const MAX_PLANNER_RUNS = 500;

/** Records one effectful Planner run and retains only the newest 500 rows as one transaction. */
export function createPlannerRun(input: PlannerRun): void {
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO planner_run (ran_at, status, result) VALUES (:ranAt, :status, :result)"
  );
  const trim = db.prepare(
    "DELETE FROM planner_run WHERE id NOT IN (SELECT id FROM planner_run ORDER BY id DESC LIMIT :limit)"
  );

  db.transaction(() => {
    insert.run({ ranAt: input.ranAt, status: input.status, result: input.result });
    trim.run({ limit: MAX_PLANNER_RUNS });
  })();
}

/** The most recent Planner run, which is the only one the status view reads. */
export function getLatestPlannerRun(): PlannerRun | undefined {
  const row = getDb()
    .prepare("SELECT ran_at, status, result FROM planner_run ORDER BY id DESC LIMIT 1")
    .get() as PlannerRunRow | undefined;

  return row === undefined
    ? undefined
    : { ranAt: row.ran_at, status: row.status, result: row.result };
}
