import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Service-dependent tests belong to vitest.integration.config.ts only.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
