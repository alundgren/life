import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("returns the parsed env when all required vars are present", () => {
    const env = loadEnv({
      SQLITE_DB_PATH: "/tmp/test.db",
      OLLAMA_HOST: "http://localhost:11434",
      OLLAMA_MODEL: "test-model",
      APP_TIME_ZONE: "Europe/Stockholm",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.SQLITE_DB_PATH).toBe("/tmp/test.db");
    expect(env.OLLAMA_HOST).toBe("http://localhost:11434");
    expect(env.OLLAMA_MODEL).toBe("test-model");
    expect(env.APP_TIME_ZONE).toBe("Europe/Stockholm");
    expect(env.SIMULATED_CLOCK).toBe(false);
  });

  it("enables the Simulated Clock only when explicitly set to true", () => {
    expect(
      loadEnv({
        SQLITE_DB_PATH: "/tmp/test.db",
        OLLAMA_HOST: "http://localhost:11434",
        OLLAMA_MODEL: "test-model",
        APP_TIME_ZONE: "Europe/Stockholm",
        SIMULATED_CLOCK: "true",
      } as unknown as NodeJS.ProcessEnv).SIMULATED_CLOCK
    ).toBe(true);
  });

  it("throws a clear error naming the missing vars", () => {
    expect(() => loadEnv({} as unknown as NodeJS.ProcessEnv)).toThrow(
      /SQLITE_DB_PATH, OLLAMA_HOST, OLLAMA_MODEL, APP_TIME_ZONE/
    );
  });

  it("rejects an invalid application time zone", () => {
    expect(() =>
      loadEnv({
        SQLITE_DB_PATH: "/tmp/test.db",
        OLLAMA_HOST: "http://localhost:11434",
        OLLAMA_MODEL: "test-model",
        APP_TIME_ZONE: "Etc/GMT-2",
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/APP_TIME_ZONE must be a valid named IANA time zone/);
  });
});
