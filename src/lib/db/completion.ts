import { getDb } from "@/lib/db/client";

export interface Completion {
  id: number;
  taskId: number;
  plannedActivityId: number | undefined;
  completedDate: string;
  note: string | undefined;
  processedAt: string | undefined;
  createdAt: string;
}

export interface RecordCompletionInput {
  taskId: number;
  completedDate: string;
  plannedActivityId?: number;
  note?: string;
}

export class PlannedActivityAlreadyDoneError extends Error {
  constructor() {
    super("Planned Activity is already done.");
  }
}

interface CompletionRow {
  id: number;
  task_id: number;
  planned_activity_id: number | null;
  completed_date: string;
  note: string | null;
  processed_at: string | null;
  created_at: string;
}

const SELECT_COMPLETION_SQL =
  "SELECT id, task_id, planned_activity_id, completed_date, note, processed_at, created_at FROM completion";

function rowToCompletion(row: CompletionRow): Completion {
  return {
    id: row.id,
    taskId: row.task_id,
    plannedActivityId: row.planned_activity_id ?? undefined,
    completedDate: row.completed_date,
    note: row.note ?? undefined,
    processedAt: row.processed_at ?? undefined,
    createdAt: row.created_at,
  };
}

/** Records a Completion for a Task, optionally linked to a Planned Activity, or standing alone. */
export function recordCompletion(input: RecordCompletionInput): Completion {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO completion (task_id, planned_activity_id, completed_date, note)
     VALUES (?, ?, ?, ?)`
  );
  const readActivity = db.prepare("SELECT status FROM planned_activity WHERE id = ?");
  const markDone = db.prepare("UPDATE planned_activity SET status = 'done' WHERE id = ?");
  const touchPlan = db.prepare(
    `UPDATE weekly_plan SET updated_at = datetime('now')
     WHERE id = (SELECT weekly_plan_id FROM planned_activity WHERE id = ?)`
  );

  const id = db.transaction(() => {
    if (input.plannedActivityId !== undefined) {
      const activity = readActivity.get(input.plannedActivityId) as { status: string } | undefined;
      if (activity?.status === "done") {
        throw new PlannedActivityAlreadyDoneError();
      }
    }

    const result = insert.run(
      input.taskId,
      input.plannedActivityId ?? null,
      input.completedDate,
      input.note ?? null
    );

    if (input.plannedActivityId !== undefined) {
      markDone.run(input.plannedActivityId);
      touchPlan.run(input.plannedActivityId);
    }

    return Number(result.lastInsertRowid);
  })();

  return getCompletionById(id)!;
}

export function getCompletionById(id: number): Completion | undefined {
  const row = getDb()
    .prepare(`${SELECT_COMPLETION_SQL} WHERE id = ?`)
    .get(id) as CompletionRow | undefined;
  return row ? rowToCompletion(row) : undefined;
}

/** The most recent Completion date per Task, keyed by Task id. Never-completed Tasks are absent. */
export function getLatestCompletionDatesByTask(): Map<number, string> {
  const rows = getDb()
    .prepare(
      "SELECT task_id, MAX(completed_date) AS completed_date FROM completion GROUP BY task_id"
    )
    .all() as { task_id: number; completed_date: string }[];
  return new Map(rows.map((row) => [row.task_id, row.completed_date]));
}

/** Whether any Completion was recorded at or after a Planner watermark. */
export function hasCompletionsSince(timestamp: string): boolean {
  const row = getDb()
    .prepare("SELECT EXISTS(SELECT 1 FROM completion WHERE created_at >= ?) AS exists_since")
    .get(timestamp) as { exists_since: number };
  return row.exists_since === 1;
}

/** Completions whose completed dates fall within an inclusive calendar-date range. */
export function listCompletionsForDateRange(startDate: string, endDate: string): Completion[] {
  const rows = getDb()
    .prepare(
      `${SELECT_COMPLETION_SQL}
       WHERE completed_date >= ? AND completed_date <= ?
       ORDER BY completed_date ASC, id ASC`
    )
    .all(startDate, endDate) as CompletionRow[];
  return rows.map(rowToCompletion);
}

/** Completions not yet considered for Correction extraction. */
export function listUnprocessedCompletions(): Completion[] {
  const rows = getDb()
    .prepare(`${SELECT_COMPLETION_SQL} WHERE processed_at IS NULL ORDER BY id`)
    .all() as CompletionRow[];
  return rows.map(rowToCompletion);
}

/** Marks a Completion as considered for Correction extraction. */
export function markCompletionProcessed(id: number): void {
  getDb().prepare("UPDATE completion SET processed_at = datetime('now') WHERE id = ?").run(id);
}
