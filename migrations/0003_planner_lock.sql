CREATE TABLE planner_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  running INTEGER NOT NULL DEFAULT 0 CHECK (running IN (0, 1)),
  in_flight INTEGER NOT NULL DEFAULT 0 CHECK (in_flight IN (0, 1))
);

INSERT INTO planner_lock (id, running, in_flight) VALUES (1, 0, 0);
