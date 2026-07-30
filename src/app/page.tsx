"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { Task } from "@/lib/db/task";

type PlannerStatus = {
  running: boolean;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastResult: string | null;
};
type PlaceholderResponse = { message: string | null; planner: PlannerStatus };
type ClockResponse = { today: string; timeZone: string };
type PlannedActivityForDay = {
  id: number;
  weeklyPlanId: number;
  taskId: number;
  date: string;
  status: "pending" | "done" | "missed";
  createdAt: string;
  startTime: string | undefined;
  endTime: string | undefined;
  task: Pick<Task, "id" | "kind" | "description">;
};

type CompleteState = {
  activityId: number;
  note: string;
};

const fieldClass =
  "w-full rounded-md border border-muted/40 bg-background px-3 py-2 text-base";
const secondaryButtonClass =
  "min-h-11 rounded-md border border-muted/40 px-4 py-2 text-base disabled:opacity-60";
const primaryButtonClass =
  "min-h-11 rounded-md bg-foreground px-4 py-2 text-base font-medium text-background disabled:opacity-60";

function statusLabel(status: PlannedActivityForDay["status"]): string {
  if (status === "done") return "Done";
  if (status === "missed") return "Missed";
  return "Pending";
}

export default function Home() {
  const [activities, setActivities] = useState<PlannedActivityForDay[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [placeholder, setPlaceholder] = useState<PlaceholderResponse | null>(null);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [completeState, setCompleteState] = useState<CompleteState | null>(null);
  const [savingActivityId, setSavingActivityId] = useState<number | null>(null);
  const [adHocTaskId, setAdHocTaskId] = useState("");
  const [adHocNote, setAdHocNote] = useState("");
  const [savingAdHoc, setSavingAdHoc] = useState(false);
  const [today, setToday] = useState<string | null>(null);

  async function loadActivities() {
    if (!today) return;
    const res = await fetch(`/api/planned-activities?date=${today}`);
    if (!res.ok) throw new Error("bad status");
    setActivities((await res.json()) as PlannedActivityForDay[]);
  }

  useEffect(() => {
    fetch("/api/simulated-clock")
      .then((res) => {
        if (!res.ok) throw new Error("bad status");
        return res.json();
      })
      .then((body: ClockResponse) => setToday(body.today))
      .catch(() => setLoadError("Failed to load today's Planned Activities."));

    fetch("/api/tasks")
      .then((res) => {
        if (!res.ok) throw new Error("bad status");
        return res.json();
      })
      .then((body: Task[]) => setTasks(body))
      .catch(() => setLoadError("Failed to load Tasks."))
      .finally(() => setLoadingTasks(false));

    fetch("/api/placeholder")
      .then((res) => res.json())
      .then((body: PlaceholderResponse) => setPlaceholder(body))
      .catch(() => {
        // Planner heartbeat is diagnostic only; daily logging should not fail because it is absent.
      });
  }, []);

  useEffect(() => {
    if (!today) return;

    fetch(`/api/planned-activities?date=${today}`)
      .then((res) => {
        if (!res.ok) throw new Error("bad status");
        return res.json();
      })
      .then((body: PlannedActivityForDay[]) => setActivities(body))
      .catch(() => setLoadError("Failed to load today's Planned Activities."))
      .finally(() => setLoadingActivities(false));
  }, [today]);

  async function recordCompletion(payload: {
    taskId: number;
    plannedActivityId?: number;
    note?: string;
  }) {
    if (!today) throw new Error("Today's date is still loading.");
    const body = {
      taskId: payload.taskId,
      completedDate: today,
      ...(payload.plannedActivityId === undefined
        ? {}
        : { plannedActivityId: payload.plannedActivityId }),
      ...(payload.note?.trim() ? { note: payload.note.trim() } : {}),
    };

    const res = await fetch("/api/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const parsed = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(parsed.error ?? "Failed to record Completion.");
    }
  }

  async function confirmActivity(activity: PlannedActivityForDay) {
    setSaveError(null);
    setMessage(null);
    setSavingActivityId(activity.id);
    try {
      await recordCompletion({
        taskId: activity.taskId,
        plannedActivityId: activity.id,
        note: completeState?.note,
      });
      await loadActivities();
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
      setAdHocTaskId("");
      setAdHocNote("");
      setMessage("Completion recorded.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to record Completion.");
    } finally {
      setSavingAdHoc(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Today</h1>
          <p className="mt-1 text-sm text-muted">{today}</p>
        </div>
        <nav className="flex flex-wrap gap-3 text-sm text-muted">
          <Link href="/tasks" className="underline">
            Manage Tasks
          </Link>
          <Link href="/settings" className="underline">
            Settings
          </Link>
        </nav>
      </header>

      <section>
        <h2 className="text-lg font-medium">Planned Activities</h2>
        {loadError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {loadError}
          </p>
        )}
        {loadingActivities ? (
          <p className="mt-3 text-sm text-muted">Loading…</p>
        ) : activities.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing planned for today yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {activities.map((activity) => {
              const isCompleting = completeState?.activityId === activity.id;
              const isSaving = savingActivityId === activity.id;
              return (
                <li
                  key={activity.id}
                  className={`rounded-lg border border-muted/30 p-4 ${
                    activity.status === "done" ? "bg-muted/10" : ""
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex w-fit rounded-full bg-muted/20 px-2 py-0.5 text-xs font-medium uppercase">
                          {statusLabel(activity.status)}
                        </span>
                        {activity.startTime && activity.endTime && (
                          <span className="text-sm text-muted">
                            {activity.startTime}-{activity.endTime}
                          </span>
                        )}
                      </div>
                      <p className={activity.status === "done" ? "font-medium line-through" : "font-medium"}>
                        {activity.task.description}
                      </p>
                      <p className="text-sm text-muted">{activity.task.kind}</p>
                    </div>
                    {activity.status === "pending" && !isCompleting && (
                      <button
                        type="button"
                        onClick={() => {
                          setCompleteState({ activityId: activity.id, note: "" });
                          setSaveError(null);
                          setMessage(null);
                        }}
                        disabled={savingActivityId !== null}
                        className={primaryButtonClass}
                        aria-label={`Tick off ${activity.task.description}`}
                      >
                        Tick off
                      </button>
                    )}
                  </div>

                  {isCompleting && (
                    <div className="mt-4 flex flex-col gap-3">
                      <label className="flex flex-col gap-1 text-sm font-medium">
                        How did it go?
                        <textarea
                          value={completeState.note}
                          onChange={(e) =>
                            setCompleteState({ activityId: activity.id, note: e.target.value })
                          }
                          className={fieldClass}
                          rows={2}
                          aria-label={`How did it go for ${activity.task.description}`}
                        />
                      </label>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => confirmActivity(activity)}
                          disabled={isSaving}
                          className={primaryButtonClass}
                          aria-label={`Confirm ${activity.task.description}`}
                        >
                          {isSaving ? "Saving…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCompleteState(null)}
                          disabled={isSaving}
                          className={secondaryButtonClass}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

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

      <footer className="border-t border-muted/30 pt-4 text-sm text-muted">
        <p>{placeholder?.message ?? "Planner diagnostics unavailable."}</p>
        {placeholder?.planner && (
          <p className="mt-1">
            Planner: {placeholder.planner.running ? "running" : "stopped"}
            {placeholder.planner.lastRunAt &&
              `; last ran ${placeholder.planner.lastRunAt} (${placeholder.planner.lastStatus})`}
          </p>
        )}
      </footer>
    </main>
  );
}
