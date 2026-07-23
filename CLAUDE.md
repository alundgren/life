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
```

`pnpm test` will join this gate once a test suite exists (tracked in [#14](https://github.com/alundgren/life/issues/14)).

## Agent skills

### Issue tracker

Issues live in GitHub Issues (github.com/alundgren/life), using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
