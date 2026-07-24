CREATE TABLE weekly_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE planned_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekly_plan_id INTEGER NOT NULL REFERENCES weekly_plan (id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'missed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_planned_activity_weekly_plan_id ON planned_activity (weekly_plan_id);
CREATE INDEX idx_planned_activity_task_id ON planned_activity (task_id);

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
CREATE INDEX idx_completion_planned_activity_id ON completion (planned_activity_id);
CREATE INDEX idx_completion_processed_at ON completion (processed_at);

CREATE TABLE completion_digest (
  task_id INTEGER PRIMARY KEY REFERENCES task (id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
