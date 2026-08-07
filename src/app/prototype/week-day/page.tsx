"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// PROTOTYPE ONLY — three Week/Day view variants for issue #93, switchable via ?variant=.

type Variant = "grid" | "timeline" | "rhythm";

const variants: { id: Variant; name: string }[] = [
  { id: "grid", name: "Quiet weekly grid" },
  { id: "timeline", name: "Time-block calendar" },
  { id: "rhythm", name: "Weekly rhythm cards" },
];

const days = [
  { short: "Mon", date: "10", activities: ["16:00 Gym", "Read"] },
  { short: "Tue", date: "11", activities: ["✓ 08:30 Call Mum", "✓ Inbox zero"] },
  { short: "Wed", date: "12", activities: ["18:30 Run"] },
  { short: "Thu", date: "13", activities: ["09:00 Deep work", "Plan meals", "▸ 1 note"], today: true },
  { short: "Fri", date: "14", activities: ["07:30 Stretch"] },
  { short: "Sat", date: "15", activities: ["11:00 Clean kitchen"] },
  { short: "Sun", date: "16", activities: ["Weekly review"] },
];

function statusClass(item: string) {
  if (item.startsWith("✓")) return "border-emerald-700 text-muted line-through";
  if (item.includes("Stretch")) return "border-red-700 text-red-800 dark:text-red-300";
  return "border-foreground/50";
}

function WeekNavigation() {
  return (
    <div className="flex items-center gap-2" aria-label="Week navigation prototype">
      <button type="button" className="rounded-md border border-muted/40 px-3 py-1.5 text-sm">← Prev</button>
      <button type="button" className="rounded-md border border-muted/40 px-3 py-1.5 text-sm">Next →</button>
    </div>
  );
}

function DayActions({ timed = false }: { timed?: boolean }) {
  return (
    <section className="rounded-lg border border-muted/30 p-4 sm:p-5">
      <h2 className="text-lg font-medium">Thursday</h2>
      <p className="mt-1 text-sm text-muted">13 August 2026</p>
      <div className={timed ? "mt-4 space-y-0" : "mt-4 space-y-3"}>
        {[
          ["Deep work", "09:00–10:30 · Scheduled"],
          ["Plan meals", "Flexible · 30 min"],
        ].map(([name, meta]) => (
          <div key={name} className={timed ? "grid grid-cols-[3rem_1fr] border-t border-muted/20 py-3 first:border-t-0" : "rounded-md border border-muted/30 p-3"}>
            {timed && <span className="pt-1 text-xs text-muted">{meta.slice(0, 5)}</span>}
            <div>
              <p className="font-medium">{name}</p>
              <p className="mt-1 text-sm text-muted">{meta}</p>
              <button type="button" className="mt-3 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background">Tick off</button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="mt-4 w-full rounded-md border border-muted/40 px-3 py-2 text-left text-sm">▸ Notes (1)</button>
      <button type="button" className="mt-3 w-full rounded-md border border-dashed border-muted/50 px-3 py-2 text-left text-sm text-muted">+ Log something else</button>
    </section>
  );
}

function GridVariant() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start">
      <section className="overflow-hidden rounded-lg border border-muted/30" aria-label="Quiet weekly grid">
        <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
          <div><h2 className="text-lg font-medium">Week</h2><p className="mt-1 text-sm text-muted">10–16 August 2026</p></div>
          <WeekNavigation />
        </div>
        <div className="grid min-w-[48rem] grid-cols-7 border-t border-muted/30">
          {days.map((day) => (
            <article key={day.short} className={`min-h-60 border-r border-muted/30 p-3 last:border-r-0 ${day.today ? "bg-muted/10" : ""}`}>
              <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-semibold">{day.today ? "Thu · Today" : day.short}</span><span className="text-lg font-semibold">{day.date}</span></div>
              <ul className="mt-3 space-y-2">
                {day.activities.map((item) => <li key={item} className={`border-l-2 bg-background/40 px-2 py-1 text-xs ${statusClass(item)}`}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <DayActions />
    </div>
  );
}

function TimelineVariant() {
  const cells = [
    ["", "", "", "", "", "", ""],
    ["", "✓ Call Mum", "", "", "Stretch", "", ""],
    ["", "", "", "Deep work", "", "", ""],
    ["", "", "", "", "", "Clean kitchen", ""],
    ["Gym", "", "", "", "", "", ""],
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start">
      <section className="overflow-hidden rounded-lg border border-muted/30" aria-label="Time-block calendar">
        <div className="flex items-start justify-between gap-4 p-4 sm:p-5"><div><h2 className="text-lg font-medium">Week</h2><p className="mt-1 text-sm text-muted">10–16 August 2026</p></div><WeekNavigation /></div>
        <div className="overflow-x-auto border-t border-muted/30">
          <div className="grid min-w-[42rem] grid-cols-[3rem_repeat(7,minmax(0,1fr))] text-xs">
            <div className="border-b border-muted/30 p-2" />
            {days.map((day) => <div key={day.short} className={`border-b border-l border-muted/30 p-2 font-semibold ${day.today ? "bg-muted/10" : ""}`}>{day.short} {day.date}</div>)}
            {cells.map((row, rowIndex) => <div key={rowIndex} className="contents">
              <div className="border-b border-muted/30 p-2 text-right text-muted">{["08:00", "09:00", "10:30", "11:00", "16:00"][rowIndex]}</div>
              {row.map((item, dayIndex) => <div key={`${rowIndex}-${dayIndex}`} className={`relative min-h-14 border-b border-l border-muted/30 p-1 ${dayIndex === 3 ? "bg-muted/10" : ""}`}>
                {item && <div className={`rounded-sm border-l-2 px-2 py-1 text-[11px] ${statusClass(item)}`}>{item}</div>}
              </div>)}
            </div>)}
          </div>
        </div>
        <div className="grid min-w-[42rem] grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-t border-muted/30 text-xs text-muted"><div className="p-2">Any</div><div className="border-l border-muted/30 p-2">Read</div><div className="border-l border-muted/30 p-2">✓ Inbox zero</div><div className="border-l border-muted/30 p-2" /><div className="border-l border-muted/30 p-2">Plan meals<br />▸ 1 note</div><div className="border-l border-muted/30 p-2" /><div className="border-l border-muted/30 p-2" /><div className="border-l border-muted/30 p-2">Weekly review</div></div>
      </section>
      <DayActions timed />
    </div>
  );
}

function RhythmVariant() {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-muted/30 p-4 sm:p-5" aria-label="Weekly rhythm cards">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-medium">Week</h2><p className="mt-1 text-sm text-muted">10–16 August 2026</p></div><WeekNavigation /></div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {days.map((day) => (
            <article key={day.short} className={`min-h-52 rounded-lg border border-muted/30 p-3 ${day.today ? "ring-2 ring-foreground ring-inset" : ""}`}>
              <div className="flex items-baseline justify-between"><h3 className="text-sm font-semibold">{day.today ? "Thu · Today" : day.short}</h3><span className="font-semibold">{day.date}</span></div>
              <ul className="mt-3 space-y-2 text-xs">{day.activities.map((item) => <li key={item} className="flex gap-2"><span className={`mt-0.5 grid h-3 w-3 shrink-0 place-items-center rounded-sm border text-[9px] ${item.startsWith("✓") ? "border-emerald-700 bg-emerald-700 text-white" : "border-muted"}`}>{item.startsWith("✓") ? "✓" : ""}</span><span className={item.startsWith("✓") ? "text-muted line-through" : ""}>{item.replace("✓ ", "")}</span></li>)}</ul>
              {day.short === "Tue" && <p className="mt-4 border-t border-dashed border-muted/40 pt-2 text-[11px] text-muted">“Felt lighter.”</p>}
            </article>
          ))}
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section className="rounded-lg border border-muted/30 p-4 sm:p-5"><h2 className="text-lg font-medium">Thursday’s reflection</h2><p className="mt-1 text-sm text-muted">Keep notes close to the plan, but collapsed until useful.</p><div className="mt-5 rounded-md border-l-2 border-muted/50 bg-muted/10 p-4 text-sm">▸ Notes (1) — expand to read or add a note</div><button type="button" className="mt-3 rounded-md border border-dashed border-muted/50 px-3 py-2 text-sm text-muted">+ Log something else</button></section>
        <DayActions />
      </div>
    </div>
  );
}

function ProsAndCons({ variant }: { variant: Variant }) {
  const content = {
    grid: ["Calm and very close to the current UI; exact durations are secondary.", "Week is for scanning and Day is for ticking off; dense days need an abbreviated state."],
    timeline: ["Calendar-native and makes time load obvious; more visual machinery.", "Best at clashes; needs careful overlap and mobile behaviour, while flexible work sits separately."],
    rhythm: ["The most human, reflective read; less like a traditional calendar.", "Task state and ad-hoc work are first-class; timing and busy-day comparison are weaker."],
  } as const;
  return <p className="mt-5 text-sm text-muted"><strong className="text-foreground">Visual:</strong> {content[variant][0]} <strong className="text-foreground">Function:</strong> {content[variant][1]}</p>;
}

export default function WeekDayPrototypePage() {
  const [variant, setVariant] = useState<Variant>("grid");

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("variant");
    if (!variants.some((item) => item.id === initial)) return;
    const task = window.setTimeout(() => setVariant(initial as Variant), 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const index = variants.findIndex((item) => item.id === variant);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = variants[(index + direction + variants.length) % variants.length];
      setVariant(next.id);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [variant]);

  function choose(next: Variant) {
    window.history.replaceState(null, "", `/prototype/week-day?variant=${next}`);
    setVariant(next);
  }

  const currentIndex = variants.findIndex((item) => item.id === variant);
  const previous = variants[(currentIndex - 1 + variants.length) % variants.length];
  const next = variants[(currentIndex + 1) % variants.length];

  return (
    <main className="mx-auto w-full max-w-7xl p-4 pb-28 sm:p-6 sm:pb-28">
      <header className="flex flex-col gap-3 border-b border-muted/30 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Prototype · Issue #93 · no data is saved</p><h1 className="mt-1 text-2xl font-semibold">Week and Day view</h1><p className="mt-1 text-sm text-muted">Three structurally different layout directions. The switcher keeps the selected version in the URL.</p></div>
        <Link className="w-fit text-sm text-muted underline" href="/">Back to Today</Link>
      </header>
      <section className="mt-6" aria-live="polite">
        {variant === "grid" && <GridVariant />}
        {variant === "timeline" && <TimelineVariant />}
        {variant === "rhythm" && <RhythmVariant />}
        <ProsAndCons variant={variant} />
      </section>
      <nav className="fixed inset-x-0 bottom-4 z-10 mx-auto flex w-fit items-center gap-2 rounded-full bg-foreground px-2 py-2 text-background shadow-lg" aria-label="Prototype variant switcher">
        <button type="button" className="rounded-full px-3 py-1 text-lg hover:bg-background/15" onClick={() => choose(previous.id)} aria-label={`Show ${previous.name}`}>←</button>
        <span className="min-w-52 text-center text-sm font-medium">{String.fromCharCode(65 + currentIndex)} — {variants[currentIndex].name}</span>
        <button type="button" className="rounded-full px-3 py-1 text-lg hover:bg-background/15" onClick={() => choose(next.id)} aria-label={`Show ${next.name}`}>→</button>
      </nav>
    </main>
  );
}
