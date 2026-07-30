# Life — Recurring Task Planning

Domain for tracking recurring personal tasks (training, chores, errands), surfacing what to do each day, recording completions, and letting the plan evolve from user feedback over time.

## Language

**Task**:
The standing definition of a piece of recurring work — a free-text description of what to do, plus a Frequency. Comes in two kinds: Scheduled or Flexible. The description is mutable via Corrections; at any moment it holds only its current, latest form.
_Avoid_: Chore, activity

**Scheduled Task**:
A Task whose Frequency is structured — a specific weekday, start time, end time, and recurrence interval (e.g. "Tuesdays 16:00–19:00, weekly"). The Planner places it at that exact slot every time it recurs, honoring it even when it falls inside hours Mode would otherwise treat as busy.
_Avoid_: Fixed task, exact task

**Flexible Task**:
A Task whose Frequency is free text describing how often it's wanted (e.g. "about every three months"), re-interpreted by the Planner at each planning run rather than stored as a structured rule. Placed at day granularity only — no time slot — and its Duration is drawn from the week's Time Budget.
_Avoid_: Vague task, loose task

**Frequency**:
How often a Task is wanted. Structured (weekday, start/end time, recurrence) for a Scheduled Task; free text for a Flexible Task.

**Duration**:
An estimate of how long a Task takes (e.g. "30 minutes"). Used by the Planner to size a Scheduled Task's slot and to fit Flexible Tasks within the week's Time Budget.

**Correction**:
Text that overwrites a Task's current description going forward. Only the most recent N Corrections per Task are kept, as a rolling log giving the Planner recent context — older ones are discarded outright, not summarized. The Task's description always reflects the latest Correction applied; there is no full audit trail.
_Avoid_: Edit, update, revision

**Completion**:
A record that a Task was done on a specific date, with an optional free-text note on how it went. May reference a Planned Activity, or stand alone — a Task can be completed even on a day the Planner never suggested it. At the Planner's next run, an unprocessed Completion's note may become a Correction if it implies the Task's description should change.
_Avoid_: Log entry, check-in

**Completion Digest**:
An LLM-generated rolling summary that replaces a Task's older Completions once they age out of the recent window. Compaction is lossy by design — raw rows are deleted once folded into the Digest, trading detail for bounded growth.
_Avoid_: History, archive

**Planned Activity**:
A single day's instance of a Task within a Weekly Plan, with a status of Pending, Done, or Missed. Inherits a fixed time slot from a Scheduled Task; is day-level only for a Flexible Task. A Flexible Task left off the plan due to Time Budget limits never gets a Planned Activity at all, so it's never Missed — just not yet planned.
_Avoid_: Occurrence, instance, suggestion

**Weekly Plan**:
The set of Planned Activities the Planner has generated for a given week. Mutable — the Planner can revise not-yet-completed days within the current week as new Completions or Corrections arrive, not only at the next week's generation.
_Avoid_: Schedule, agenda

**Planner**:
The LLM-driven process that generates and revises Weekly Plans, places Tasks within Mode and Time Budget constraints, and turns Completion notes into Corrections.
_Avoid_: Worker, agent, scheduler

**Model Call**:
A single request sent to the LLM and what came back — either its response or the error that prevented one. Kept only as a bounded, recent record for judging how well the Planner is working; nothing in the domain ever reads one back.
_Avoid_: Prompt log, request/response pair, LLM exchange

**Mode**:
A single global toggle — Work or Vacation — for the whole (single-user) system. Determines the weekly Time Budget available to Flexible Tasks and which weekday hours are assumed busy. Scheduled Tasks' fixed slots are honored regardless of Mode.
_Avoid_: Profile, setting

**Simulated Clock**:
A dev-only override of what the whole app treats as "now" — a single explicit timestamp that changes only when moved forward by hand, never by the passage of real time. When active, it replaces every read of the current date or time the app makes, including the timestamps new rows are stamped with, and it takes over the Planner's run loop: automatic runs stop and a run only happens when triggered by hand.
_Avoid_: Fake clock, test clock, mock time, dev clock

**Time Budget**:
The total weekly chore-time the Planner has available for Flexible Tasks, configured per Mode. When due Flexible Tasks' Durations exceed it, the Planner leaves the least-urgent ones off this week's Weekly Plan — they stay due and are reconsidered next time.
