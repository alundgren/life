CREATE TABLE planner_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  result TEXT
);
