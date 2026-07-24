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

export class TaskUpdateTargetNotFoundError extends Error {
  constructor(id: number, kind: TaskKind) {
    super(`Task ${id} was not found as a ${kind} task`);
    this.name = "TaskUpdateTargetNotFoundError";
  }
}

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

export function updateScheduledTask(
  id: number,
  input: CreateScheduledTaskInput
): ScheduledTask {
  const db = getDb();
  const updateTask = db.prepare(
    "UPDATE task SET description = ? WHERE id = ? AND kind = 'scheduled'"
  );
  const updateScheduled = db.prepare(
    `UPDATE task_scheduled
     SET weekday = ?, start_time = ?, end_time = ?, recurrence_interval_weeks = ?
     WHERE task_id = ?`
  );

  db.transaction(() => {
    const taskResult = updateTask.run(input.description, id);
    if (taskResult.changes !== 1) {
      throw new TaskUpdateTargetNotFoundError(id, "scheduled");
    }

    const scheduledResult = updateScheduled.run(
      input.weekday,
      input.startTime,
      input.endTime,
      input.recurrenceIntervalWeeks,
      id
    );
    if (scheduledResult.changes !== 1) {
      throw new TaskUpdateTargetNotFoundError(id, "scheduled");
    }
  })();

  return getTaskById(id) as ScheduledTask;
}

export function updateFlexibleTask(id: number, input: CreateFlexibleTaskInput): FlexibleTask {
  const db = getDb();
  const updateTask = db.prepare(
    "UPDATE task SET description = ? WHERE id = ? AND kind = 'flexible'"
  );
  const updateFlexible = db.prepare(
    `UPDATE task_flexible
     SET frequency_text = ?, duration_minutes = ?
     WHERE task_id = ?`
  );

  db.transaction(() => {
    const taskResult = updateTask.run(input.description, id);
    if (taskResult.changes !== 1) {
      throw new TaskUpdateTargetNotFoundError(id, "flexible");
    }

    const flexibleResult = updateFlexible.run(input.frequencyText, input.durationMinutes, id);
    if (flexibleResult.changes !== 1) {
      throw new TaskUpdateTargetNotFoundError(id, "flexible");
    }
  })();

  return getTaskById(id) as FlexibleTask;
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
