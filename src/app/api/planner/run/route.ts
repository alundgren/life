import { NextResponse } from "next/server";
import { isPlannerRunInFlight, runPlannerOnce } from "@/lib/planner/planner";

/** Runs the Planner by hand, on demand, outside its normal 15-minute schedule. */
export async function POST(request: Request) {
  if (isPlannerRunInFlight()) {
    return NextResponse.json({ error: "The Planner is already running." }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as { force?: unknown };
  await runPlannerOnce({ force: body.force === true });
  return new NextResponse(null, { status: 204 });
}
