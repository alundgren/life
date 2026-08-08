import { NextResponse } from "next/server";
import { isCalendarDate } from "@/app/api/calendar";
import { listDayEntries } from "@/app/api/day/[date]/route";
import { getWeeklyPlanByWeek } from "@/lib/db/weeklyPlan";
import { addCalendarDays, weekStartForCalendarDate } from "@/lib/simulatedClock";

/** Gets one Monday-to-Sunday week of Planned Activities and ad-hoc Completions. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ weekStartDate: string }> }
) {
  const { weekStartDate } = await params;
  if (!isCalendarDate(weekStartDate)) {
    return NextResponse.json({ error: "Week start date parameter must be YYYY-MM-DD." }, { status: 400 });
  }
  if (weekStartForCalendarDate(weekStartDate) !== weekStartDate) {
    return NextResponse.json({ error: "Week start date must be a Monday." }, { status: 400 });
  }

  const dates = Array.from({ length: 7 }, (_, offset) => addCalendarDays(weekStartDate, offset));
  const entriesByDate = new Map(listDayEntries(dates[0], dates.at(-1)!).map((entry) => [entry.date, entry]));

  return NextResponse.json({
    weekStartDate,
    plannerHasPlanned: getWeeklyPlanByWeek(weekStartDate) !== undefined,
    days: dates.map((date) => entriesByDate.get(date) ?? { date, plannedActivities: [], adHocCompletions: [] }),
  });
}
