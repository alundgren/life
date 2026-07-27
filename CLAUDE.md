## Project

Recurring task planner — see [CONTEXT.md](CONTEXT.md) for the domain glossary and `docs/adr/` for architectural decisions.

## How to work

- **Think before coding.** State your assumptions before implementing. If a request is ambiguous, ask — don't pick an interpretation and run with it silently.
- **Simplicity first.** Build only what was asked. No speculative features, config options, or abstractions for "later." Don't add a dependency, helper, or layer when existing code already does the job.
- **Surgical changes.** Touch only what the request requires. Don't reformat, rename, or "tidy" unrelated code in the same change. Match the surrounding style.
- **Goal-driven execution.** Restate imperative instructions as a goal with a verification check, then verify before declaring done — see "Verification gate" below.

## Verification gate

Run before declaring a task done; fix any failures first.

```bash
pnpm build   # must exit 0
pnpm lint    # must exit 0
pnpm test    # must exit 0
```

`pnpm test` runs the service-free unit suite (`vitest.config.ts`) — no real SQLite file, Docker, or Ollama instance required. `pnpm test:integration` (`vitest.integration.config.ts`) is a separate suite for tests that need real services; it is not part of the gate.
The integration suite is developer-only; agents must not run `pnpm test:integration` or set its opt-in environment variables.

## Pull requests

- Keep the description short and to the point.
- If the PR closes a GitHub issue, link it (e.g. `Closes #123`).

## Data layer

- SQLite via a `better-sqlite3` singleton (`src/lib/db/client.ts`), WAL mode and foreign keys on. Tests inject an in-memory db via `setDb()`/`resetDb()` instead of going through the real env-backed singleton.
- Migrations are numbered SQL files under `migrations/` (e.g. `0001_create_placeholder_message.sql`), applied in order by `src/lib/db/migrate.ts` and tracked in a `schema_migrations` table so a file is never re-applied. Migrations are append-only — never edit one after it has merged; add a new one instead.
- Required environment variables are validated at process start (`src/lib/env.ts`, invoked from `src/instrumentation.ts` alongside the migration run) so misconfiguration fails fast at boot, not on first request. See `.env.example` for the full list.
- Domain entities get one typed data-access module per entity under `src/lib/db/` (e.g. `task.ts`, `correction.ts`) — camelCase TS types over snake_case columns; application code reads and writes through these modules rather than raw SQL. A 1:1 parent/child split (e.g. `task` + its `task_scheduled`/`task_flexible` kind table) is written through a single transactional create function per kind so a parent row is never left without its child row.

## Planner & Ollama

- The Planner (`src/lib/planner/planner.ts`) starts automatically at boot from `src/instrumentation.ts`, right after migrations run. `startPlanner()` / `stopPlanner()` control its lifecycle; `getPlannerStatus()` reports whether it's running and its last recorded run.
- The Planner talks to Ollama only through the single client wrapper `src/lib/ollama/client.ts` (`callOllama`) — no other code calls Ollama directly.
- Each Planner run is recorded as a heartbeat row in the `planner_run` table (`ran_at`/`status`/`result`) and surfaced through the placeholder API/page.

## Docker Compose (local dev)

- `docker-compose.yml` runs the app alongside a real Ollama container so the Planner exercises the actual Ollama path. See the README's "Local development (with Docker Compose)" section for usage.
- The `ollama` service (`docker/ollama/`) pulls `OLLAMA_MODEL` on its own startup via a custom entrypoint and only reports healthy once the pull finishes; the `app` service depends on that health check so it never starts against a model-less Ollama.
- SQLite data and the pulled Ollama model each live in their own named volume (`sqlite-data`, `ollama-data`) so both survive `docker compose down` / `up`.

## Docker Compose (production, Raspberry Pi 5)

- `docker-compose.prod.yml` + `Dockerfile.prod` run the same app + Planner + Ollama stack unattended, built from source on the target device — see the README's "Production deployment (Raspberry Pi 5)" section for usage.
- `Dockerfile.prod` is a multi-stage build producing a Next.js standalone server (`next.config.ts`'s `output: "standalone"`); it builds for whatever architecture Docker reports, so the same file works for `arm64` (the Pi) and `amd64` (local verification).
- Both services run with `restart: unless-stopped`; `ollama` additionally sets `mem_limit` sized for the Pi 5's memory (see the comment in `docker-compose.prod.yml` when targeting a 4GB/16GB variant instead of the assumed 8GB).

## Agent skills

### Issue tracker

Issues live in GitHub Issues (github.com/alundgren/life), using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Implementing a `ready-for-agent` ticket

Plain step-by-step flow for taking a `ready-for-agent` issue to a PR — see `docs/agents/implement.md`.
