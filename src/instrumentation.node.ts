export async function registerNode() {
  try {
    const { getEnv } = await import("@/lib/env");
    const { getDb } = await import("@/lib/db/client");
    const { runMigrations } = await import("@/lib/db/migrate");
    const { createModelCall } = await import("@/lib/db/modelCall");
    const { setModelCallRecorder } = await import("@/lib/ollama/client");
    const { startPlanner } = await import("@/lib/planner/planner");

    getEnv();
    runMigrations(getDb());
    setModelCallRecorder(createModelCall);
    startPlanner();
  } catch (error) {
    // Fail fast: exit immediately rather than leaving the server bound
    // and answering requests with 500s while Next.js unwinds the rejection.
    console.error(error);
    process.exit(1);
  }
}
