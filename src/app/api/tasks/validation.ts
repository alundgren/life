import type { CreateFlexibleTaskInput, CreateScheduledTaskInput } from "@/lib/db/task";

type TaskBody = Record<string, unknown>;

export type CreateTaskBody =
  | ({ kind: "scheduled" } & CreateScheduledTaskInput)
  | ({ kind: "flexible" } & CreateFlexibleTaskInput);

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

function isBody(value: unknown): value is TaskBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(body: TaskBody, field: string, label: string): ValidationResult<string> {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, message: `${label} is required.` };
  }
  return { ok: true, value: value.trim() };
}

function integerField(body: TaskBody, field: string, label: string): ValidationResult<number> {
  const value = body[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { ok: false, message: `${label} must be a whole number.` };
  }
  return { ok: true, value };
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function validateTime(value: string, label: string): ValidationResult<string> {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return { ok: false, message: `${label} must use HH:MM time.` };
  }
  return { ok: true, value };
}

export function validateTaskBody(body: unknown): ValidationResult<CreateTaskBody> {
  if (!isBody(body)) {
    return { ok: false, message: "Request body must be an object." };
  }

  const description = textField(body, "description", "Description");
  if (!description.ok) {
    return description;
  }

  if (body.kind === "scheduled") {
    const weekday = integerField(body, "weekday", "Weekday");
    if (!weekday.ok) {
      return weekday;
    }
    if (weekday.value < 0 || weekday.value > 6) {
      return { ok: false, message: "Weekday must be between 0 and 6." };
    }

    const startText = textField(body, "startTime", "Start time");
    if (!startText.ok) {
      return startText;
    }
    const startTime = validateTime(startText.value, "Start time");
    if (!startTime.ok) {
      return startTime;
    }

    const endText = textField(body, "endTime", "End time");
    if (!endText.ok) {
      return endText;
    }
    const endTime = validateTime(endText.value, "End time");
    if (!endTime.ok) {
      return endTime;
    }
    if (timeToMinutes(endTime.value) <= timeToMinutes(startTime.value)) {
      return { ok: false, message: "End time must be after start time." };
    }

    const recurrence = integerField(
      body,
      "recurrenceIntervalWeeks",
      "Recurrence interval"
    );
    if (!recurrence.ok) {
      return recurrence;
    }
    if (recurrence.value < 1) {
      return { ok: false, message: "Recurrence interval must be at least 1 week." };
    }

    return {
      ok: true,
      value: {
        kind: "scheduled",
        description: description.value,
        weekday: weekday.value,
        startTime: startTime.value,
        endTime: endTime.value,
        recurrenceIntervalWeeks: recurrence.value,
      },
    };
  }

  if (body.kind === "flexible") {
    const frequencyText = textField(body, "frequencyText", "Frequency");
    if (!frequencyText.ok) {
      return frequencyText;
    }

    const durationMinutes = integerField(body, "durationMinutes", "Duration");
    if (!durationMinutes.ok) {
      return durationMinutes;
    }
    if (durationMinutes.value <= 0) {
      return { ok: false, message: "Duration must be greater than 0 minutes." };
    }

    return {
      ok: true,
      value: {
        kind: "flexible",
        description: description.value,
        frequencyText: frequencyText.value,
        durationMinutes: durationMinutes.value,
      },
    };
  }

  return { ok: false, message: "Kind must be scheduled or flexible." };
}
