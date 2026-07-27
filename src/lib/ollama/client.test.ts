import { afterEach, describe, expect, it, vi } from "vitest";
import { callOllama } from "./client";

describe("callOllama", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the prompt to the Ollama generate endpoint and returns the response text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "pong" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callOllama("ping", {
      host: "http://localhost:11434",
      model: "test-model",
    });

    expect(result).toBe("pong");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test-model", prompt: "ping", stream: false }),
    });
  });

  it("forwards the requested response format when one is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "{}" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await callOllama("ping", {
      host: "http://localhost:11434",
      model: "test-model",
      format: "json",
    });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
        prompt: "ping",
        stream: false,
        format: "json",
      }),
    });
  });

  it("surfaces the underlying reason when the connection itself fails", async () => {
    const failure = new TypeError("fetch failed");
    failure.cause = new Error("connect ECONNREFUSED 127.0.0.1:11434");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));

    await expect(
      callOllama("ping", { host: "http://localhost:11434", model: "test-model" })
    ).rejects.toThrow("Ollama request to http://localhost:11434 failed: connect ECONNREFUSED 127.0.0.1:11434");
  });

  it("throws a clear error when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" })
    );

    await expect(
      callOllama("ping", { host: "http://localhost:11434", model: "test-model" })
    ).rejects.toThrow(/500/);
  });
});
