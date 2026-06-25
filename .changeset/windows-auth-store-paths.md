---
"opencode-supabase": patch
---

Fix Supabase auth store path resolution for Windows drive-letter, UNC, and extended-length paths so credentials are written to the correct project worktree root instead of mixing separators or falling back unexpectedly.
