"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { Task, TaskKind } from "@/lib/db/task";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type FormState = {
  kind: TaskKind;
  description: string;
  weekday: number;
  startTime: string;
  endTime: string;
  recurrenceIntervalWeeks: number;
  frequencyText: string;
  durationMinutes: number;
};

const EMPTY_FORM: FormState = {
  kind: "scheduled",
  description: "",
  weekday: 1,
  startTime: "16:00",
  endTime: "17:00",
  recurrenceIntervalWeeks: 1,
  frequencyText: "",
  durationMinutes: 30,
};

function formFromTask(task: Task): FormState {
  if (task.kind === "scheduled") {
    return {
      ...EMPTY_FORM,
      kind: "scheduled",
      description: task.description,
      weekday: task.weekday,
      startTime: task.startTime,
      endTime: task.endTime,
      recurrenceIntervalWeeks: task.recurrenceIntervalWeeks,
    };
  }
  return {
    ...EMPTY_FORM,
    kind: "flexible",
    description: task.description,
    frequencyText: task.frequencyText,
    durationMinutes: task.durationMinutes,
  };
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Client-side mirror of the API validation, so obvious mistakes are caught before a round-trip. */
function validateForm(form: FormState): string | null {
  if (form.description.trim() === "") {
    return "Description is required.";
  }
  if (form.kind === "scheduled") {
    if (!TIME_PATTERN.test(form.startTime) || !TIME_PATTERN.test(form.endTime)) {
      return "Start and end times must be valid HH:MM times.";
    }
    if (timeToMinutes(form.endTime) <= timeToMinutes(form.startTime)) {
      return "End time must be after start time.";
    }
    if (!Number.isInteger(form.recurrenceIntervalWeeks) || form.recurrenceIntervalWeeks < 1) {
      return "Recurrence interval must be a whole number of weeks, at least 1.";
    }
    return null;
  }
  if (form.frequencyText.trim() === "") {
    return "Frequency is required.";
  }
  if (!Number.isInteger(form.durationMinutes) || form.durationMinutes <= 0) {
    return "Duration must be a whole number of minutes greater than 0.";
  }
  return null;
}

function toPayload(form: FormState) {
  if (form.kind === "scheduled") {
    return {
      kind: "scheduled",
      description: form.description.trim(),
      weekday: form.weekday,
      startTime: form.startTime,
      endTime: form.endTime,
      recurrenceIntervalWeeks: form.recurrenceIntervalWeeks,
    };
  }
  return {
    kind: "flexible",
    description: form.description.trim(),
    frequencyText: form.frequencyText.trim(),
    durationMinutes: form.durationMinutes,
  };
}

const fieldClass =
  "w-full rounded-md border border-muted/40 bg-background px-3 py-2 text-base";
const labelClass = "flex flex-col gap-1 text-sm font-medium";

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadTasks() {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error("bad status");
      setTasks((await res.json()) as Task[]);
    } catch {
      setLoadError("Failed to load Tasks.");
    }
  }

  // Initial load is inlined rather than calling loadTasks() so the lint rule against
  // calling a setState-ing function directly in an effect stays satisfied (as the
  // placeholder page does). loadTasks() is reused for the post-submit refresh.
  useEffect(() => {
    fetch("/api/tasks")
      .then((res) => {
        if (!res.ok) throw new Error("bad status");
        return res.json();
      })
      .then((body: Task[]) => setTasks(body))
      .catch(() => setLoadError("Failed to load Tasks."));
  }, []);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function startEdit(task: Task) {
    setForm(formFromTask(task));
    setEditingId(task.id);
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    const res =
      editingId === null
        ? await fetch("/api/tasks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(toPayload(form)),
          })
        : await fetch(`/api/tasks/${editingId}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(toPayload(form)),
          });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Something went wrong saving the Task.");
      return;
    }

    setSuccess(editingId === null ? "Task created." : "Task saved.");
    resetForm();
    await loadTasks();
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <Link href="/" className="text-sm text-muted underline">
          Home
        </Link>
      </div>

      <section className="mt-6 rounded-lg border border-muted/30 p-4 sm:p-5">
        <h2 className="text-lg font-medium">{editingId === null ? "Add a Task" : "Edit Task"}</h2>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4" noValidate>
          <label className={labelClass}>
            Kind
            <select
              value={form.kind}
              disabled={editingId !== null}
              onChange={(e) => setForm({ ...form, kind: e.target.value as TaskKind })}
              className={`${fieldClass} disabled:opacity-60`}
              aria-label="Kind"
            >
              <option value="scheduled">Scheduled</option>
              <option value="flexible">Flexible</option>
            </select>
          </label>

          <label className={labelClass}>
            Description
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className={fieldClass}
              rows={2}
              aria-label="Description"
            />
          </label>

          {form.kind === "scheduled" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                Weekday
                <select
                  value={form.weekday}
                  onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}
                  className={fieldClass}
                  aria-label="Weekday"
                >
                  {WEEKDAYS.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Recurrence (weeks)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={form.recurrenceIntervalWeeks}
                  onChange={(e) =>
                    setForm({ ...form, recurrenceIntervalWeeks: Number(e.target.value) })
                  }
                  className={fieldClass}
                  aria-label="Recurrence (weeks)"
                />
              </label>
              <label className={labelClass}>
                Start time
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  className={fieldClass}
                  aria-label="Start time"
                />
              </label>
              <label className={labelClass}>
                End time
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  className={fieldClass}
                  aria-label="End time"
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                Frequency
                <input
                  type="text"
                  value={form.frequencyText}
                  onChange={(e) => setForm({ ...form, frequencyText: e.target.value })}
                  className={fieldClass}
                  placeholder="about every three months"
                  aria-label="Frequency"
                />
              </label>
              <label className={labelClass}>
                Duration (minutes)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={form.durationMinutes}
                  onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
                  className={fieldClass}
                  aria-label="Duration (minutes)"
                />
              </label>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="text-sm text-green-600">
              {success}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="rounded-md bg-foreground px-4 py-2 text-base font-medium text-background"
            >
              {editingId === null ? "Add Task" : "Save changes"}
            </button>
            {editingId !== null && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-muted/40 px-4 py-2 text-base"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Your Tasks</h2>
        {loadError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {loadError}
          </p>
        )}
        {tasks.length === 0 && !loadError ? (
          <p className="mt-2 text-sm text-muted">No Tasks yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex flex-col gap-2 rounded-lg border border-muted/30 p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <span className="inline-flex w-fit rounded-full bg-muted/20 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
                    {task.kind}
                  </span>
                  <p className="font-medium">{task.description}</p>
                  {task.kind === "scheduled" ? (
                    <p className="text-sm text-muted">
                      {WEEKDAYS[task.weekday]} {task.startTime}–{task.endTime} · every{" "}
                      {task.recurrenceIntervalWeeks}{" "}
                      {task.recurrenceIntervalWeeks === 1 ? "week" : "weeks"}
                    </p>
                  ) : (
                    <p className="text-sm text-muted">
                      {task.frequencyText} · {task.durationMinutes} min
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(task)}
                  aria-label={`Edit ${task.description}`}
                  className="self-start rounded-md border border-muted/40 px-3 py-1.5 text-sm"
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
