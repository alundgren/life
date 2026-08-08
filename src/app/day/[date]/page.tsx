import { isCalendarDate } from "@/app/api/calendar";
import { notFound } from "next/navigation";
import { DayView } from "../../day-view";

/** Renders a specific calendar day selected by its canonical URL. */
export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isCalendarDate(date)) notFound();
  return <DayView date={date} />;
}
