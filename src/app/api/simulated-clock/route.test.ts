import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { GET, POST } from "./route";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/simulated-clock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Simulated Clock API", () => {
  beforeEach(() => {
    vi.stubEnv("SIMULATED_CLOCK", "true");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-02T12:00:00.000Z"));
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("reports the frozen server date and advances it by one day or one week", async () => {
    expect(await GET().json()).toMatchObject({
      enabled: true,
      today: "2030-01-02",
    });

    expect(await POST(postRequest({ days: 1 })).then((response) => response.json())).toMatchObject({
      today: "2030-01-03",
    });
    expect(await POST(postRequest({ days: 7 })).then((response) => response.json())).toMatchObject({
      today: "2030-01-10",
    });
  });

  it("rejects any advance other than one day or one week", async () => {
    const response = await POST(postRequest({ days: 2 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Days must be 1 or 7." });
  });
});
