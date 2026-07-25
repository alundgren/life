import { NextResponse } from "next/server";
import { PlannedActivityAlreadyDoneError, recordCompletion } from "@/lib/db/completion";
import { validateCompletionInput } from "./validation";

/** Records a Completion, optionally linking it to a Planned Activity and marking that activity Done. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const result = validateCompletionInput(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  try {
    return NextResponse.json(recordCompletion(result.value), { status: 201 });
  } catch (error) {
    if (error instanceof PlannedActivityAlreadyDoneError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
