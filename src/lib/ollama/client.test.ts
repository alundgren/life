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
