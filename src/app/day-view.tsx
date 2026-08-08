"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { weekStartForCalendarDate } from "@/lib/calendarDate";
import { Note } from "./week-view";
import { dateForDisplay, dayFormatter, orderedRows, statusLabel, type PlannedActivityStatus } from "./dayEntryDisplay";
import type { Task } from "@/lib/db/task";

type ClockResponse = { today: string; timeZone: string };

type PlannedActivity = {
  id: number;
  taskId: number;
  status: PlannedActivityStatus;
  startTime?: string;
  endTime?: string;
  note?: string;
  task: { id: number; kind: "scheduled" | "flexible"; description: string };
};

type AdHocCompletion = {
  id: number;
  note?: string;
  task: { id: number; kind: "scheduled" | "flexible"; description: string };
};

type Day = {
  date: string;
  plannedActivities: PlannedActivity[];
  adHocCompletions: AdHocCompletion[];
};

type CompleteState = {
  activityId: number;
  note: string;
};

const fieldClass = "w-full rounded-md border border-muted/40 bg-background px-3 py-2 text-base";
const secondaryButtonClass = "min-h-11 rounded-md border border-muted/40 px-4 py-2 text-base disabled:opacity-60";
const primaryButtonClass =
  "min-h-11 rounded-md bg-foreground px-4 py-2 text-base font-medium text-background disabled:opacity-60";

/** The expanded single-day page: stacked activity cards for one date, reachable from the Week view. */
export function DayView({ date }: { date: string }) {
  const [clock, setClock] = useState<ClockResponse | null>(null);
  const [day, setDay] = useState<Day | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [completeState, setCompleteState] = useState<CompleteState | null>(null);
  const [savingActivityId, setSavingActivityId] = useState<number | null>(null);
  const [adHocTaskId, setAdHocTaskId] = useState("");
  const [adHocNote, setAdHocNote] = useState("");
  const [savingAdHoc, setSavingAdHoc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/simulated-clock")
      .then((response) => {
        if (!response.ok) throw new Error("bad status");
        return response.json() as Promise<ClockResponse>;
      })
      .then((body) => {
        if (!cancelled) setClock(body);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load the current date.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadDay() {
    const response = await fetch(`/api/day/${date}`);
    if (!response.ok) throw new Error("bad status");
    setDay((await response.json()) as Day);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/day/${date}`)
      .then((response) => {
        if (!response.ok) throw new Error("bad status");
        return response.json() as Promise<Day>;
      })
      .then((body) => {
        if (!cancelled) setDay(body);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load this day.");
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const isFuture = clock !== null && date > clock.today;
  const isActionable = clock !== null && !isFuture;

  useEffect(() => {
    if (!isActionable) return;
    let cancelled = false;
    fetch("/api/tasks")
      .then((response) => {
        if (!response.ok) throw new Error("bad status");
        return response.json() as Promise<Task[]>;
      })
      .then((body) => {
        if (!cancelled) setTasks(body);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load Tasks.");
      })
      .finally(() => {
        if (!cancelled) setLoadingTasks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isActionable]);

  async function recordCompletion(payload: { taskId: number; plannedActivityId?: number; note?: string }) {
    const body = {
      taskId: payload.taskId,
      completedDate: date,
      ...(payload.plannedActivityId === undefined ? {} : { plannedActivityId: payload.plannedActivityId }),
      ...(payload.note?.trim() ? { note: payload.note.trim() } : {}),
    };

    const response = await fetch("/api/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const parsed = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(parsed.error ?? "Failed to record Completion.");
    }
  }

  async function confirmActivity(activity: PlannedActivity) {
    setSaveError(null);
    setMessage(null);
    setSavingActivityId(activity.id);
    try {
      await recordCompletion({
        taskId: activity.taskId,
        plannedActivityId: activity.id,
        note: completeState?.note,
      });
      await loadDay();
      setCompleteState(null);
      setMessage("Completion recorded.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to record Completion.");
    } finally {
      setSavingActivityId(null);
    }
  }

  async function submitAdHoc(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setMessage(null);

    const taskId = Number(adHocTaskId);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      setSaveError("Choose a Task to log.");
      return;
    }

    setSavingAdHoc(true);
    try {
      await recordCompletion({ taskId, note: adHocNote });
      await loadDay();
      setAdHocTaskId("");
      setAdHocNote("");
      setMessage("Completion recorded.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to record Completion.");
    } finally {
      setSavingAdHoc(false);
    }
  }

  const rows = day ? orderedRows(day) : [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{dayFormatter.format(dateForDisplay(date))}</h1>
        </div>
        <nav className="flex flex-wrap gap-3 text-sm text-muted">
          <Link href={`/week/${weekStartForCalendarDate(date)}`} className="underline">
            Back to week
          </Link>
          <Link href="/tasks" className="underline">
            Manage Tasks
          </Link>
          <Link href="/settings" className="underline">
            Settings
          </Link>
        </nav>
      </header>

      {loadError && (
        <p role="alert" className="text-sm text-red-600">
          {loadError}
        </p>
      )}

      {!day && !loadError ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        day && (
          <section>
            {rows.length === 0 ? (
              <p className="text-sm text-muted">Nothing recorded for this day.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {rows.map((row) =>
                  row.type === "planned" ? (
                    <li
                      key={`activity-${row.activity.id}`}
                      className={`rounded-lg border border-muted/30 p-4 ${row.activity.status === "done" ? "bg-muted/10" : ""}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex flex-col gap-1">
                          <p className={row.activity.status === "done" ? "font-medium line-through" : "font-medium"}>
                            {row.activity.task.description}
                          </p>
                          <p className="text-sm text-muted">
                            {row.activity.startTime && `${row.activity.startTime}${row.activity.endTime ? `–${row.activity.endTime}` : ""} · `}
                            {statusLabel(row.activity.status)}
                          </p>
                        </div>
                        {isActionable && row.activity.status === "pending" && completeState?.activityId !== row.activity.id && (
                          <button
                            type="button"
                            onClick={() => {
                              setCompleteState({ activityId: row.activity.id, note: "" });
                              setSaveError(null);
                              setMessage(null);
                            }}
                            disabled={savingActivityId !== null}
                            className={primaryButtonClass}
                            aria-label={`Tick off ${row.activity.task.description}`}
                          >
                            Tick off
                          </button>
                        )}
                      </div>

                      {row.activity.note && <Note note={row.activity.note} />}

                      {completeState?.activityId === row.activity.id && (
                        <div className="mt-4 flex flex-col gap-3">
                          <label className="flex flex-col gap-1 text-sm font-medium">
                            How did it go?
                            <textarea
                              value={completeState.note}
                              onChange={(e) => setCompleteState({ activityId: row.activity.id, note: e.target.value })}
                              className={fieldClass}
                              rows={2}
                              aria-label={`How did it go for ${row.activity.task.description}`}
                            />
                          </label>
                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => confirmActivity(row.activity)}
                              disabled={savingActivityId !== null}
                              className={primaryButtonClass}
                              aria-label={`Confirm ${row.activity.task.description}`}
                            >
                              {savingActivityId === row.activity.id ? "Saving…" : "Confirm"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setCompleteState(null)}
                              disabled={savingActivityId !== null}
                              className={secondaryButtonClass}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ) : (
                    <li key={`completion-${row.completion.id}`} className="rounded-lg border border-dashed border-muted/50 bg-muted/10 p-4">
                      <p className="font-medium">{row.completion.task.description}</p>
                      <p className="text-sm text-muted">Completed</p>
                      {row.completion.note && <Note note={row.completion.note} />}
                    </li>
                  )
                )}
              </ul>
            )}
          </section>
        )
      )}

      {isActionable && (
        <section className="rounded-lg border border-muted/30 p-4 sm:p-5">
          <h2 className="text-lg font-medium">Log something else</h2>
          <form onSubmit={submitAdHoc} className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Task
              <select
                value={adHocTaskId}
                onChange={(e) => setAdHocTaskId(e.target.value)}
                className={fieldClass}
                disabled={loadingTasks || savingAdHoc}
                aria-label="Task"
              >
                <option value="">Choose a Task</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              How did it go?
              <textarea
                value={adHocNote}
                onChange={(e) => setAdHocNote(e.target.value)}
                className={fieldClass}
                rows={2}
                aria-label="How did it go for ad-hoc Completion"
              />
            </label>
            <button type="submit" disabled={savingAdHoc || loadingTasks} className={primaryButtonClass}>
              {savingAdHoc ? "Saving…" : "Record Completion"}
            </button>
          </form>
        </section>
      )}

      {saveError && (
        <p role="alert" className="text-sm text-red-600">
          {saveError}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-green-600">
          {message}
        </p>
      )}
    </main>
  );
}
