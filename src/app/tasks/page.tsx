"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import type { Task } from "@/lib/db/task";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type TaskKind = Task["kind"];
type FormState = {
  kind: TaskKind;
  description: string;
  weekday: string;
  startTime: string;
  endTime: string;
  recurrenceIntervalWeeks: string;
  frequencyText: string;
  durationMinutes: string;
};

const emptyForm: FormState = {
  kind: "scheduled",
  description: "",
  weekday: "1",
  startTime: "09:00",
  endTime: "10:00",
  recurrenceIntervalWeeks: "1",
  frequencyText: "",
  durationMinutes: "30",
};

function formFromTask(task: Task): FormState {
  if (task.kind === "scheduled") {
    return {
      ...emptyForm,
      kind: "scheduled",
      description: task.description,
      weekday: String(task.weekday),
      startTime: task.startTime,
      endTime: task.endTime,
      recurrenceIntervalWeeks: String(task.recurrenceIntervalWeeks),
    };
  }

  return {
    ...emptyForm,
    kind: "flexible",
    description: task.description,
    frequencyText: task.frequencyText,
    durationMinutes: String(task.durationMinutes),
  };
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function validateForm(form: FormState): string | null {
  if (form.description.trim() === "") {
    return "Description is required.";
  }

  if (form.kind === "scheduled") {
    if (timeToMinutes(form.endTime) <= timeToMinutes(form.startTime)) {
      return "End time must be after start time.";
    }
    if (Number(form.recurrenceIntervalWeeks) < 1) {
      return "Recurrence interval must be at least 1 week.";
    }
    return null;
  }

  if (form.frequencyText.trim() === "") {
    return "Frequency is required.";
  }
  if (Number(form.durationMinutes) <= 0) {
    return "Duration must be greater than 0 minutes.";
  }
  return null;
}

function requestBody(form: FormState) {
  if (form.kind === "scheduled") {
    return {
      kind: "scheduled",
      description: form.description.trim(),
      weekday: Number(form.weekday),
      startTime: form.startTime,
      endTime: form.endTime,
      recurrenceIntervalWeeks: Number(form.recurrenceIntervalWeeks),
    };
  }

  return {
    kind: "flexible",
    description: form.description.trim(),
    frequencyText: form.frequencyText.trim(),
    durationMinutes: Number(form.durationMinutes),
  };
}

function describeTask(task: Task): string {
  if (task.kind === "scheduled") {
    return `${weekdays[task.weekday]}, ${task.startTime}-${task.endTime}, every ${task.recurrenceIntervalWeeks} week${task.recurrenceIntervalWeeks === 1 ? "" : "s"}`;
  }
  return `${task.frequencyText}, ${task.durationMinutes} minutes`;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/tasks")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load Tasks.");
        }
        return (await response.json()) as { tasks: Task[] };
      })
      .then((body) => setTasks(body.tasks))
      .catch(() => setError("Failed to load Tasks."))
      .finally(() => setLoading(false));
  }, []);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startEdit(task: Task) {
    setEditingTask(task);
    setForm(formFromTask(task));
    setError(null);
    setNotice(null);
  }

  function resetForm() {
    setEditingTask(null);
    setForm(emptyForm);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    const endpoint = editingTask ? `/api/tasks/${editingTask.id}` : "/api/tasks";
    const response = await fetch(endpoint, {
      method: editingTask ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody(form)),
    });
    const body = (await response.json().catch(() => ({}))) as {
      task?: Task;
      error?: string;
    };
    setSaving(false);

    if (!response.ok || !body.task) {
      setError(body.error ?? "Task could not be saved.");
      return;
    }

    if (editingTask) {
      setTasks((current) => current.map((task) => (task.id === body.task!.id ? body.task! : task)));
      setNotice("Task updated.");
    } else {
      setTasks((current) => [...current, body.task!]);
      setNotice("Task created.");
    }
    resetForm();
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 border-b border-foreground/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link className="text-sm font-medium text-muted hover:text-foreground" href="/">
            Life
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Tasks</h1>
        </div>
        {notice && (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            {notice}
          </p>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <section className="order-2 lg:order-1">
          <h2 className="text-lg font-semibold">Existing Tasks</h2>
          {loading ? (
            <p className="mt-4 text-sm text-muted">Loading...</p>
          ) : tasks.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No Tasks yet.</p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {tasks.map((task) => (
                <li
                  className="rounded-lg border border-foreground/10 p-4 shadow-sm"
                  key={task.id}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-normal text-muted">
                        {task.kind === "scheduled" ? "Scheduled" : "Flexible"}
                      </p>
                      <h3 className="mt-1 break-words text-base font-semibold">
                        {task.description}
                      </h3>
                      <p className="mt-2 text-sm text-muted">{describeTask(task)}</p>
                    </div>
                    <button
                      className="min-h-11 rounded-md border border-foreground/20 px-4 py-2 text-sm font-medium hover:bg-foreground/5"
                      onClick={() => startEdit(task)}
                      type="button"
                    >
                      Edit
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="order-1 rounded-lg border border-foreground/10 p-4 shadow-sm lg:order-2">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{editingTask ? "Edit Task" : "Add Task"}</h2>
            {editingTask && (
              <button
                className="min-h-10 rounded-md border border-foreground/20 px-3 py-2 text-sm font-medium hover:bg-foreground/5"
                onClick={resetForm}
                type="button"
              >
                Cancel
              </button>
            )}
          </div>

          {error && (
            <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-300">
              {error}
            </p>
          )}

          <form className="mt-5 grid gap-4" onSubmit={submit}>
            <label className="grid gap-2 text-sm font-medium">
              Kind
              <select
                className="min-h-11 rounded-md border border-foreground/20 bg-background px-3 py-2"
                disabled={Boolean(editingTask)}
                onChange={(event) => updateField("kind", event.target.value as TaskKind)}
                value={form.kind}
              >
                <option value="scheduled">Scheduled</option>
                <option value="flexible">Flexible</option>
              </select>
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Description
              <textarea
                className="min-h-24 rounded-md border border-foreground/20 bg-background px-3 py-2"
                onChange={(event) => updateField("description", event.target.value)}
                value={form.description}
              />
            </label>

            {form.kind === "scheduled" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  Weekday
                  <select
                    className="min-h-11 rounded-md border border-foreground/20 bg-background px-3 py-2"
                    onChange={(event) => updateField("weekday", event.target.value)}
                    value={form.weekday}
                  >
                    {weekdays.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Every weeks
                  <input
                    className="min-h-11 rounded-md border border-foreground/20 bg-background px-3 py-2"
                    min="1"
                    onChange={(event) =>
                      updateField("recurrenceIntervalWeeks", event.target.value)
                    }
                    type="number"
                    value={form.recurrenceIntervalWeeks}
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Start time
                  <input
                    className="min-h-11 rounded-md border border-foreground/20 bg-background px-3 py-2"
                    onChange={(event) => updateField("startTime", event.target.value)}
                    type="time"
                    value={form.startTime}
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  End time
                  <input
                    className="min-h-11 rounded-md border border-foreground/20 bg-background px-3 py-2"
                    onChange={(event) => updateField("endTime", event.target.value)}
                    type="time"
                    value={form.endTime}
                  />
                </label>
              </div>
            ) : (
              <div className="grid gap-4">
                <label className="grid gap-2 text-sm font-medium">
                  Frequency
                  <input
                    className="min-h-11 rounded-md border border-foreground/20 bg-background px-3 py-2"
                    onChange={(event) => updateField("frequencyText", event.target.value)}
                    type="text"
                    value={form.frequencyText}
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Duration minutes
                  <input
                    className="min-h-11 rounded-md border border-foreground/20 bg-background px-3 py-2"
                    min="1"
                    onChange={(event) => updateField("durationMinutes", event.target.value)}
                    type="number"
                    value={form.durationMinutes}
                  />
                </label>
              </div>
            )}

            <button
              className="min-h-11 rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? "Saving..." : editingTask ? "Save Changes" : "Create Task"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
