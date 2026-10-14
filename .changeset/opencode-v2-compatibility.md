---
"opencode-supabase": minor
---

Add OpenCode 2.0.27 support while preserving OpenCode 1.17.4+ compatibility. Both server and TUI entrypoints expose the appropriate host hook. V2 uses native integration credentials for the host's active account, account-specific refresh and disconnect, and scoped OAuth cleanup; existing V1 local credentials require a new login on V2. Keep real Zod tool schemas for both hosts, register bundled skills, and port `/supabase` with browser authorization and onboarding. The connected V2 dialog uses OpenCode's native selection component for plugin-defined Continue/Disconnect actions; advanced account management stays in V2's native `/connect` integration UI. Add V2 packed-TUI CI coverage and prune V2's npm cache before uploading diagnostics.

Builds on Rafael Santos's (@rafaelsnv) initial V2 migration in PR #79.
