CREATE TABLE time_budget (
  mode TEXT PRIMARY KEY CHECK (mode IN ('work', 'vacation')),
  weekly_minutes INTEGER NOT NULL CHECK (weekly_minutes > 0)
);
