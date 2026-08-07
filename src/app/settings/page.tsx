"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { ModeValue } from "@/lib/db/mode";

type Settings = {
  mode: ModeValue;
  budgets: Record<ModeValue, number>;
};
type Clock = {
  enabled: boolean;
  now: string;
  today: string;
  timeZone: string;
};

type BudgetForm = Record<ModeValue, string>;

const MODES: Array<{
  value: ModeValue;
  label: string;
  description: string;
}> = [
  {
    value: "work",
    label: "Work",
    description: "Assumes Mon-Fri 09:00-17:00 is busy.",
  },
  {
    value: "vacation",
    label: "Vacation",
    description: "Assumes the week is mostly open.",
  },
];

const fieldClass =
  "w-full rounded-md border border-muted/40 bg-background px-3 py-2 text-base disabled:opacity-60";
const primaryButtonClass =
  "min-h-11 rounded-md bg-foreground px-4 py-2 text-base font-medium text-background disabled:opacity-60";
const secondaryButtonClass =
  "min-h-11 rounded-md border border-muted/40 px-4 py-2 text-base disabled:opacity-60";
const dangerButtonClass =
  "min-h-11 rounded-md bg-red-600 px-4 py-2 text-base font-medium text-white disabled:opacity-60";
const RESET_CONFIRM_PHRASE = "reset";

function budgetFormFromSettings(settings: Settings): BudgetForm {
  return {
    work: String(settings.budgets.work),
    vacation: String(settings.budgets.vacation),
  };
}

function parseBudget(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clock, setClock] = useState<Clock | null>(null);
  const [budgetForm, setBudgetForm] = useState<BudgetForm>({ work: "", vacation: "" });
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [savingBudgets, setSavingBudgets] = useState(false);
  const [clockAction, setClockAction] = useState<"advance" | null>(null);
  const [plannerRunning, setPlannerRunning] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const anyActionInFlight =
    savingMode || savingBudgets || clockAction !== null || plannerRunning || resetting;

  useEffect(() => {
    Promise.all([fetch("/api/settings"), fetch("/api/simulated-clock")])
      .then(async ([settingsResponse, clockResponse]) => {
        if (!settingsResponse.ok || !clockResponse.ok) throw new Error("bad status");
        return Promise.all([settingsResponse.json() as Promise<Settings>, clockResponse.json() as Promise<Clock>]);
      })
      .then(([savedSettings, savedClock]) => {
        setSettings(savedSettings);
        setBudgetForm(budgetFormFromSettings(savedSettings));
        setClock(savedClock);
      })
      .catch(() => setError("Failed to load Settings."))
      .finally(() => setLoading(false));
  }, []);

  async function saveSettings(payload: Settings): Promise<Settings> {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Failed to save Settings.");
    }
    return (await res.json()) as Settings;
  }

  async function selectMode(mode: ModeValue) {
    if (!settings || mode === settings.mode) return;

    setError(null);
    setMessage(null);
    setSavingMode(true);
    try {
      const saved = await saveSettings({ ...settings, mode });
      setSettings(saved);
      setBudgetForm(budgetFormFromSettings(saved));
      setMessage("Mode saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Mode.");
    } finally {
      setSavingMode(false);
    }
  }

  async function submitBudgets(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;

    setError(null);
    setMessage(null);

    const work = parseBudget(budgetForm.work);
    const vacation = parseBudget(budgetForm.vacation);
    if (work === null || vacation === null) {
      setError("Time Budgets must be whole minutes.");
      return;
    }

    setSavingBudgets(true);
    try {
      const saved = await saveSettings({ mode: settings.mode, budgets: { work, vacation } });
      setSettings(saved);
      setBudgetForm(budgetFormFromSettings(saved));
      setMessage("Time Budgets saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Time Budgets.");
      setBudgetForm(budgetFormFromSettings(settings));
    } finally {
      setSavingBudgets(false);
    }
  }

  async function advanceClock(days: 1 | 7) {
    setError(null);
    setMessage(null);
    setClockAction("advance");
    try {
      const response = await fetch("/api/simulated-clock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days }),
      });
      if (!response.ok) throw new Error("Failed to advance the Simulated Clock.");
      setClock((await response.json()) as Clock);
      setMessage(`Simulated clock advanced by ${days === 1 ? "one day" : "one week"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to advance the Simulated Clock.");
    } finally {
      setClockAction(null);
    }
  }

  async function runPlanner() {
    setError(null);
    setMessage(null);
    setPlannerRunning(true);
    try {
      const response = await fetch("/api/planner/run", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to run the Planner.");
      }
      setMessage("Planner run finished.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run the Planner.");
    } finally {
      setPlannerRunning(false);
    }
  }

  async function resetAllData() {
    setError(null);
    setMessage(null);
    setResetting(true);
    try {
      const response = await fetch("/api/settings/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: RESET_CONFIRM_PHRASE }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to reset.");
      }

      const [settingsResponse, clockResponse] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/simulated-clock"),
      ]);
      if (settingsResponse.ok && clockResponse.ok) {
        const freshSettings = (await settingsResponse.json()) as Settings;
        setSettings(freshSettings);
        setBudgetForm(budgetFormFromSettings(freshSettings));
        setClock((await clockResponse.json()) as Clock);
      }

      setResetConfirmText("");
      setMessage("All data has been reset.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted">Scheduled Tasks keep their fixed slots in either Mode.</p>
        </div>
        <Link href="/" className="text-sm text-muted underline">
          Home
        </Link>
      </header>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !settings ? (
        <p role="alert" className="text-sm text-red-600">
          {error ?? "Failed to load Settings."}
        </p>
      ) : (
        <>
          <section>
            <h2 className="text-lg font-medium">Mode</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {MODES.map((mode) => {
                const selected = settings.mode === mode.value;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => selectMode(mode.value)}
                    disabled={anyActionInFlight}
                    aria-pressed={selected}
                    className={`min-h-24 rounded-md border p-4 text-left disabled:opacity-60 ${
                      selected ? "border-foreground bg-muted/10" : "border-muted/30"
                    }`}
                  >
                    <span className="block text-base font-medium">
                      {mode.label}
                      {selected ? " (current)" : ""}
                    </span>
                    <span className="mt-1 block text-sm text-muted">{mode.description}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium">Diagnostics</h2>
            <Link href="/settings/model-calls" className="mt-3 inline-block text-sm text-muted underline">
              View Model Calls
            </Link>
          </section>

          {clock?.enabled && (
            <section>
              <h2 className="text-lg font-medium">Simulated clock</h2>
              <p className="mt-3 text-sm text-muted">Current simulated date: {clock.today}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => advanceClock(1)}
                  disabled={anyActionInFlight}
                  className={secondaryButtonClass}
                >
                  +1 day
                </button>
                <button
                  type="button"
                  onClick={() => advanceClock(7)}
                  disabled={anyActionInFlight}
                  className={secondaryButtonClass}
                >
                  +1 week
                </button>
              </div>
            </section>
          )}

          <section>
            <h2 className="text-lg font-medium">Planner</h2>
            <p className="mt-3 text-sm text-muted">
              Triggers a Planner run immediately, outside its normal 15-minute schedule.
            </p>
            <div className="mt-3">
              <button
                type="button"
                onClick={runPlanner}
                disabled={anyActionInFlight}
                className={primaryButtonClass}
              >
                {plannerRunning ? "Running…" : "Run planner now"}
              </button>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium">Weekly Time Budget</h2>
            <form onSubmit={submitBudgets} className="mt-3 flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {MODES.map((mode) => (
                  <label key={mode.value} className="flex flex-col gap-1 text-sm font-medium">
                    {mode.label} minutes
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={budgetForm[mode.value]}
                      onChange={(e) =>
                        setBudgetForm({ ...budgetForm, [mode.value]: e.target.value })
                      }
                      disabled={anyActionInFlight}
                      className={fieldClass}
                      aria-label={`${mode.label} minutes`}
                    />
                  </label>
                ))}
              </div>

              <button type="submit" disabled={anyActionInFlight} className={primaryButtonClass}>
                {savingBudgets ? "Saving…" : "Save Time Budgets"}
              </button>
            </form>
          </section>

          <section className="rounded-md border border-red-600/40 p-4">
            <h2 className="text-lg font-medium text-red-600">Danger zone</h2>
            <p className="mt-1 text-sm text-muted">
              Wipes every Task, Correction, Completion, Weekly Plan, and diagnostic record, and
              resets Mode and Time Budgets to their defaults. This cannot be undone.
            </p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1 text-sm font-medium sm:w-64">
                Type &quot;{RESET_CONFIRM_PHRASE}&quot; to confirm
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  disabled={anyActionInFlight}
                  className={fieldClass}
                  aria-label={`Type "${RESET_CONFIRM_PHRASE}" to confirm`}
                />
              </label>
              <button
                type="button"
                onClick={resetAllData}
                disabled={resetConfirmText !== RESET_CONFIRM_PHRASE || anyActionInFlight}
                className={dangerButtonClass}
              >
                {resetting ? "Resetting…" : "Reset all data"}
              </button>
            </div>
          </section>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm text-green-600">
              {message}
            </p>
          )}
        </>
      )}
    </main>
  );
}
