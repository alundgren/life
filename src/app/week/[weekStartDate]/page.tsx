import { isCalendarDate } from "@/app/api/calendar";
import { isMondayCalendarDate } from "@/lib/calendarDate";
import { notFound } from "next/navigation";
import { WeekView } from "../../week-view";

/** Renders a specific Monday-to-Sunday week selected by its canonical URL. */
export default async function WeekPage({ params }: { params: Promise<{ weekStartDate: string }> }) {
  const { weekStartDate } = await params;
  if (!isCalendarDate(weekStartDate) || !isMondayCalendarDate(weekStartDate)) notFound();
  return <WeekView weekStartDate={weekStartDate} />;
}
