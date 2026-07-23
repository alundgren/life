export interface OllamaConfig {
  host: string;
  model: string;
}

/** The only place in the app allowed to talk to Ollama directly. */
export async function callOllama(prompt: string, config: OllamaConfig): Promise<string> {
  const res = await fetch(`${config.host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, prompt, stream: false }),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { response: string };
  return data.response;
}
