CREATE TABLE task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'flexible')),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE task_scheduled (
  task_id INTEGER PRIMARY KEY REFERENCES task (id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  recurrence_interval_weeks INTEGER NOT NULL CHECK (recurrence_interval_weeks >= 1)
);

CREATE TABLE task_flexible (
  task_id INTEGER PRIMARY KEY REFERENCES task (id) ON DELETE CASCADE,
  frequency_text TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0)
);
