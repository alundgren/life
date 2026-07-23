CREATE TABLE placeholder_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL
);

INSERT INTO placeholder_message (message)
VALUES ('Hello from SQLite — the UI to API to SQLite path works.');
