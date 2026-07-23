import { defineConfig } from "vitest/config";

// Home for future tests that need a real Ollama/Docker environment.
// Kept separate so the everyday unit suite (vitest.config.ts) never gains a service dependency.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
  },
});
