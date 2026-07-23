import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { callOllama } from "@/lib/ollama/client";

const HEARTBEAT_PROMPT = "Reply with a single word confirming you are reachable.";
const RUN_INTERVAL_MS = 15 * 60 * 1000;

export interface PlannerStatus {
  running: boolean;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastResult: string | null;
}

let running = false;
let timer: ReturnType<typeof setInterval> | undefined;

/** Starts the background Planner loop: runs immediately, then every intervalMs. */
export function startPlanner(intervalMs: number = RUN_INTERVAL_MS): void {
  if (running) {
    return;
  }
  running = true;
  void runPlannerOnce();
  timer = setInterval(() => void runPlannerOnce(), intervalMs);
}

export function stopPlanner(): void {
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

export function getPlannerStatus(): PlannerStatus {
  const row = getDb()
    .prepare("SELECT ran_at, status, result FROM planner_run ORDER BY id DESC LIMIT 1")
    .get() as { ran_at: string; status: string; result: string | null } | undefined;

  return {
    running,
    lastRunAt: row?.ran_at ?? null,
    lastStatus: (row?.status as "ok" | "error" | undefined) ?? null,
    lastResult: row ? row.result : null,
  };
}

/** Calls Ollama once through the client wrapper and records the outcome as a heartbeat. */
export async function runPlannerOnce(): Promise<void> {
  const env = getEnv();
  const recordRun = getDb().prepare(
    "INSERT INTO planner_run (ran_at, status, result) VALUES (?, ?, ?)"
  );

  try {
    const response = await callOllama(HEARTBEAT_PROMPT, {
      host: env.OLLAMA_HOST,
      model: env.OLLAMA_MODEL,
    });
    recordRun.run(new Date().toISOString(), "ok", response);
  } catch (error) {
    recordRun.run(
      new Date().toISOString(),
      "error",
      error instanceof Error ? error.message : String(error)
    );
  }
}
