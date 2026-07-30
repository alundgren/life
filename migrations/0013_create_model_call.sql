CREATE TABLE model_call (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  called_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('plan-generation', 'plan-revision', 'correction-extraction', 'completion-digest')),
  model TEXT NOT NULL,
  request_text TEXT NOT NULL,
  response_text TEXT,
  error_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  outcome TEXT,
  CHECK (
    (status = 'ok' AND response_text IS NOT NULL AND error_text IS NULL)
    OR (status = 'error' AND response_text IS NULL AND error_text IS NOT NULL)
  )
);
