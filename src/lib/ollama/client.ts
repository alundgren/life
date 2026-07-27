export interface OllamaConfig {
  host: string;
  model: string;
  format?: "json";
}

/** The only place in the app allowed to talk to Ollama directly. */
export async function callOllama(prompt: string, config: OllamaConfig): Promise<string> {
  const body: { model: string; prompt: string; stream: false; format?: "json" } = {
    model: config.model,
    prompt,
    stream: false,
  };
  if (config.format) {
    body.format = config.format;
  }

  const res = await fetch(`${config.host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { response: string };
  return data.response;
}
