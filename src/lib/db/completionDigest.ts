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
      `INSERT INTO completion_digest (task_id, summary) VALUES (@taskId, @summary)
       ON CONFLICT (task_id) DO UPDATE SET summary = excluded.summary, updated_at = datetime('now')`
    )
    .run({ taskId, summary });

  return getCompletionDigest(taskId)!;
}

export function getCompletionDigest(taskId: number): CompletionDigest | undefined {
  const row = getDb()
    .prepare("SELECT task_id, summary, updated_at FROM completion_digest WHERE task_id = @taskId")
    .get({ taskId }) as CompletionDigestRow | undefined;
  return row ? rowToCompletionDigest(row) : undefined;
}

/** Current Completion Digest summaries keyed by Task id, for prompt assembly in one query. */
export function getCompletionDigestSummariesByTask(): Map<number, string> {
  const rows = getDb()
    .prepare("SELECT task_id, summary FROM completion_digest")
    .all() as Pick<CompletionDigestRow, "task_id" | "summary">[];
  return new Map(rows.map((row) => [row.task_id, row.summary]));
}

/** Rewrites a Task's Digest and removes its compacted raw Completions atomically. */
export function replaceCompletionDigestAndDeleteCompletions(
  taskId: number,
  summary: string,
  completionIds: number[]
): CompletionDigest {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO completion_digest (task_id, summary) VALUES (@taskId, @summary)
     ON CONFLICT (task_id) DO UPDATE SET summary = excluded.summary, updated_at = datetime('now')`
  );
  const deleteCompletions =
    completionIds.length === 0
      ? undefined
      : db.prepare(
          `DELETE FROM completion WHERE task_id = @taskId AND id IN (${completionIds
            .map((_, index) => `@completionId${index}`)
            .join(", ")})`
        );

  db.transaction(() => {
    upsert.run({ taskId, summary });
    deleteCompletions?.run({
      taskId,
      ...Object.fromEntries(completionIds.map((id, index) => [`completionId${index}`, id])),
    });
  })();

  return getCompletionDigest(taskId)!;
}
