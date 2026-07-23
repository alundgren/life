# Life — Recurring Task Planner

See [CONTEXT.md](CONTEXT.md) for the domain glossary and `docs/adr/` for architectural decisions.

## Prerequisites

- Node.js >= 22.13.0
- pnpm >= 11.1.2 (`corepack enable` will provide the version pinned in `package.json`)

## Local development (without Docker)

```bash
pnpm install
cp .env.example .env   # then adjust SQLITE_DB_PATH if needed
pnpm dev
```

The app is available at [http://localhost:3000](http://localhost:3000). On startup the app validates required environment variables and applies any pending SQLite migrations automatically.

## Local development (with Docker Compose)

Brings up the app alongside a real Ollama instance, so the Planner talks to actual Ollama instead of failing to connect.

```bash
cp .env.example .env   # required before the first `docker compose up`
docker compose up
```

The app is available at [http://localhost:3000](http://localhost:3000).

- On every startup, the `ollama` service pulls the model named by `OLLAMA_MODEL` in `.env` before the `app` service starts — no manual `ollama pull` step. The first pull can take a while depending on the model, and the `app` container waits for it; later restarts re-check the already-pulled model, which is fast.
- The SQLite file lives in a named volume (`sqlite-data`) and survives `docker compose down` / `up`. The pulled Ollama model lives in its own named volume (`ollama-data`) so it isn't re-downloaded on every restart.
- The project directory is bind-mounted into the `app` container, so editing source on the host hot-reloads the running dev server. `node_modules` and `.next` stay in anonymous volumes so the container's own (Linux) install isn't shadowed by the host's.
- Run `docker compose down -v` to also drop the named volumes (fresh database and a re-pulled model on next `up`).

## Environment variables

See `.env.example` for the full list. The app fails fast at startup with a clear error if a required variable is missing.

## Database migrations

SQL migration files live in `migrations/`, numbered and applied in order (e.g. `0001_create_placeholder_message.sql`). Applied filenames are tracked in a `schema_migrations` table so a migration is never re-applied. Migrations are append-only — never edit a migration after it has merged; add a new one instead.

## Verification

```bash
pnpm build
pnpm lint
pnpm test
```

All three must exit `0` before pushing. `pnpm test` runs the service-free unit suite only — no real SQLite file, Docker, or Ollama instance required. `pnpm test:integration` is a separate, currently-empty suite reserved for tests that need real services.
