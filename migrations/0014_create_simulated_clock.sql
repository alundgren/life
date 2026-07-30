CREATE TABLE simulated_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  now TEXT NOT NULL
);
