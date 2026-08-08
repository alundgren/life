/** Adds whole days to an ISO calendar date without consulting the host timezone. */
export function addCalendarDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** The Monday of the week containing an ISO calendar date. */
export function weekStartForCalendarDate(date: string): string {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addCalendarDays(date, -((weekday + 6) % 7));
}

/** Whether an ISO calendar date is that week's Monday. */
export function isMondayCalendarDate(date: string): boolean {
  return weekStartForCalendarDate(date) === date;
}
