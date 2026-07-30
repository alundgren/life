import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { createModelCall } from "@/lib/db/modelCall";
import { GET as getDetail } from "./[id]/route";
import { GET } from "./route";

function createCall(requestText: string, responseText = "response"): number {
  return createModelCall({
    calledAt: "2026-07-30T10:00:00.000Z",
    kind: "plan-generation",
    model: "test-model",
    requestText,
    responseText,
    status: "ok",
    durationMs: 50,
  });
}

describe("Model Calls API", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(resetDb);

  it("lists newest previews without the full request and response text", async () => {
    createCall("first prompt");
    const newest = createCall("x".repeat(200), "y".repeat(200));

    const response = await GET();
    const body = (await response.json()) as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(body.map((call) => call.id)).toEqual([newest, newest - 1]);
    expect(body[0]).toMatchObject({ requestPreview: `${"x".repeat(160)}…`, responsePreview: `${"y".repeat(160)}…` });
    expect(body[0]).not.toHaveProperty("requestText");
    expect(body[0]).not.toHaveProperty("responseText");
  });

  it("returns the full request and response for one Model Call", async () => {
    const id = createCall("full prompt", "full response");

    const response = await getDetail(new Request("http://localhost/api/model-calls/1"), {
      params: Promise.resolve({ id: String(id) }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, requestText: "full prompt", responseText: "full response" });
  });

  it("returns 404 when a Model Call has been discarded", async () => {
    const response = await getDetail(new Request("http://localhost/api/model-calls/999"), {
      params: Promise.resolve({ id: "999" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Model Call not found." });
  });
});
