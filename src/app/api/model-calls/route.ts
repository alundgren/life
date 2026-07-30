import { NextResponse } from "next/server";
import { listRecentModelCalls } from "@/lib/db/modelCall";

/** Returns lightweight previews; full prompts and responses are fetched per expanded row. */
export function GET() {
  return NextResponse.json(listRecentModelCalls());
}
