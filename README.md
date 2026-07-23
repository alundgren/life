# Life — Recurring Task Planner

See [CONTEXT.md](CONTEXT.md) for the domain glossary and `docs/adr/` for architectural decisions.

## Prerequisites

- Node.js >= 22.13.0
- pnpm >= 11.1.2 (`corepack enable` will provide the version pinned in `package.json`)

## Local development (without Docker)

```bash
pnpm install
pnpm dev
```

The app is available at [http://localhost:3000](http://localhost:3000).

## Verification

```bash
pnpm build
pnpm lint
```

Both must exit `0` before pushing.
