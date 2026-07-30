import { NextResponse } from "next/server";
import { runPlannerOnce } from "@/lib/planner/planner";
import { isSimulatedClockEnabled } from "@/lib/simulatedClock";

/** Runs the Planner by hand while the development-only Simulated Clock is active. */
export async function POST() {
  if (!isSimulatedClockEnabled()) {
    return NextResponse.json({ error: "The Simulated Clock is not enabled." }, { status: 404 });
  }

  await runPlannerOnce();
  return new NextResponse(null, { status: 204 });
}
