# Agent Notes

## Caveman

Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.
Code/commits/PRs: normal. Off: "stop caveman" / "normal mode".

## External References

For Supabase Management API work, prefer the markdownized docs:

- https://supabase.com/docs/reference/api/introduction.md

Use this reference when implementing or reviewing authenticated Supabase API tools.

## Test Commands

Never run raw `bun test` for repository verification. Always use package scripts so required preloads run.

- Use `bun run test` for all test suites.
- Use `bun run test <test-file>` for focused tests.
- Do not use `bun test <test-file>` directly. It skips `@opentui/solid/preload` and can produce false `jsxDEV` / `jsx-runtime.d.ts` failures for TUI/TSX tests.
- When comparing with CI, mirror `.github/workflows/ci.yml`: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run verify:pack`.

## Bundled Supabase Skills

`skills/` contains real vendored files synced from `supabase/agent-skills` at a pinned commit.

- Do not replace `skills/` with a symlink or submodule.
- Do not fetch skills during plugin startup, normal build, or release artifact generation.
- Use `bun run skills:sync` to update vendored skills from the latest upstream default branch.
- Use `bun run skills:sync <commit-sha-or-ref>` to sync a specific upstream ref.
- Review skill diffs and `skills/.upstream.json` before release.
