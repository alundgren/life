-- SQLite cannot remove a column default in place. Rebuild the timestamp-owning tables so every
-- domain row is stamped by application code with a single UTC ISO-8601 representation.
CREATE TABLE task_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'flexible')),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE task_scheduled_new (
  task_id INTEGER PRIMARY KEY REFERENCES task_new (id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  recurrence_interval_weeks INTEGER NOT NULL CHECK (recurrence_interval_weeks >= 1)
);

CREATE TABLE task_flexible_new (
  task_id INTEGER PRIMARY KEY REFERENCES task_new (id) ON DELETE CASCADE,
  frequency_text TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0)
);

CREATE TABLE correction_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES task_new (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE weekly_plan_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revised_at TEXT NOT NULL
);

CREATE TABLE planned_activity_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekly_plan_id INTEGER NOT NULL REFERENCES weekly_plan_new (id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES task_new (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'missed')) DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE completion_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES task_new (id) ON DELETE CASCADE,
  planned_activity_id INTEGER REFERENCES planned_activity_new (id) ON DELETE SET NULL,
  completed_date TEXT NOT NULL,
  note TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE completion_digest_new (
  task_id INTEGER PRIMARY KEY REFERENCES task_new (id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mode_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL CHECK (value IN ('work', 'vacation')),
  updated_at TEXT NOT NULL
);

INSERT INTO task_new SELECT id, kind, description, created_at FROM task;
INSERT INTO task_scheduled_new SELECT task_id, weekday, start_time, end_time, recurrence_interval_weeks FROM task_scheduled;
INSERT INTO task_flexible_new SELECT task_id, frequency_text, duration_minutes FROM task_flexible;
INSERT INTO correction_new SELECT id, task_id, text, created_at FROM correction;
INSERT INTO weekly_plan_new SELECT id, week_start_date, created_at, updated_at, revised_at FROM weekly_plan;
INSERT INTO planned_activity_new SELECT id, weekly_plan_id, task_id, date, status, created_at FROM planned_activity;
INSERT INTO completion_new SELECT id, task_id, planned_activity_id, completed_date, note, processed_at, created_at FROM completion;
INSERT INTO completion_digest_new SELECT task_id, summary, updated_at FROM completion_digest;
INSERT INTO mode_new SELECT id, value, updated_at FROM mode;

DROP TABLE completion;
DROP TABLE planned_activity;
DROP TABLE completion_digest;
DROP TABLE correction;
DROP TABLE task_scheduled;
DROP TABLE task_flexible;
DROP TABLE weekly_plan;
DROP TABLE task;
DROP TABLE mode;

ALTER TABLE task_new RENAME TO task;
ALTER TABLE weekly_plan_new RENAME TO weekly_plan;
ALTER TABLE task_scheduled_new RENAME TO task_scheduled;
ALTER TABLE task_flexible_new RENAME TO task_flexible;
ALTER TABLE correction_new RENAME TO correction;
ALTER TABLE planned_activity_new RENAME TO planned_activity;
ALTER TABLE completion_new RENAME TO completion;
ALTER TABLE completion_digest_new RENAME TO completion_digest;
ALTER TABLE mode_new RENAME TO mode;

CREATE INDEX idx_correction_task_id_created_at ON correction (task_id, created_at);
CREATE INDEX idx_planned_activity_weekly_plan_id ON planned_activity (weekly_plan_id);
CREATE INDEX idx_completion_task_id ON completion (task_id);
