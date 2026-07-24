import type {
  CreateFlexibleTaskInput,
  CreateScheduledTaskInput,
} from "@/lib/db/task";

/**
 * The validated body of a create or edit request: a create-input shape tagged with its
 * `kind` discriminator. Validation lives here, at the HTTP seam, so every caller gets the
 * same clean, specific error before anything reaches the data-access layer.
 */
export type ValidatedTaskInput =
  | ({ kind: "scheduled" } & CreateScheduledTaskInput)
  | ({ kind: "flexible" } & CreateFlexibleTaskInput);

export type ValidationResult =
  | { ok: true; value: ValidatedTaskInput }
  | { ok: false; error: string };

function invalid(error: string): ValidationResult {
  return { ok: false, error };
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Validates a create/edit request body and returns a typed, kind-tagged input or an error. */
export function validateTaskInput(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return invalid("Request body must be an object.");
  }
  const b = body as Record<string, unknown>;

  if (b.kind !== "scheduled" && b.kind !== "flexible") {
    return invalid('Task kind must be "scheduled" or "flexible".');
  }

  if (typeof b.description !== "string" || b.description.trim() === "") {
    return invalid("Description is required.");
  }
  const description = b.description.trim();

  if (b.kind === "scheduled") {
    if (
      typeof b.weekday !== "number" ||
      !Number.isInteger(b.weekday) ||
      b.weekday < 0 ||
      b.weekday > 6
    ) {
      return invalid("Weekday must be a whole number from 0 (Sunday) to 6 (Saturday).");
    }
    if (typeof b.startTime !== "string" || !TIME_PATTERN.test(b.startTime)) {
      return invalid("Start time must be a valid HH:MM time.");
    }
    if (typeof b.endTime !== "string" || !TIME_PATTERN.test(b.endTime)) {
      return invalid("End time must be a valid HH:MM time.");
    }
    if (timeToMinutes(b.endTime) <= timeToMinutes(b.startTime)) {
      return invalid("End time must be after start time.");
    }
    if (
      typeof b.recurrenceIntervalWeeks !== "number" ||
      !Number.isInteger(b.recurrenceIntervalWeeks) ||
      b.recurrenceIntervalWeeks < 1
    ) {
      return invalid("Recurrence interval must be a whole number of weeks, at least 1.");
    }

    return {
      ok: true,
      value: {
        kind: "scheduled",
        description,
        weekday: b.weekday,
        startTime: b.startTime,
        endTime: b.endTime,
        recurrenceIntervalWeeks: b.recurrenceIntervalWeeks,
      },
    };
  }

  if (typeof b.frequencyText !== "string" || b.frequencyText.trim() === "") {
    return invalid("Frequency is required.");
  }
  if (
    typeof b.durationMinutes !== "number" ||
    !Number.isInteger(b.durationMinutes) ||
    b.durationMinutes <= 0
  ) {
    return invalid("Duration must be a whole number of minutes greater than 0.");
  }

  return {
    ok: true,
    value: {
      kind: "flexible",
      description,
      frequencyText: b.frequencyText.trim(),
      durationMinutes: b.durationMinutes,
    },
  };
}
