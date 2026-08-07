# Life — Recurring Task Planner

See [CONTEXT.md](CONTEXT.md) for the domain glossary and `docs/adr/` for architectural decisions.

## Prerequisites

- Node.js >= 24.0.0 — `.nvmrc` pins the exact version (24.19.0) that CI and both Dockerfiles use
- pnpm >= 11.1.2 (`corepack enable` will provide the version pinned in `package.json`)

Use the version in `.nvmrc`. It is exact, not a floor, because `better-sqlite3` needs Node-API v10 (Node 22.14+) and its prebuilt binaries need GLIBC 2.38 — which is why both Dockerfiles are on Debian trixie rather than bookworm. When bumping Node, update `.nvmrc`, `Dockerfile`, and `Dockerfile.prod` (including their pinned base-image digests) in the same change.

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
- Ollama is published on `127.0.0.1:11434` so host-run tooling (see "Integration suite" below) can reach it. It is bound to loopback deliberately — Docker's published ports bypass the host firewall, and Ollama is unauthenticated.

## Production deployment (Raspberry Pi 5)

Production on the Pi does not use Docker Compose. [Piploy](https://github.com/alundgren/Irudd.Piploy) builds `Dockerfile.prod` from the repository's protected `main` branch and manages the single Life container. SQLite lives in a Piploy-managed bind volume so container replacement does not replace the database.

Ollama runs directly on the Pi as a systemd service rather than in the Life application. It is bound to the Docker bridge for the Life container to reach it, and its model, restart, and resource configuration are host responsibilities.

The dependency-ordered provisioning and rollout work is tracked in [issue #64](https://github.com/alundgren/life/issues/64). The Docker Compose workflow above remains the supported way to run the complete stack for local development.

## Environment variables

See `.env.example` for the full list. The app fails fast at startup with a clear error if a required variable is missing.

## Database migrations

SQL migration files live in `migrations/`, numbered and applied in order (starting with `0001_initial_schema.sql`). Applied filenames are tracked in a `schema_migrations` table so a migration is never re-applied. Once deployed, migrations are append-only — never edit a migration after it has merged; add a new one instead.

## Verification

```bash
pnpm build
pnpm lint
pnpm test
```

All three must exit `0` before pushing. `pnpm test` runs the service-free unit suite only — no real SQLite file, Docker, or Ollama instance required.

GitHub Actions runs the same commands for every pull request and each push to `main`. The checks to require in branch protection are `CI / Build`, `CI / Lint`, and `CI / Test`.

### Integration suite (developer only)

`pnpm test:integration` is a separate suite for tests that need real services — currently the Planner's weekly-plan generation against a real Ollama. It is deliberately **not** part of the verification gate above, and agents must never run it.

```bash
RUN_OLLAMA_INTEGRATION_TESTS=1 pnpm test:integration
```

- Without `RUN_OLLAMA_INTEGRATION_TESTS` every test self-skips, so a stray run passes trivially instead of hanging. Output reading `1 skipped` means the opt-in never reached the process.
- **Vitest does not read `.env`.** The suite falls back to `http://localhost:11434` and `qwen2.5:3b`; pass `OLLAMA_HOST` / `OLLAMA_MODEL` on the command line if yours differ.
- Ollama must be reachable from the host with the model already pulled. `docker compose up` covers both — the `ollama` service publishes `127.0.0.1:11434`, and pulls `OLLAMA_MODEL` before reporting healthy. Running `ollama serve` natively works too.
- `curl http://localhost:11434/api/tags` is the quickest check: it lists the pulled models, and a connection error there means the suite will fail the same way.
- A cold model load can be slow, so the first call may approach the Ollama client's 180-second deadline; the `curl` above warms it.
- `Ollama returned no usable Planned Activities …` means Ollama answered but the model's JSON didn't survive validation — that is a finding about the model, not a setup failure.
