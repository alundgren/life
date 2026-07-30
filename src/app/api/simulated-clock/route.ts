import { NextResponse } from "next/server";
import {
  advanceSimulatedClock,
  formatLocalDate,
  getApplicationTimeZone,
  getCurrentTime,
  isSimulatedClockEnabled,
} from "@/lib/simulatedClock";

function snapshot() {
  const now = getCurrentTime();
  return {
    enabled: isSimulatedClockEnabled(),
    now: now.toISOString(),
    today: formatLocalDate(now),
    timeZone: getApplicationTimeZone(),
  };
}

/** Returns the server's notion of today, plus Simulated Clock state for development controls. */
export function GET() {
  return NextResponse.json(snapshot());
}

/** Advances the development-only frozen clock by one day or one week. */
export async function POST(request: Request) {
  if (!isSimulatedClockEnabled()) {
    return NextResponse.json({ error: "The Simulated Clock is not enabled." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const days = (body as { days?: unknown })?.days;
  if (days !== 1 && days !== 7) {
    return NextResponse.json({ error: "Days must be 1 or 7." }, { status: 400 });
  }

  const now = advanceSimulatedClock(days);
  return NextResponse.json({
    enabled: true,
    now: now.toISOString(),
    today: formatLocalDate(now),
    timeZone: getApplicationTimeZone(),
  });
}
