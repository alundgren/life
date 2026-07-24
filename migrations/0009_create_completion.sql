CREATE TABLE completion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  planned_activity_id INTEGER REFERENCES planned_activity (id) ON DELETE SET NULL,
  completed_date TEXT NOT NULL,
  note TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_completion_task_id ON completion (task_id);
