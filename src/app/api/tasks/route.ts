import { NextResponse } from "next/server";
import { createFlexibleTask, createScheduledTask, listTasks } from "@/lib/db/task";
import { validateTaskInput } from "./validation";

/** Lists all Tasks (both kinds) as the typed, discriminated `Task[]` JSON shape. */
export function GET() {
  return NextResponse.json(listTasks());
}

/** Creates a Task from a kind-tagged body, validating before it reaches the data layer. */
export async function POST(request: Request) {
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

  const task =
    result.value.kind === "scheduled"
      ? createScheduledTask(result.value)
      : createFlexibleTask(result.value);

  return NextResponse.json(task, { status: 201 });
}
