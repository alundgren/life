export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  try {
    const { getEnv } = await import("@/lib/env");
    const { getDb } = await import("@/lib/db/client");
    const { runMigrations } = await import("@/lib/db/migrate");
    const { startPlanner } = await import("@/lib/planner/planner");

    getEnv();
    runMigrations(getDb());
    startPlanner();
  } catch (error) {
    // Fail fast: exit immediately rather than leaving the server bound
    // and answering requests with 500s while Next.js unwinds the rejection.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
