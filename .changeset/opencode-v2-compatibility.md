---
"opencode-supabase": minor
---

Add OpenCode 2.0.27 support while preserving OpenCode 1.17.4+ compatibility. Both server and TUI entrypoints expose the appropriate host hook. V2 uses native integration credentials for active-account selection, account-specific refresh and disconnect, and scoped OAuth cleanup; existing V1 local credentials require a new login on V2. Keep real Zod tool schemas for both hosts, register bundled skills, and port `/supabase` with browser authorization, account management and onboarding. Add V2 packed-TUI CI coverage and prune V2's npm cache before uploading diagnostics.

Builds on Rafael Santos's (@rafaelsnv) initial V2 migration in PR #79.
