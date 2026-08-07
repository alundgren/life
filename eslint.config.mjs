import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Module-level mutable state (`let`/`var`) is invisible across the separate module
    // instances Next.js's standalone build gives instrumentation vs. route handlers of the
    // same file — see ADR 0009. Data belongs in SQLite (src/lib/db/plannerLock.ts); wiring
    // that can't be serialized belongs behind globalThis (src/lib/ollama/client.ts).
    files: ["src/lib/**/*.ts"],
    ignores: ["src/lib/**/*.test.ts", "src/lib/**/*.integration.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program > VariableDeclaration[kind!='const']",
          message:
            "Top-level mutable state is invisible across Next.js's module instances (ADR 0009). Use SQLite for data or a globalThis slot for wiring instead.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local Claude Code tool config, not app source.
    ".claude/**",
  ]),
]);

export default eslintConfig;
