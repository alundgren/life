# The Simulated Clock overrides row-creation timestamps, not just "what day is it" reads

The Simulated Clock could have covered only the handful of explicit clock reads the Planner and UI already make (this week's Monday, today's date, the `planner_run` stamp), leaving `created_at`/`updated_at` on every table to keep coming from SQLite's own `DEFAULT (datetime('now'))`. Instead, when the Simulated Clock is active, application code supplies those timestamps explicitly on every insert, reading the simulated "now" instead of letting SQLite stamp the real one.

We chose this because a Scheduled Task's recurrence anchor is its own `created_at` (`scheduledTaskRecursInWeek`): a Task created while simulating three weeks out, but stamped with today's real date, would recur on the wrong weeks for the very scenario the Simulated Clock exists to test. The same desync risk applies to Correction ordering and Completion/Weekly Plan timestamps. Covering only the explicit reads would have been the smaller change, but would leave every row created during a simulated session silently anchored to real time.

The visible cost is that `task`, `correction`, `completion`, `weekly_plan`, and `planned_activity` inserts no longer rely on SQLite's `datetime('now')` default when the Simulated Clock is on — application code passes the timestamp explicitly instead. That default remains the real-time behavior when the flag is off.

**Update (ADR 0006):** the "when the flag is off" carve-out is gone. Application code now stamps those inserts unconditionally, because leaving production on SQLite's `datetime('now')` meant the recurrence anchor was derived from a UTC timestamp in a second format — the same desync this ADR set out to prevent, just triggered by deployment rather than by simulation.
