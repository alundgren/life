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
  const result = getDb()
    .prepare(
      `INSERT INTO completion (task_id, planned_activity_id, completed_date, note)
       VALUES (?, ?, ?, ?)`
    )
    .run(input.taskId, input.plannedActivityId ?? null, input.completedDate, input.note ?? null);

  return getCompletionById(Number(result.lastInsertRowid))!;
}

export function getCompletionById(id: number): Completion | undefined {
  const row = getDb()
    .prepare(`${SELECT_COMPLETION_SQL} WHERE id = ?`)
    .get(id) as CompletionRow | undefined;
  return row ? rowToCompletion(row) : undefined;
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
