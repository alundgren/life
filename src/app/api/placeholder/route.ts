import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";

export function GET() {
  const db = getDb();

  const row = db
    .prepare("SELECT message FROM placeholder_message ORDER BY id LIMIT 1")
    .get() as { message: string } | undefined;

  const plannerRun = db
    .prepare("SELECT ran_at, status, result FROM planner_run ORDER BY id DESC LIMIT 1")
    .get() as { ran_at: string; status: string; result: string | null } | undefined;

  return NextResponse.json({
    message: row?.message ?? null,
    plannerRun: plannerRun
      ? { ranAt: plannerRun.ran_at, status: plannerRun.status, result: plannerRun.result }
      : null,
  });
}
