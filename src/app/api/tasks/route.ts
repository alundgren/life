import { NextResponse } from "next/server";
import { createFlexibleTask, createScheduledTask, listTasks } from "@/lib/db/task";
import { validateTaskBody } from "./validation";

export function GET() {
  return NextResponse.json({ tasks: listTasks() });
}

export async function POST(request: Request) {
  const validation = validateTaskBody(await request.json().catch(() => null));
  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: 400 });
  }

  const task =
    validation.value.kind === "scheduled"
      ? createScheduledTask(validation.value)
      : createFlexibleTask(validation.value);

  return NextResponse.json({ task }, { status: 201 });
}
