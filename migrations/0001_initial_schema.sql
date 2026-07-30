CREATE TABLE placeholder_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL
);

INSERT INTO placeholder_message (message)
VALUES ('Hello from SQLite — the UI to API to SQLite path works.');

CREATE TABLE planner_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  result TEXT
);

CREATE TABLE task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'flexible')),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
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

CREATE TABLE correction (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_correction_task_id_created_at ON correction (task_id, created_at);

CREATE TABLE mode (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL CHECK (value IN ('work', 'vacation')),
  updated_at TEXT NOT NULL
);

INSERT INTO mode (id, value, updated_at) VALUES (1, 'work', datetime('now'));

CREATE TABLE time_budget (
  mode TEXT PRIMARY KEY CHECK (mode IN ('work', 'vacation')),
  weekly_minutes INTEGER NOT NULL CHECK (weekly_minutes >= 0)
);

INSERT INTO time_budget (mode, weekly_minutes) VALUES
  ('work', 180),
  ('vacation', 600);

CREATE TABLE weekly_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revised_at TEXT NOT NULL
);

CREATE TABLE planned_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekly_plan_id INTEGER NOT NULL REFERENCES weekly_plan (id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'missed')) DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_planned_activity_weekly_plan_id ON planned_activity (weekly_plan_id);

CREATE TABLE completion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  planned_activity_id INTEGER REFERENCES planned_activity (id) ON DELETE SET NULL,
  completed_date TEXT NOT NULL,
  note TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_completion_task_id ON completion (task_id);

CREATE TABLE completion_digest (
  task_id INTEGER PRIMARY KEY REFERENCES task (id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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

CREATE TABLE simulated_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  now TEXT NOT NULL
);
