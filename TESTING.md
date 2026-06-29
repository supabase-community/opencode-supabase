# Testing

This file is kept as a short pointer for contributors. Current development and verification notes live in `docs/development.md`.

Use package scripts, not raw `bun test`, for repository verification:

```bash
bun run lint
bun run typecheck
bun run test
bun run verify:pack
```

Focused test example:

```bash
bun run test test/phase1-package-contract.test.ts
```

Manual smoke path:

1. Install plugin with `opencode plugin opencode-supabase`.
2. Open `opencode` in a test project.
3. Run `/supabase` and complete browser auth.
4. Ask `List my Supabase projects`.
5. Optional: ask OpenCode to connect one project to Supabase MCP.

Troubleshooting lives in `docs/troubleshooting.md`.
