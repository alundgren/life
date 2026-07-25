import { getPlannedActivityById } from "@/lib/db/plannedActivity";
import { getTaskById } from "@/lib/db/task";
import type { RecordCompletionInput } from "@/lib/db/completion";

export type ValidationResult =
  | { ok: true; value: RecordCompletionInput }
  | { ok: false; error: string; status?: number };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function invalid(error: string, status = 400): ValidationResult {
  return { ok: false, error, status };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateCompletionInput(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return invalid("Request body must be an object.");
  }
  const b = body as Record<string, unknown>;

  if (!isPositiveInteger(b.taskId)) {
    return invalid("Task id is required and must be a positive integer.");
  }
  if (!getTaskById(b.taskId)) {
    return invalid("Task does not exist.");
  }
  if (!isDateString(b.completedDate)) {
    return invalid("Completed date must be YYYY-MM-DD.");
  }

  let plannedActivityId: number | undefined;
  if (b.plannedActivityId !== undefined) {
    if (!isPositiveInteger(b.plannedActivityId)) {
      return invalid("Planned Activity id must be a positive integer.");
    }
    const activity = getPlannedActivityById(b.plannedActivityId);
    if (!activity) {
      return invalid("Planned Activity does not exist.");
    }
    if (activity.taskId !== b.taskId) {
      return invalid("Planned Activity must belong to the submitted Task.");
    }
    if (activity.status === "done") {
      return invalid("Planned Activity is already done.", 409);
    }
    plannedActivityId = b.plannedActivityId;
  }

  if (b.note !== undefined && typeof b.note !== "string") {
    return invalid("Note must be a string.");
  }
  const note = typeof b.note === "string" && b.note.trim() !== "" ? b.note.trim() : undefined;

  return {
    ok: true,
    value: {
      taskId: b.taskId,
      completedDate: b.completedDate,
      plannedActivityId,
      note,
    },
  };
}
