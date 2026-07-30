import { getDb } from "@/lib/db/client";

interface SimulatedClockRow {
  now: string;
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

  const next = getCurrentTime();
  next.setDate(next.getDate() + days);
  const now = next.toISOString();
  getDb().prepare("UPDATE simulated_clock SET now = @now WHERE id = 1").run({ now });
  return next;
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
