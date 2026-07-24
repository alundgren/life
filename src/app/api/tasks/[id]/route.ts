import { NextResponse } from "next/server";
import {
  TaskUpdateTargetNotFoundError,
  updateFlexibleTask,
  updateScheduledTask,
} from "@/lib/db/task";
import { validateTaskBody } from "../validation";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id: idText } = await context.params;
  const id = Number(idText);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Task id must be a positive integer." }, { status: 400 });
  }

  const validation = validateTaskBody(await request.json().catch(() => null));
  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: 400 });
  }

  try {
    const task =
      validation.value.kind === "scheduled"
        ? updateScheduledTask(id, validation.value)
        : updateFlexibleTask(id, validation.value);

    return NextResponse.json({ task });
  } catch (error) {
    if (error instanceof TaskUpdateTargetNotFoundError) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    throw error;
  }
}
