import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getMode, setMode } from "@/lib/db/mode";
import { getTimeBudget, setTimeBudget } from "@/lib/db/timeBudget";
import { MODES, type SettingsPayload, validateSettingsInput } from "./validation";

function readSettings(): SettingsPayload {
  return {
    mode: getMode(),
    budgets: {
      work: getTimeBudget("work") ?? 0,
      vacation: getTimeBudget("vacation") ?? 0,
    },
  };
}

export function GET() {
  return NextResponse.json(readSettings());
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const result = validateSettingsInput(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const save = getDb().transaction(() => {
    setMode(result.value.mode);
    for (const mode of MODES) {
      setTimeBudget(mode, result.value.budgets[mode]);
    }
  });
  save();

  return NextResponse.json(readSettings());
}
