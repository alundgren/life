import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    env: {
      APP_TIME_ZONE: "Europe/Stockholm",
    },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Service-dependent tests belong to vitest.integration.config.ts only.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
