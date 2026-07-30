export interface Env {
  SQLITE_DB_PATH: string;
  OLLAMA_HOST: string;
  OLLAMA_MODEL: string;
  APP_TIME_ZONE: string;
  SIMULATED_CLOCK: boolean;
}

const REQUIRED_VARS = ["SQLITE_DB_PATH", "OLLAMA_HOST", "OLLAMA_MODEL", "APP_TIME_ZONE"] as const;

function isValidTimeZone(timeZone: string): boolean {
  if (/^(?:[+-]|(?:UTC|GMT)[+-]|Etc\/GMT(?:[+-]\d+)?)$/i.test(timeZone)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const missing = REQUIRED_VARS.filter((name) => !source[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. See .env.example.`
    );
  }
  if (!isValidTimeZone(source.APP_TIME_ZONE!)) {
    throw new Error("APP_TIME_ZONE must be a valid named IANA time zone. See .env.example.");
  }

  return {
    SQLITE_DB_PATH: source.SQLITE_DB_PATH!,
    OLLAMA_HOST: source.OLLAMA_HOST!,
    OLLAMA_MODEL: source.OLLAMA_MODEL!,
    APP_TIME_ZONE: source.APP_TIME_ZONE!,
    SIMULATED_CLOCK: source.SIMULATED_CLOCK === "true",
  };
}

let cachedEnv: Env | undefined;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = loadEnv();
  }
  return cachedEnv;
}
