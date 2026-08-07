import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, resetDb, setDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { createModelCall, getModelCallById, listRecentModelCalls } from "@/lib/db/modelCall";
import type { NewModelCall } from "@/lib/db/modelCall";
import { callOllama, setModelCallRecorder } from "./client";

const config = {
  host: "http://localhost:11434",
  model: "test-model",
  kind: "plan-generation" as const,
};

function jsonResponse(response: string): Response {
  return { ok: true, json: async () => ({ response }) } as Response;
}

describe("callOllama", () => {
  beforeEach(() => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    setDb(db);
  });

  afterEach(() => {
    setModelCallRecorder(undefined);
    resetDb();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("posts the prompt to the Ollama generate endpoint and returns the response text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse("pong"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callOllama("ping", config);

    expect(result).toEqual({ response: "pong", modelCallId: undefined });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test-model", prompt: "ping", stream: false }),
      signal: expect.any(AbortSignal),
    });
  });

  it("records a successful call with its request, response, model, kind, and duration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse("pong")));
    setModelCallRecorder(createModelCall);

    const result = await callOllama("ping", config);

    expect(result.modelCallId).toBeDefined();
    expect(getModelCallById(result.modelCallId!)).toMatchObject({
      kind: "plan-generation",
      model: "test-model",
      requestText: "ping",
      responseText: "pong",
      status: "ok",
    });
    expect(getModelCallById(result.modelCallId!)?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("forwards the requested response format when one is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await callOllama("ping", { ...config, format: "json" });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
        prompt: "ping",
        stream: false,
        format: "json",
      }),
      signal: expect.any(AbortSignal),
    });
  });

  it("records connection failures and still re-raises their error", async () => {
    const failure = new TypeError("fetch failed");
    failure.cause = new Error("connect ECONNREFUSED 127.0.0.1:11434");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
    setModelCallRecorder(createModelCall);

    await expect(callOllama("ping", config)).rejects.toThrow(
      "Ollama request to http://localhost:11434 failed: connect ECONNREFUSED 127.0.0.1:11434"
    );
    expect(listRecentModelCalls()).toMatchObject([
      {
        requestPreview: "ping",
        errorPreview: "Ollama request to http://localhost:11434 failed: connect ECONNREFUSED 127.0.0.1:11434",
        status: "error",
      },
    ]);
  });

  it("records failed statuses and still re-raises their error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" })
    );
    setModelCallRecorder(createModelCall);

    await expect(callOllama("ping", config)).rejects.toThrow("Ollama request failed: 500 Internal Server Error");
    expect(listRecentModelCalls()[0]).toMatchObject({
      errorPreview: "Ollama request failed: 500 Internal Server Error",
      status: "error",
    });
  });

  it("aborts a hanging request after 180 seconds and records the timeout", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason));
        });
      })
    );
    setModelCallRecorder(createModelCall);

    const call = callOllama("ping", config);
    const expectedTimeout = expect(call).rejects.toThrow(
      "Ollama request to http://localhost:11434 timed out after 180 seconds"
    );
    await vi.advanceTimersByTimeAsync(180_000);

    await expectedTimeout;
    expect(requestSignal?.aborted).toBe(true);
    expect(listRecentModelCalls()[0]).toMatchObject({
      errorPreview: "Ollama request to http://localhost:11434 timed out after 180 seconds",
      status: "error",
    });
  });

  it("keeps only the 100 newest recorded calls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse("pong")));
    setModelCallRecorder(createModelCall);

    for (let index = 0; index < 101; index++) {
      await callOllama(`prompt ${index}`, config);
    }

    const calls = listRecentModelCalls();
    expect(calls).toHaveLength(100);
    expect(calls[0].requestPreview).toBe("prompt 100");
    expect(calls.at(-1)?.requestPreview).toBe("prompt 1");
  });

  it("shares the recorder across separate module instances, as Next.js gives the instrumentation hook and route handlers", async () => {
    // Simulates production: instrumentation.node.ts and an API route each get their own bundled
    // copy of this module, so a plain module-level variable set by one is invisible to the other.
    const recorded: NewModelCall[] = [];

    vi.resetModules();
    const instrumentationInstance = await import("./client");
    instrumentationInstance.setModelCallRecorder((call) => {
      recorded.push(call);
      return 1;
    });

    vi.resetModules();
    const routeHandlerInstance = await import("./client");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse("pong")));

    const result = await routeHandlerInstance.callOllama("ping", config);

    expect(result.modelCallId).toBe(1);
    expect(recorded).toMatchObject([{ requestText: "ping", responseText: "pong", status: "ok" }]);
  });

  it("keeps the Ollama request working when the recorder fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse("pong")));
    setModelCallRecorder(() => {
      throw new Error("disk full");
    });

    await expect(callOllama("ping", config)).resolves.toEqual({ response: "pong", modelCallId: undefined });
  });
});
