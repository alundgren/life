CREATE TABLE planner_heartbeat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_checked_at TEXT NOT NULL
);
