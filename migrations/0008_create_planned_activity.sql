CREATE TABLE planned_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekly_plan_id INTEGER NOT NULL REFERENCES weekly_plan (id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'missed')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_planned_activity_weekly_plan_id ON planned_activity (weekly_plan_id);
