# Weekly Plans are mutable, not fixed once generated

A Weekly Plan could have been treated as immutable once generated — corrections and completion notes would only ever influence the *next* week's plan. Instead, the Planner is allowed to revise not-yet-completed Planned Activities within the current week whenever new Completions or Corrections arrive.

We chose this because the Planner runs on an LLM reacting to live feedback (e.g. "actually do 20 reps not 15", or a completion note implying a Task changed) — waiting until next week to act on that would leave the current week visibly stale. The cost is that the Planner must be safe to re-run mid-week: it must never touch Planned Activities already marked Done or Missed, only the remaining Pending ones.
