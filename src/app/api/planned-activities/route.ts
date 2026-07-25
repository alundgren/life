import { NextResponse } from "next/server";
import { listPlannedActivitiesForDate } from "@/lib/db/plannedActivity";
import { getTaskById, type Task } from "@/lib/db/task";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type PlannedActivityForDay = ReturnType<typeof listPlannedActivitiesForDate>[number] & {
  task: Pick<Task, "id" | "kind" | "description">;
};

function isDateString(value: string | null): value is string {
  if (!value || !DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Lists Planned Activities for a required calendar date. */
export function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!isDateString(date)) {
    return NextResponse.json({ error: "Date query parameter must be YYYY-MM-DD." }, { status: 400 });
  }

  const activities = listPlannedActivitiesForDate(date).map((activity) => {
    const task = getTaskById(activity.taskId);
    return {
      ...activity,
      task: {
        id: task!.id,
        kind: task!.kind,
        description: task!.description,
      },
    };
  });

  return NextResponse.json(activities);
}
