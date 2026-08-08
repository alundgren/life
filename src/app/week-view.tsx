"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { addCalendarDays, weekStartForCalendarDate } from "@/lib/calendarDate";
import { dateForDisplay, dayFormatter, orderedRows, statusLabel, type PlannedActivityStatus } from "./dayEntryDisplay";

type ClockResponse = { today: string; timeZone: string };

type PlannedActivity = {
  id: number;
  status: PlannedActivityStatus;
  startTime?: string;
  note?: string;
  task: { id: number; kind: "scheduled" | "flexible"; description: string };
};

type AdHocCompletion = {
  id: number;
  note?: string;
  task: { id: number; kind: "scheduled" | "flexible"; description: string };
};

type DayEntry = {
  date: string;
  plannedActivities: PlannedActivity[];
  adHocCompletions: AdHocCompletion[];
};

type Week = {
  weekStartDate: string;
  plannerHasPlanned: boolean;
  days: DayEntry[];
};

const dayShortFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });

export function Note({ note }: { note: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        className="text-left text-xs text-muted underline"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Hide note" : "Show note"}
      </button>
      {expanded && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

function DayCell({ day, today }: { day: DayEntry; today: string }) {
  const date = dateForDisplay(day.date);
  const fullDate = dayFormatter.format(date);
  const rows = orderedRows(day);
  const visibleRows = rows.slice(0, 5);
  const remainingCount = rows.length - visibleRows.length;

  return (
    <article
      aria-label={fullDate}
      className={`min-h-60 border-r border-muted/30 p-3 last:border-r-0 ${day.date === today ? "bg-muted/10" : ""}`}
    >
      <Link
        href={`/day/${day.date}`}
        aria-label={`Open ${fullDate}`}
        className="flex items-baseline justify-between gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span className="text-sm font-semibold">{dayShortFormatter.format(date)}</span>
        <span className="text-lg font-semibold">{date.getUTCDate()}</span>
      </Link>
      <ul className="mt-3 space-y-2">
        {visibleRows.map((row) =>
          row.type === "planned" ? (
            <li
              key={`activity-${row.activity.id}`}
              className={`border-l-2 bg-background/40 px-2 py-1 text-xs ${
                row.activity.status === "done" ? "border-emerald-700" : "border-foreground/50"
              }`}
            >
              <p className={row.activity.status === "done" ? "line-through" : ""}>
                {row.activity.startTime && `${row.activity.startTime} `}
                {row.activity.task.description}
                <span className="ml-1 text-[11px] text-muted">{statusLabel(row.activity.status)}</span>
              </p>
              {row.activity.note && <Note note={row.activity.note} />}
            </li>
          ) : (
            <li key={`completion-${row.completion.id}`} className="border-l-2 border-dashed border-muted bg-muted/10 px-2 py-1 text-xs">
              <p>{row.completion.task.description}</p>
              <p className="mt-0.5 text-[11px] text-muted">Completed</p>
              {row.completion.note && <Note note={row.completion.note} />}
            </li>
          )
        )}
      </ul>
      {remainingCount > 0 && (
        <Link href={`/day/${day.date}`} className="mt-3 inline-block text-xs text-muted underline">
          +{remainingCount} more
        </Link>
      )}
    </article>
  );
}

function WeekNavigation({ weekStartDate, currentWeekStart }: { weekStartDate: string; currentWeekStart?: string }) {
  const isCurrentWeek = currentWeekStart === undefined || weekStartDate === currentWeekStart;
  const previousWeek = addCalendarDays(weekStartDate, -7);
  const nextWeek = addCalendarDays(weekStartDate, 7);
  const buttonClass = "rounded-md border border-muted/40 px-3 py-1.5 text-sm disabled:opacity-60";

  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="Week navigation">
      <Link href={`/week/${previousWeek}`} className={buttonClass} aria-label="Previous week">
        ← Prev
      </Link>
      {isCurrentWeek ? (
        <button type="button" className={buttonClass} disabled aria-label="Next week">
          Next →
        </button>
      ) : (
        <Link href={`/week/${nextWeek}`} className={buttonClass} aria-label="Next week">
          Next →
        </Link>
      )}
      {isCurrentWeek ? (
        <button type="button" className={buttonClass} disabled aria-label="This week">
          This week
        </button>
      ) : (
        <Link href="/" className={buttonClass} aria-label="This week">
          This week
        </Link>
      )}
    </nav>
  );
}

/** Read-only Monday-to-Sunday overview, optionally pinned to a week from the URL. */
export function WeekView({ weekStartDate: requestedWeekStart }: { weekStartDate?: string }) {
  const [clock, setClock] = useState<ClockResponse | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; weekStartDate?: string } | null>(null);

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
        if (!cancelled) setLoadError({ message: "Failed to load the current date." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentWeekStart = clock && weekStartForCalendarDate(clock.today);
  const weekStartDate = requestedWeekStart ?? currentWeekStart;

  useEffect(() => {
    if (!weekStartDate) return;
    let cancelled = false;
    fetch(`/api/week/${weekStartDate}`)
      .then((response) => {
        if (!response.ok) throw new Error("bad status");
        return response.json() as Promise<Week>;
      })
      .then((body) => {
        if (!cancelled) setWeek(body);
      })
      .catch(() => {
        if (!cancelled) setLoadError({ message: "Failed to load the Week view.", weekStartDate });
      });
    return () => {
      cancelled = true;
    };
  }, [weekStartDate]);

  const displayedWeek = week?.weekStartDate === weekStartDate ? week : null;
  const displayedError =
    loadError && (loadError.weekStartDate === undefined || loadError.weekStartDate === weekStartDate)
      ? loadError.message
      : null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 border-b border-muted/30 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Week</h1>
          {displayedWeek && <p className="mt-1 text-sm text-muted">{dayFormatter.format(dateForDisplay(displayedWeek.days[0].date))}–{dayFormatter.format(dateForDisplay(displayedWeek.days.at(-1)!.date))}</p>}
        </div>
        <nav className="flex flex-wrap gap-3 text-sm text-muted" aria-label="Application navigation">
          <Link href="/tasks" className="underline">
            Manage Tasks
          </Link>
          <Link href="/settings" className="underline">
            Settings
          </Link>
        </nav>
      </header>

      {displayedError && <p role="alert" className="text-sm text-red-600">{displayedError}</p>}
      {!displayedWeek && !displayedError ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        displayedWeek && (
          <section className="overflow-hidden rounded-lg border border-muted/30" aria-label="Week overview">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
              <div>
                <h2 className="text-lg font-medium">Week</h2>
                {!displayedWeek.plannerHasPlanned && (
                  <p role="alert" className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                    Planner has not planned this week.
                  </p>
                )}
              </div>
              <WeekNavigation weekStartDate={displayedWeek.weekStartDate} currentWeekStart={currentWeekStart ?? undefined} />
            </div>
            <div className="overflow-x-auto border-t border-muted/30">
              <div className="grid min-w-[48rem] grid-cols-7">
                {displayedWeek.days.map((day) => <DayCell key={day.date} day={day} today={clock?.today ?? ""} />)}
              </div>
            </div>
          </section>
        )
      )}
    </main>
  );
}
