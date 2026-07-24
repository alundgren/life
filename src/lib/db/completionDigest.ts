import { getDb } from "@/lib/db/client";

export interface CompletionDigest {
  taskId: number;
  summary: string;
  updatedAt: string;
}

interface CompletionDigestRow {
  task_id: number;
  summary: string;
  updated_at: string;
}

function rowToCompletionDigest(row: CompletionDigestRow): CompletionDigest {
  return {
    taskId: row.task_id,
    summary: row.summary,
    updatedAt: row.updated_at,
  };
}

/** Inserts or replaces a Task's Completion Digest — at most one per Task. */
export function upsertCompletionDigest(taskId: number, summary: string): CompletionDigest {
  getDb()
    .prepare(
      `INSERT INTO completion_digest (task_id, summary) VALUES (?, ?)
       ON CONFLICT (task_id) DO UPDATE SET summary = excluded.summary, updated_at = datetime('now')`
    )
    .run(taskId, summary);

  return getCompletionDigest(taskId)!;
}

export function getCompletionDigest(taskId: number): CompletionDigest | undefined {
  const row = getDb()
    .prepare("SELECT task_id, summary, updated_at FROM completion_digest WHERE task_id = ?")
    .get(taskId) as CompletionDigestRow | undefined;
  return row ? rowToCompletionDigest(row) : undefined;
}
