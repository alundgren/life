import { getDb } from "@/lib/db/client";

export type ModelCallKind =
  | "plan-generation"
  | "plan-revision"
  | "correction-extraction"
  | "completion-digest";
export type ModelCallStatus = "ok" | "error";

export interface NewModelCall {
  calledAt: string;
  kind: ModelCallKind;
  model: string;
  requestText: string;
  responseText?: string;
  errorText?: string;
  status: ModelCallStatus;
  durationMs: number;
}

export interface ModelCallPreview {
  id: number;
  calledAt: string;
  kind: ModelCallKind;
  model: string;
  status: ModelCallStatus;
  durationMs: number;
  outcome: string | undefined;
  requestPreview: string;
  responsePreview: string | undefined;
  errorPreview: string | undefined;
}

export interface ModelCall extends Omit<ModelCallPreview, "requestPreview" | "responsePreview" | "errorPreview"> {
  requestText: string;
  responseText: string | undefined;
  errorText: string | undefined;
}

interface ModelCallRow {
  id: number;
  called_at: string;
  kind: ModelCallKind;
  model: string;
  request_text: string;
  response_text: string | null;
  error_text: string | null;
  status: ModelCallStatus;
  duration_ms: number;
  outcome: string | null;
}

interface ModelCallPreviewRow {
  id: number;
  called_at: string;
  kind: ModelCallKind;
  model: string;
  status: ModelCallStatus;
  duration_ms: number;
  outcome: string | null;
  request_preview: string;
  response_preview: string | null;
  error_preview: string | null;
}

const MAX_MODEL_CALLS = 100;
const PREVIEW_LENGTH = 160;

function optional(value: string | null): string | undefined {
  return value ?? undefined;
}

function rowToModelCall(row: ModelCallRow): ModelCall {
  return {
    id: row.id,
    calledAt: row.called_at,
    kind: row.kind,
    model: row.model,
    requestText: row.request_text,
    responseText: optional(row.response_text),
    errorText: optional(row.error_text),
    status: row.status,
    durationMs: row.duration_ms,
    outcome: optional(row.outcome),
  };
}

/** Writes one Model Call and retains only the newest 100 rows as one transaction. */
export function createModelCall(input: NewModelCall): number {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO model_call (
      called_at, kind, model, request_text, response_text, error_text, status, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const trim = db.prepare(
    `DELETE FROM model_call
     WHERE id NOT IN (SELECT id FROM model_call ORDER BY called_at DESC, id DESC LIMIT ?)`
  );

  return db.transaction(() => {
    const result = insert.run(
      input.calledAt,
      input.kind,
      input.model,
      input.requestText,
      input.responseText ?? null,
      input.errorText ?? null,
      input.status,
      input.durationMs
    );
    trim.run(MAX_MODEL_CALLS);
    return Number(result.lastInsertRowid);
  })();
}

/** Records what the Planner ultimately made of a Model Call response. */
export function attachModelCallOutcome(id: number, outcome: string): void {
  getDb().prepare("UPDATE model_call SET outcome = ? WHERE id = ?").run(outcome, id);
}

/** Lists newest Model Calls with deliberately truncated request, response, and error text. */
export function listRecentModelCalls(): ModelCallPreview[] {
  const rows = getDb()
    .prepare(
      `SELECT
         id, called_at, kind, model, status, duration_ms, outcome,
         CASE WHEN length(request_text) > :previewLength THEN substr(request_text, 1, :previewLength) || '…' ELSE request_text END AS request_preview,
         CASE WHEN length(response_text) > :previewLength THEN substr(response_text, 1, :previewLength) || '…' ELSE response_text END AS response_preview,
         CASE WHEN length(error_text) > :previewLength THEN substr(error_text, 1, :previewLength) || '…' ELSE error_text END AS error_preview
       FROM model_call ORDER BY called_at DESC, id DESC`
    )
    .all({ previewLength: PREVIEW_LENGTH }) as ModelCallPreviewRow[];

  return rows.map((row) => ({
    id: row.id,
    calledAt: row.called_at,
    kind: row.kind,
    model: row.model,
    status: row.status,
    durationMs: row.duration_ms,
    outcome: optional(row.outcome),
    requestPreview: row.request_preview,
    responsePreview: optional(row.response_preview),
    errorPreview: optional(row.error_preview),
  }));
}

/** Finds a full Model Call for the on-demand diagnostic detail view. */
export function getModelCallById(id: number): ModelCall | undefined {
  const row = getDb()
    .prepare(
      `SELECT id, called_at, kind, model, request_text, response_text, error_text, status, duration_ms, outcome
       FROM model_call WHERE id = ?`
    )
    .get(id) as ModelCallRow | undefined;
  return row === undefined ? undefined : rowToModelCall(row);
}
