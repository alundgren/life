export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { getEnv } = await import("@/lib/env");
  const { getDb } = await import("@/lib/db/client");
  const { runMigrations } = await import("@/lib/db/migrate");

  getEnv();
  runMigrations(getDb());
}
