import { NextResponse } from "next/server";
import { isCalendarDate } from "@/app/api/calendar";
import { listCompletionsForDateRange, type Completion } from "@/lib/db/completion";
import {
  listPlannedActivitiesForDateRange,
  type PlannedActivity,
} from "@/lib/db/plannedActivity";
import { getTaskById, type Task } from "@/lib/db/task";

type TaskSummary = Pick<Task, "id" | "kind" | "description">;

export type PlannedActivityForDay = PlannedActivity & {
  note: string | undefined;
  task: TaskSummary;
};

export type AdHocCompletionForDay = Pick<Completion, "id" | "completedDate" | "note"> & {
  task: TaskSummary;
};

export interface DayEntry {
  date: string;
  plannedActivities: PlannedActivityForDay[];
  adHocCompletions: AdHocCompletionForDay[];
}

function taskSummary(taskId: number): TaskSummary {
  const task = getTaskById(taskId)!;
  return { id: task.id, kind: task.kind, description: task.description };
}

/** Assembles day entries from a range's Planned Activities and Completions. */
export function listDayEntries(startDate: string, endDate: string): DayEntry[] {
  const entries = new Map<string, DayEntry>();
  const entryFor = (date: string): DayEntry => {
    const entry = entries.get(date);
    if (entry) return entry;
    const next = { date, plannedActivities: [], adHocCompletions: [] };
    entries.set(date, next);
    return next;
  };

  const activities = listPlannedActivitiesForDateRange(startDate, endDate);
  const completionNotesByActivity = new Map<number, string | undefined>();
  const adHocCompletions: Completion[] = [];
  for (const completion of listCompletionsForDateRange(
    startDate,
    endDate,
    activities.map((activity) => activity.id)
  )) {
    if (completion.plannedActivityId === undefined) {
      adHocCompletions.push(completion);
    } else {
      completionNotesByActivity.set(completion.plannedActivityId, completion.note);
    }
  }

  for (const activity of activities) {
    entryFor(activity.date).plannedActivities.push({
      ...activity,
      note: completionNotesByActivity.get(activity.id),
      task: taskSummary(activity.taskId),
    });
  }

  for (const completion of adHocCompletions) {
    entryFor(completion.completedDate).adHocCompletions.push({
      id: completion.id,
      completedDate: completion.completedDate,
      note: completion.note,
      task: taskSummary(completion.taskId),
    });
  }

  return Array.from(entries.values());
}

/** Gets one calendar day's Planned Activities and ad-hoc Completions. */
export async function GET(_request: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isCalendarDate(date)) {
    return NextResponse.json({ error: "Date parameter must be YYYY-MM-DD." }, { status: 400 });
  }

  return NextResponse.json(listDayEntries(date, date)[0] ?? { date, plannedActivities: [], adHocCompletions: [] });
}
