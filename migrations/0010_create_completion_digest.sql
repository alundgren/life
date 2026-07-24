CREATE TABLE completion_digest (
  task_id INTEGER PRIMARY KEY REFERENCES task (id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
