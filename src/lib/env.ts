export interface Env {
  SQLITE_DB_PATH: string;
  OLLAMA_HOST: string;
  OLLAMA_MODEL: string;
}

const REQUIRED_VARS = ["SQLITE_DB_PATH", "OLLAMA_HOST", "OLLAMA_MODEL"] as const;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const missing = REQUIRED_VARS.filter((name) => !source[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. See .env.example.`
    );
  }

  return {
    SQLITE_DB_PATH: source.SQLITE_DB_PATH!,
    OLLAMA_HOST: source.OLLAMA_HOST!,
    OLLAMA_MODEL: source.OLLAMA_MODEL!,
  };
}

let cachedEnv: Env | undefined;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = loadEnv();
  }
  return cachedEnv;
}
