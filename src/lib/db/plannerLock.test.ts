import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, resetDb, setDb } from "./client";
import { runMigrations } from "./migrate";
import {
  isPlannerRunInFlight,
  isPlannerRunning,
  releasePlannerRun,
  setPlannerRunning,
  tryAcquirePlannerRun,
} from "./plannerLock";

describe("planner lock data access", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    resetDb();
  });

  it("starts stopped and idle", () => {
    expect(isPlannerRunning()).toBe(false);
    expect(isPlannerRunInFlight()).toBe(false);
  });

  it("tracks the running flag", () => {
    setPlannerRunning(true);
    expect(isPlannerRunning()).toBe(true);

    setPlannerRunning(false);
    expect(isPlannerRunning()).toBe(false);
  });

  it("acquires the in-flight slot only while it is free", () => {
    expect(tryAcquirePlannerRun()).toBe(true);
    expect(isPlannerRunInFlight()).toBe(true);
    expect(tryAcquirePlannerRun()).toBe(false);

    releasePlannerRun();
    expect(isPlannerRunInFlight()).toBe(false);
    expect(tryAcquirePlannerRun()).toBe(true);
  });
});

describe("planner lock across separate module instances", () => {
  // Simulates production: instrumentation.node.ts and an API route each get their own bundled
  // copy of src/lib/planner/planner.ts (and everything it imports), so a plain module-level
  // variable set by one is invisible to the other. Uses a real file, not ":memory:", so each
  // resetModules'd instance's own SQLite connection (db/client.ts's `dbInstance` is duplicated
  // the same way, per #98) still reads and writes the one row on disk, exactly like production.
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "planner-lock-test-")), "test.db");
    vi.stubEnv("SQLITE_DB_PATH", dbPath);
    vi.stubEnv("OLLAMA_HOST", "http://localhost:11434");
    vi.stubEnv("OLLAMA_MODEL", "test-model");
    vi.stubEnv("APP_TIME_ZONE", "Europe/Stockholm");

    const bootstrap = createDbClient(dbPath);
    runMigrations(bootstrap);
    bootstrap.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("shares in-flight and running state across instances, as Next.js gives instrumentation and route handlers", async () => {
    vi.resetModules();
    const instrumentationInstance = await import("./plannerLock");

    vi.resetModules();
    const routeHandlerInstance = await import("./plannerLock");

    expect(instrumentationInstance.tryAcquirePlannerRun()).toBe(true);
    expect(routeHandlerInstance.isPlannerRunInFlight()).toBe(true);
    expect(routeHandlerInstance.tryAcquirePlannerRun()).toBe(false);

    instrumentationInstance.releasePlannerRun();
    expect(routeHandlerInstance.isPlannerRunInFlight()).toBe(false);

    instrumentationInstance.setPlannerRunning(true);
    expect(routeHandlerInstance.isPlannerRunning()).toBe(true);
  });
});
