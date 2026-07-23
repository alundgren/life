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
