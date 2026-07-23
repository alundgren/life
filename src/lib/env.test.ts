import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("returns the parsed env when all required vars are present", () => {
    const env = loadEnv({ SQLITE_DB_PATH: "/tmp/test.db" } as unknown as NodeJS.ProcessEnv);
    expect(env.SQLITE_DB_PATH).toBe("/tmp/test.db");
  });

  it("throws a clear error naming the missing var", () => {
    expect(() => loadEnv({} as unknown as NodeJS.ProcessEnv)).toThrow(/SQLITE_DB_PATH/);
  });
});
