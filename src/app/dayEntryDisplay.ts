export type PlannedActivityStatus = "pending" | "done" | "missed";

export const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function dateForDisplay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function statusLabel(status: PlannedActivityStatus): string {
  if (status === "done") return "Done";
  if (status === "missed") return "Missed";
  return "Pending";
}

type DayWithRows<Activity extends { startTime?: string }, Completion> = {
  plannedActivities: Activity[];
  adHocCompletions: Completion[];
};

/** Orders a day's Planned Activities (timed first) ahead of its ad-hoc Completions. */
export function orderedRows<Activity extends { startTime?: string }, Completion>(
  day: DayWithRows<Activity, Completion>
) {
  const plannedActivities = [...day.plannedActivities].sort((left, right) => {
    if (left.startTime && right.startTime) return left.startTime.localeCompare(right.startTime);
    if (left.startTime) return -1;
    if (right.startTime) return 1;
    return 0;
  });
  return [
    ...plannedActivities.map((activity) => ({ type: "planned" as const, activity })),
    ...day.adHocCompletions.map((completion) => ({ type: "adHoc" as const, completion })),
  ];
}
