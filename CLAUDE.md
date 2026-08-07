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

**`pnpm test:integration` is run by the developer only — agents must never run it.** Its tests drive a real Ollama instance and additionally self-skip unless `RUN_OLLAMA_INTEGRATION_TESTS` is set.

## Pull requests

- Keep the description short and to the point.
- If the PR closes a GitHub issue, link it (e.g. `Closes #123`).

## Data layer

- SQLite via a `better-sqlite3` singleton (`src/lib/db/client.ts`), WAL mode and foreign keys on. Tests inject an in-memory db via `setDb()`/`resetDb()` instead of going through the real env-backed singleton.
- Use named SQLite parameters (for example, `:taskId`) when a query has parameters, unless SQLite requires another form.
- Migrations are numbered SQL files under `migrations/` (starting with `0001_initial_schema.sql`), applied in order by `src/lib/db/migrate.ts` and tracked in a `schema_migrations` table so a file is never re-applied. Once deployed, migrations are append-only — never edit one after it has merged; add a new one instead.
- Required environment variables are validated at process start (`src/lib/env.ts`, invoked from `src/instrumentation.ts` alongside the migration run) so misconfiguration fails fast at boot, not on first request. See `.env.example` for the full list.
- Domain entities get one typed data-access module per entity under `src/lib/db/` (e.g. `task.ts`, `correction.ts`) — camelCase TS types over snake_case columns; application code reads and writes through these modules rather than raw SQL. A 1:1 parent/child split (e.g. `task` + its `task_scheduled`/`task_flexible` kind table) is written through a single transactional create function per kind so a parent row is never left without its child row.

## Planner & Ollama

- The Planner (`src/lib/planner/planner.ts`) starts automatically at boot from `src/instrumentation.ts`, right after migrations run. `startPlanner()` / `stopPlanner()` control its lifecycle; `getPlannerStatus()` reports whether it's running and its last recorded run.
- The Planner talks to Ollama only through the single client wrapper `src/lib/ollama/client.ts` (`callOllama`) — no other code calls Ollama directly.
- Each Planner run first attempts Correction extraction and Completion compaction — both run unconditionally and call Ollama whenever there's unprocessed data — then generates the current week's Weekly Plan if that week has none yet: it prompts Ollama for JSON, drops entries naming an unknown Task or a date outside the week, and writes the plan and its Planned Activities in one transaction. A week that is already planned skips only this plan-generation/revision call — extraction and compaction above still run and may call Ollama regardless.
- A Planner run is recorded in the `planner_run` table (`ran_at`/`status`/`result`, `result` summarising what the run did) only when it had real effect — a Correction applied, Completions compacted, or plan generation/revision did more than its no-op early-return. Every other tick, including one skipped because a previous run is still in-flight, only advances a separate `lastCheckedAt` heartbeat. `planner_run` is capped at 500 rows, trimmed on insert, so a persistent Ollama outage (which makes every tick error, and error is effect) can't grow it unbounded. Both are surfaced through the placeholder API/page. See ADR 0005.

## Node version

One version everywhere: `.nvmrc` (24.19.0) is the source of truth, CI reads it via `node-version-file`, and both Dockerfiles pin the `node:24-trixie-slim` image that ships it. Two constraints make this exact rather than a floating range — `better-sqlite3` needs Node-API v10 (Node 22.14+, so Node 22.13 cannot load it at all), and its prebuilt binaries need GLIBC 2.38, which Debian bookworm (2.36) does not have and trixie (2.41) does. Bump all three files together.

## Docker Compose (local dev)

- `docker-compose.yml` runs the app alongside a real Ollama container so the Planner exercises the actual Ollama path. See the README's "Local development (with Docker Compose)" section for usage.
- The `ollama` service (`docker/ollama/`) pulls `OLLAMA_MODEL` on its own startup via a custom entrypoint and only reports healthy once the pull finishes; the `app` service depends on that health check so it never starts against a model-less Ollama.
- SQLite data and the pulled Ollama model each live in their own named volume (`sqlite-data`, `ollama-data`) so both survive `docker compose down` / `up`.

## Production deployment (Raspberry Pi 5)

- Piploy builds `Dockerfile.prod` from the repository's protected `main` branch and manages Life as one container; production does not use Docker Compose.
- `Dockerfile.prod` is a multi-stage build producing a Next.js standalone server (`next.config.ts`'s `output: "standalone"`); it builds for whatever architecture Docker reports, so the same file works for `arm64` (the Pi) and `amd64` (local verification).
- SQLite lives in a Piploy-managed bind volume mounted at `/app/data`, so it survives container replacement.
- Piploy refuses to build a Dockerfile whose external `FROM`/`COPY --from` references are not pinned to a SHA-256 digest of a Docker Official Image (Piploy ADR 0004), so both Dockerfiles pin `node:24-trixie-slim` by its multi-arch manifest digest. Piploy never advances a digest itself — bump it in a reviewed commit, together with `.nvmrc`.
- Ollama runs directly on the Pi under systemd and is reached through the Docker bridge. Installing the model, ordering the service after Docker, and configuring its restart and resource limits are host responsibilities.
- `docker-compose.yml` remains the supported complete app + Ollama stack for local development.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (github.com/alundgren/life), using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Implementing a `ready-for-agent` ticket

Plain step-by-step flow for taking a `ready-for-agent` issue to a PR — see `docs/agents/implement.md`.
