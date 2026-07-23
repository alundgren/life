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

`pnpm test` runs the service-free unit suite (`vitest.config.ts`) — no real SQLite file, Docker, or Ollama instance required. `pnpm test:integration` (`vitest.integration.config.ts`) is a separate, currently-empty suite for future tests that need real services; it is not part of the gate.

## Pull requests

- Never include a link to the Claude session that created the PR.
- Keep the description short and to the point.
- If the PR closes a GitHub issue, link it (e.g. `Closes #123`).

## Data layer

- SQLite via a `better-sqlite3` singleton (`src/lib/db/client.ts`), WAL mode and foreign keys on. Tests inject an in-memory db via `setDb()`/`resetDb()` instead of going through the real env-backed singleton.
- Migrations are numbered SQL files under `migrations/` (e.g. `0001_create_placeholder_message.sql`), applied in order by `src/lib/db/migrate.ts` and tracked in a `schema_migrations` table so a file is never re-applied. Migrations are append-only — never edit one after it has merged; add a new one instead.
- Required environment variables are validated at process start (`src/lib/env.ts`, invoked from `src/instrumentation.ts` alongside the migration run) so misconfiguration fails fast at boot, not on first request. See `.env.example` for the full list.

## Planner & Ollama

- The Planner (`src/lib/planner/planner.ts`) starts automatically at boot from `src/instrumentation.ts`, right after migrations run. `startPlanner()` / `stopPlanner()` control its lifecycle; `getPlannerStatus()` reports whether it's running and its last recorded run.
- The Planner talks to Ollama only through the single client wrapper `src/lib/ollama/client.ts` (`callOllama`) — no other code calls Ollama directly.
- Each Planner run is recorded as a heartbeat row in the `planner_run` table (`ran_at`/`status`/`result`) and surfaced through the placeholder API/page.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (github.com/alundgren/life), using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
