import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";

export function GET() {
  const row = getDb()
    .prepare("SELECT message FROM placeholder_message ORDER BY id LIMIT 1")
    .get() as { message: string } | undefined;

  return NextResponse.json({ message: row?.message ?? null });
}
