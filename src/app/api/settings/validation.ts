import type { ModeValue } from "@/lib/db/mode";

export const MODES: ModeValue[] = ["work", "vacation"];
export const WEEK_MINUTES = 7 * 24 * 60;

export type SettingsPayload = {
  mode: ModeValue;
  budgets: Record<ModeValue, number>;
};

export type ValidationResult =
  | { ok: true; value: SettingsPayload }
  | { ok: false; error: string };

function invalid(error: string): ValidationResult {
  return { ok: false, error };
}

function isMode(value: unknown): value is ModeValue {
  return value === "work" || value === "vacation";
}

export function validateSettingsInput(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return invalid("Request body must be an object.");
  }
  const b = body as Record<string, unknown>;

  if (!isMode(b.mode)) {
    return invalid('Mode must be "work" or "vacation".');
  }

  if (typeof b.budgets !== "object" || b.budgets === null || Array.isArray(b.budgets)) {
    return invalid("Budgets are required.");
  }
  const budgets = b.budgets as Record<string, unknown>;

  for (const mode of MODES) {
    if (!(mode in budgets)) {
      return invalid(`Budget for ${mode} Mode is required.`);
    }
    const minutes = budgets[mode];
    if (typeof minutes !== "number" || !Number.isInteger(minutes)) {
      return invalid(`Budget for ${mode} Mode must be a whole number of minutes.`);
    }
    if (minutes < 0) {
      return invalid(`Budget for ${mode} Mode must be at least 0 minutes.`);
    }
    if (minutes > WEEK_MINUTES) {
      return invalid(`Budget for ${mode} Mode cannot be more than one week.`);
    }
  }

  return {
    ok: true,
    value: {
      mode: b.mode,
      budgets: {
        work: budgets.work as number,
        vacation: budgets.vacation as number,
      },
    },
  };
}
