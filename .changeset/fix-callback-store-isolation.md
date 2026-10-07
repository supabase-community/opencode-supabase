---
"opencode-supabase": patch
---

Fix the OAuth callback writing tokens to the wrong local auth store (#32). Persist tokens against the per-flow pending auth entry (keyed by state) instead of the singleton callback server's first-call input, so concurrent flows for different directories no longer cross-write each other's store.
