import { getDb } from "@/lib/db/client";
import { addCalendarDays } from "@/lib/calendarDate";

export { addCalendarDays, weekStartForCalendarDate } from "@/lib/calendarDate";

interface SimulatedClockRow {
  now: string;
}

interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function applicationTimeZone(): string {
  const timeZone = process.env.APP_TIME_ZONE;
  if (!timeZone) {
    throw new Error("APP_TIME_ZONE must be set before reading calendar dates.");
  }
  return timeZone;
}

function zonedDateTimeParts(date: Date, timeZone = applicationTimeZone()): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  ) as Record<keyof ZonedDateTimeParts, number>;

  return values;
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedDateTimeParts(date, timeZone);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, date.getUTCMilliseconds()) -
    date.getTime()
  );
}

function compareWallTime(left: ZonedDateTimeParts, right: ZonedDateTimeParts): number {
  for (const key of ["year", "month", "day", "hour", "minute", "second"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return 0;
}

function instantForZonedDateTime(parts: ZonedDateTimeParts, milliseconds: number): Date {
  const timeZone = applicationTimeZone();
  const wallTimeAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    milliseconds
  );
  const candidates: Date[] = [];
  let candidate = new Date(wallTimeAsUtc);

  for (let attempt = 0; attempt < 3; attempt++) {
    const next = new Date(wallTimeAsUtc - timeZoneOffsetMs(candidate, timeZone));
    candidates.push(next);
    if (next.getTime() === candidate.getTime()) {
      return next;
    }
    candidate = next;
  }

  // During a spring-forward gap no instant has the requested wall time. Choose the first
  // candidate after it, which moves the clock forward across the gap as a calendar does.
  return candidates
    .filter((value) => compareWallTime(zonedDateTimeParts(value, timeZone), parts) >= 0)
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? candidate;
}

export function isSimulatedClockEnabled(): boolean {
  return process.env.SIMULATED_CLOCK === "true";
}

/** The app's current moment, frozen in the database when the Simulated Clock is active. */
export function getCurrentTime(): Date {
  if (!isSimulatedClockEnabled()) {
    return new Date();
  }

  const db = getDb();
  const row = db.prepare("SELECT now FROM simulated_clock WHERE id = 1").get() as
    | SimulatedClockRow
    | undefined;
  if (row) {
    return new Date(row.now);
  }

  const now = new Date().toISOString();
  db.prepare("INSERT INTO simulated_clock (id, now) VALUES (1, @now) ON CONFLICT (id) DO NOTHING").run({ now });
  const stored = db.prepare("SELECT now FROM simulated_clock WHERE id = 1").get() as SimulatedClockRow;
  return new Date(stored.now);
}

/** Advances the frozen clock by whole calendar days. Only available while the clock is active. */
export function advanceSimulatedClock(days: number): Date {
  if (!isSimulatedClockEnabled()) {
    throw new Error("The Simulated Clock is not enabled.");
  }

  const current = getCurrentTime();
  const parts = zonedDateTimeParts(current);
  const [year, month, day] = addCalendarDays(
    `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    days
  )
    .split("-")
    .map(Number);
  const next = instantForZonedDateTime({ ...parts, year, month, day }, current.getUTCMilliseconds());
  const now = next.toISOString();
  getDb().prepare("UPDATE simulated_clock SET now = @now WHERE id = 1").run({ now });
  return next;
}

export function formatLocalDate(date: Date): string {
  const { year, month, day } = zonedDateTimeParts(date);
  const formattedMonth = String(month).padStart(2, "0");
  const formattedDay = String(day).padStart(2, "0");
  return `${year}-${formattedMonth}-${formattedDay}`;
}

/** The deployment-wide timezone used for calendar dates and browser timestamp display. */
export function getApplicationTimeZone(): string {
  return applicationTimeZone();
}
