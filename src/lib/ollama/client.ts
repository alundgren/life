import type { ModelCallKind, NewModelCall } from "@/lib/db/modelCall";
import { getCurrentTime } from "@/lib/simulatedClock";

export interface OllamaConfig {
  host: string;
  model: string;
  kind: ModelCallKind;
  /** Constrains the model's output; forwarded to Ollama verbatim when set. */
  format?: "json";
}

export type ModelCallRecorder = (call: NewModelCall) => number;

/**
 * Next.js's standalone build gives the instrumentation hook and route handlers separate module
 * instances of this file, so a plain module-level variable set by one is invisible to the other.
 * `globalThis` is the one thing shared across those instances within a single Node process.
 */
const RECORDER_KEY = Symbol.for("life.ollama.modelCallRecorder");

interface GlobalWithModelCallRecorder {
  [RECORDER_KEY]?: ModelCallRecorder;
}

/** Finite ceiling for a Planner Model Call, including a cold Ollama model load. */
const OLLAMA_REQUEST_TIMEOUT_MS = 180_000;

/** Wires the optional diagnostic recorder without giving this HTTP client a database dependency. */
export function setModelCallRecorder(recorder: ModelCallRecorder | undefined): void {
  (globalThis as GlobalWithModelCallRecorder)[RECORDER_KEY] = recorder;
}

function recordModelCall(call: NewModelCall): number | undefined {
  try {
    return (globalThis as GlobalWithModelCallRecorder)[RECORDER_KEY]?.(call);
  } catch {
    // A diagnostic log must never make the LLM call fail.
    return undefined;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The only place in the app allowed to talk to Ollama directly. */
export async function callOllama(
  prompt: string,
  config: OllamaConfig
): Promise<{ response: string; modelCallId: number | undefined }> {
  const startedAt = performance.now();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), OLLAMA_REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${config.host}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          prompt,
          stream: false,
          ...(config.format === undefined ? {} : { format: config.format }),
        }),
        signal: abortController.signal,
      });
    } catch (error) {
      // A connection failure surfaces as a bare "fetch failed"; the reason is only in `cause`.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : error;
      throw new Error(`Ollama request to ${config.host} failed: ${cause}`);
    }

    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { response: string };
    if (typeof data.response !== "string") {
      throw new Error("Ollama response did not include response text");
    }
    const modelCallId = recordModelCall({
      calledAt: getCurrentTime().toISOString(),
      kind: config.kind,
      model: config.model,
      requestText: prompt,
      responseText: data.response,
      status: "ok",
      durationMs: performance.now() - startedAt,
    });
    return { response: data.response, modelCallId };
  } catch (error) {
    const errorToRecord = abortController.signal.aborted
      ? new Error(`Ollama request to ${config.host} timed out after 180 seconds`)
      : error;
    recordModelCall({
      calledAt: getCurrentTime().toISOString(),
      kind: config.kind,
      model: config.model,
      requestText: prompt,
      errorText: errorText(errorToRecord),
      status: "error",
      durationMs: performance.now() - startedAt,
    });
    throw errorToRecord;
  } finally {
    clearTimeout(timeout);
  }
}
