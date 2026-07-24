import { NextResponse } from "next/server";
import { updateFlexibleTask, updateScheduledTask } from "@/lib/db/task";
import { validateTaskInput } from "../validation";

/**
 * Directly edits a Task's fields (not a Correction): validates the kind-tagged body, then
 * updates in place. Returns 404 when no Task with that id and kind exists, so an edit can
 * never write the wrong kind's row or resurrect a missing Task.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const result = validateTaskInput(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const updated =
    result.value.kind === "scheduled"
      ? updateScheduledTask(taskId, result.value)
      : updateFlexibleTask(taskId, result.value);

  if (!updated) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  return NextResponse.json(updated);
}
