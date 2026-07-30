import type { ModelCallKind, NewModelCall } from "@/lib/db/modelCall";

export interface OllamaConfig {
  host: string;
  model: string;
  kind: ModelCallKind;
  /** Constrains the model's output; forwarded to Ollama verbatim when set. */
  format?: "json";
}

export type ModelCallRecorder = (call: NewModelCall) => number;

let modelCallRecorder: ModelCallRecorder | undefined;

/** Wires the optional diagnostic recorder without giving this HTTP client a database dependency. */
export function setModelCallRecorder(recorder: ModelCallRecorder | undefined): void {
  modelCallRecorder = recorder;
}

function recordModelCall(call: NewModelCall): number | undefined {
  try {
    return modelCallRecorder?.(call);
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
  const startedAt = Date.now();
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
      calledAt: new Date().toISOString(),
      kind: config.kind,
      model: config.model,
      requestText: prompt,
      responseText: data.response,
      status: "ok",
      durationMs: Date.now() - startedAt,
    });
    return { response: data.response, modelCallId };
  } catch (error) {
    recordModelCall({
      calledAt: new Date().toISOString(),
      kind: config.kind,
      model: config.model,
      requestText: prompt,
      errorText: errorText(error),
      status: "error",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
