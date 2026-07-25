import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { getMode, setMode } from "@/lib/db/mode";
import { getTimeBudget, setTimeBudget } from "@/lib/db/timeBudget";
import { GET, PUT } from "./route";
import type { SettingsPayload } from "./validation";

function putRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validSettings: SettingsPayload = {
  mode: "vacation",
  budgets: { work: 240, vacation: 900 },
};

describe("Settings API", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("returns the seeded default Mode and both Time Budgets", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect((await response.json()) as SettingsPayload).toEqual({
      mode: "work",
      budgets: { work: 180, vacation: 600 },
    });
  });

  it("persists a Mode switch and later reads it back", async () => {
    const response = await PUT(putRequest(validSettings));

    expect(response.status).toBe(200);
    expect((await response.json()) as SettingsPayload).toEqual(validSettings);
    expect(getMode()).toBe("vacation");
    expect((await GET().json()) as SettingsPayload).toMatchObject({ mode: "vacation" });
  });

  it("updates one budget while leaving the other at the submitted existing value", async () => {
    const response = await PUT(
      putRequest({ mode: "work", budgets: { work: 300, vacation: 600 } })
    );

    expect(response.status).toBe(200);
    expect(getTimeBudget("work")).toBe(300);
    expect(getTimeBudget("vacation")).toBe(600);
  });

  it("accepts a Time Budget of zero", async () => {
    const response = await PUT(
      putRequest({ mode: "work", budgets: { work: 0, vacation: 600 } })
    );

    expect(response.status).toBe(200);
    expect(getTimeBudget("work")).toBe(0);
  });

  describe("rejects invalid input with a 400 and a specific message", () => {
    const cases: Array<[string, unknown, string]> = [
      ["non-object body", null, "Request body must be an object."],
      ["unrecognised Mode", { ...validSettings, mode: "sabbatical" }, 'Mode must be "work" or "vacation".'],
      ["missing budgets", { mode: "work" }, "Budgets are required."],
      [
        "missing work budget",
        { mode: "work", budgets: { vacation: 600 } },
        "Budget for work Mode is required.",
      ],
      [
        "negative budget",
        { mode: "work", budgets: { work: -1, vacation: 600 } },
        "Budget for work Mode must be at least 0 minutes.",
      ],
      [
        "fractional budget",
        { mode: "work", budgets: { work: 1.5, vacation: 600 } },
        "Budget for work Mode must be a whole number of minutes.",
      ],
      [
        "budget larger than a week",
        { mode: "work", budgets: { work: 10081, vacation: 600 } },
        "Budget for work Mode cannot be more than one week.",
      ],
    ];

    for (const [name, body, message] of cases) {
      it(name, async () => {
        const response = await PUT(putRequest(body));

        expect(response.status).toBe(400);
        expect((await response.json()) as { error: string }).toEqual({ error: message });
      });
    }
  });

  it("rejects malformed JSON", async () => {
    const response = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toEqual({
      error: "Request body must be valid JSON.",
    });
  });

  it("leaves Mode and both budgets unchanged when a write is rejected", async () => {
    setMode("work");
    setTimeBudget("work", 180);
    setTimeBudget("vacation", 600);

    const response = await PUT(
      putRequest({ mode: "vacation", budgets: { work: 180, vacation: -1 } })
    );

    expect(response.status).toBe(400);
    expect(getMode()).toBe("work");
    expect(getTimeBudget("work")).toBe(180);
    expect(getTimeBudget("vacation")).toBe(600);
  });
});
