import { getDb } from "@/lib/db/client";

export type TaskKind = "scheduled" | "flexible";

interface TaskBase {
  id: number;
  description: string;
  createdAt: string;
}

export interface ScheduledTask extends TaskBase {
  kind: "scheduled";
  weekday: number;
  startTime: string;
  endTime: string;
  recurrenceIntervalWeeks: number;
}

export interface FlexibleTask extends TaskBase {
  kind: "flexible";
  frequencyText: string;
  durationMinutes: number;
}

export type Task = ScheduledTask | FlexibleTask;

export interface CreateScheduledTaskInput {
  description: string;
  weekday: number;
  startTime: string;
  endTime: string;
  recurrenceIntervalWeeks: number;
}

export interface CreateFlexibleTaskInput {
  description: string;
  frequencyText: string;
  durationMinutes: number;
}

/** Same fields as {@link CreateScheduledTaskInput}; the id is passed separately, not in the body. */
export type UpdateScheduledTaskInput = CreateScheduledTaskInput;

/** Same fields as {@link CreateFlexibleTaskInput}; the id is passed separately, not in the body. */
export type UpdateFlexibleTaskInput = CreateFlexibleTaskInput;

interface TaskRow {
  id: number;
  kind: TaskKind;
  description: string;
  created_at: string;
  weekday: number | null;
  start_time: string | null;
  end_time: string | null;
  recurrence_interval_weeks: number | null;
  frequency_text: string | null;
  duration_minutes: number | null;
}

const SELECT_TASK_SQL = `
  SELECT
    t.id, t.kind, t.description, t.created_at,
    ts.weekday, ts.start_time, ts.end_time, ts.recurrence_interval_weeks,
    tf.frequency_text, tf.duration_minutes
  FROM task t
  LEFT JOIN task_scheduled ts ON ts.task_id = t.id
  LEFT JOIN task_flexible tf ON tf.task_id = t.id
`;

function rowToTask(row: TaskRow): Task {
  const base = { id: row.id, description: row.description, createdAt: row.created_at };

  if (row.kind === "scheduled") {
    return {
      ...base,
      kind: "scheduled",
      weekday: row.weekday!,
      startTime: row.start_time!,
      endTime: row.end_time!,
      recurrenceIntervalWeeks: row.recurrence_interval_weeks!,
    };
  }

  return {
    ...base,
    kind: "flexible",
    frequencyText: row.frequency_text!,
    durationMinutes: row.duration_minutes!,
  };
}

/** Inserts the parent `task` row and its `task_scheduled` child row in one transaction. */
export function createScheduledTask(input: CreateScheduledTaskInput): ScheduledTask {
  const db = getDb();
  const insertTask = db.prepare("INSERT INTO task (kind, description) VALUES ('scheduled', ?)");
  const insertScheduled = db.prepare(
    `INSERT INTO task_scheduled (task_id, weekday, start_time, end_time, recurrence_interval_weeks)
     VALUES (?, ?, ?, ?, ?)`
  );

  const taskId = db.transaction(() => {
    const result = insertTask.run(input.description);
    const id = Number(result.lastInsertRowid);
    insertScheduled.run(
      id,
      input.weekday,
      input.startTime,
      input.endTime,
      input.recurrenceIntervalWeeks
    );
    return id;
  })();

  return getTaskById(taskId) as ScheduledTask;
}

/** Inserts the parent `task` row and its `task_flexible` child row in one transaction. */
export function createFlexibleTask(input: CreateFlexibleTaskInput): FlexibleTask {
  const db = getDb();
  const insertTask = db.prepare("INSERT INTO task (kind, description) VALUES ('flexible', ?)");
  const insertFlexible = db.prepare(
    "INSERT INTO task_flexible (task_id, frequency_text, duration_minutes) VALUES (?, ?, ?)"
  );

  const taskId = db.transaction(() => {
    const result = insertTask.run(input.description);
    const id = Number(result.lastInsertRowid);
    insertFlexible.run(id, input.frequencyText, input.durationMinutes);
    return id;
  })();

  return getTaskById(taskId) as FlexibleTask;
}

/**
 * Updates a Scheduled Task's parent `description` and its `task_scheduled` fields in one
 * transaction. Returns the updated `ScheduledTask`, or `undefined` when no Scheduled Task
 * with that id exists — the kind guard is folded into the parent `UPDATE ... WHERE` so the
 * check and the write are atomic, and a Flexible Task's row is never written by this path.
 */
export function updateScheduledTask(
  id: number,
  input: UpdateScheduledTaskInput
): ScheduledTask | undefined {
  const db = getDb();
  const updateTask = db.prepare(
    "UPDATE task SET description = ? WHERE id = ? AND kind = 'scheduled'"
  );
  const updateScheduled = db.prepare(
    `UPDATE task_scheduled
     SET weekday = ?, start_time = ?, end_time = ?, recurrence_interval_weeks = ?
     WHERE task_id = ?`
  );

  const ok = db.transaction(() => {
    if (updateTask.run(input.description, id).changes !== 1) {
      return false;
    }
    updateScheduled.run(
      input.weekday,
      input.startTime,
      input.endTime,
      input.recurrenceIntervalWeeks,
      id
    );
    return true;
  })();

  return ok ? (getTaskById(id) as ScheduledTask) : undefined;
}

/**
 * Updates a Flexible Task's parent `description` and its `task_flexible` fields in one
 * transaction. Returns the updated `FlexibleTask`, or `undefined` when no Flexible Task
 * with that id exists — the kind guard is folded into the parent `UPDATE ... WHERE` so the
 * check and the write are atomic, and a Scheduled Task's row is never written by this path.
 */
export function updateFlexibleTask(
  id: number,
  input: UpdateFlexibleTaskInput
): FlexibleTask | undefined {
  const db = getDb();
  const updateTask = db.prepare(
    "UPDATE task SET description = ? WHERE id = ? AND kind = 'flexible'"
  );
  const updateFlexible = db.prepare(
    "UPDATE task_flexible SET frequency_text = ?, duration_minutes = ? WHERE task_id = ?"
  );

  const ok = db.transaction(() => {
    if (updateTask.run(input.description, id).changes !== 1) {
      return false;
    }
    updateFlexible.run(input.frequencyText, input.durationMinutes, id);
    return true;
  })();

  return ok ? (getTaskById(id) as FlexibleTask) : undefined;
}

export function getTaskById(id: number): Task | undefined {
  const row = getDb()
    .prepare(`${SELECT_TASK_SQL} WHERE t.id = ?`)
    .get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : undefined;
}

export function listTasks(): Task[] {
  const rows = getDb().prepare(`${SELECT_TASK_SQL} ORDER BY t.id`).all() as TaskRow[];
  return rows.map(rowToTask);
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** A Task's Duration in minutes — derived from start/end for a Scheduled Task, stored directly for a Flexible Task. */
export function taskDurationMinutes(task: Task): number {
  if (task.kind === "flexible") {
    return task.durationMinutes;
  }
  return timeToMinutes(task.endTime) - timeToMinutes(task.startTime);
}
