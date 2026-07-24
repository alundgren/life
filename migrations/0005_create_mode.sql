CREATE TABLE mode (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL CHECK (value IN ('work', 'vacation')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO mode (id, value) VALUES (1, 'work');
