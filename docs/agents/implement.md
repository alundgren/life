# Implementing a `ready-for-agent` ticket

Plain steps for taking a single `ready-for-agent` issue to a merged PR. No tool-specific plugin or slash command is required — follow this file directly.

1. **Pick the ticket.** `gh issue view <number> --comments` to read the full spec, including any clarifying discussion in the comments.
2. **Branch.** Pull the latest `origin/main`, then create a branch named after the issue (e.g. `<agent>/issue-<number>-<slug>`).
3. **Implement.** Follow the conventions in `AGENTS.md` (data layer, Planner/Ollama, Docker Compose, etc.) and the domain vocabulary in `CONTEXT.md` / `docs/adr/`. Keep the change scoped to what the ticket asks for — see "How to work" in `AGENTS.md`.
4. **Verify.** Run the verification gate from `AGENTS.md` (`pnpm build`, `pnpm lint`, `pnpm test`) and fix any failures before moving on.
5. **Commit** with a clear, descriptive message.
6. **Push and open a PR** (`gh pr create`), following the "Pull requests" conventions in `AGENTS.md`. Link the issue with `Closes #<number>` so it closes automatically on merge.
