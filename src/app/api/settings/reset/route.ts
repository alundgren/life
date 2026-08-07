import { NextResponse } from "next/server";
import { resetAllData } from "@/lib/db/reset";
import { isPlannerRunInFlight } from "@/lib/planner/planner";

const CONFIRM_PHRASE = "reset";

/** Wipes all app data back to a fresh-install state. Requires an explicit body confirmation. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const confirm = (body as { confirm?: unknown })?.confirm;
  if (confirm !== CONFIRM_PHRASE) {
    return NextResponse.json(
      { error: `Request must confirm with { "confirm": "${CONFIRM_PHRASE}" }.` },
      { status: 400 }
    );
  }

  if (isPlannerRunInFlight()) {
    return NextResponse.json({ error: "The Planner is running. Try again shortly." }, { status: 409 });
  }

  resetAllData();
  return new NextResponse(null, { status: 204 });
}
