import { getDb } from "@/lib/db/client";

export interface Correction {
  id: number;
  taskId: number;
  text: string;
  createdAt: string;
}

interface CorrectionRow {
  id: number;
  task_id: number;
  text: string;
  created_at: string;
}

function rowToCorrection(row: CorrectionRow): Correction {
  return {
    id: row.id,
    taskId: row.task_id,
    text: row.text,
    createdAt: row.created_at,
  };
}

/** Inserts a Correction and updates the Task's description to match, in one transaction. */
export function applyCorrection(taskId: number, text: string): void {
  const db = getDb();
  const insertCorrection = db.prepare("INSERT INTO correction (task_id, text) VALUES (?, ?)");
  const updateDescription = db.prepare("UPDATE task SET description = ? WHERE id = ?");

  db.transaction(() => {
    insertCorrection.run(taskId, text);
    updateDescription.run(text, taskId);
  })();
}

/** A Task's Corrections in chronological order (oldest first). */
export function listCorrections(taskId: number): Correction[] {
  const rows = getDb()
    .prepare(
      "SELECT id, task_id, text, created_at FROM correction WHERE task_id = ? ORDER BY created_at ASC, id ASC"
    )
    .all(taskId) as CorrectionRow[];
  return rows.map(rowToCorrection);
}

/** Whether any Correction was recorded at or after a Planner watermark. */
export function hasCorrectionsSince(timestamp: string): boolean {
  const row = getDb()
    .prepare("SELECT EXISTS(SELECT 1 FROM correction WHERE created_at >= ?) AS exists_since")
    .get(timestamp) as { exists_since: number };
  return row.exists_since === 1;
}
