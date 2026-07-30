import { NextResponse } from "next/server";
import { getModelCallById } from "@/lib/db/modelCall";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const modelCallId = Number(id);
  if (!Number.isInteger(modelCallId) || modelCallId <= 0) {
    return NextResponse.json({ error: "Model Call not found." }, { status: 404 });
  }

  const modelCall = getModelCallById(modelCallId);
  if (modelCall === undefined) {
    return NextResponse.json({ error: "Model Call not found." }, { status: 404 });
  }
  return NextResponse.json(modelCall);
}
