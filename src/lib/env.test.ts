import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("returns the parsed env when all required vars are present", () => {
    const env = loadEnv({
      SQLITE_DB_PATH: "/tmp/test.db",
      OLLAMA_HOST: "http://localhost:11434",
      OLLAMA_MODEL: "test-model",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.SQLITE_DB_PATH).toBe("/tmp/test.db");
    expect(env.OLLAMA_HOST).toBe("http://localhost:11434");
    expect(env.OLLAMA_MODEL).toBe("test-model");
  });

  it("throws a clear error naming the missing vars", () => {
    expect(() => loadEnv({} as unknown as NodeJS.ProcessEnv)).toThrow(
      /SQLITE_DB_PATH, OLLAMA_HOST, OLLAMA_MODEL/
    );
  });
});
