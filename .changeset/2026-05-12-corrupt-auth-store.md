---
"opencode-supabase": patch
---

Recover corrupt Supabase auth store instead of crashing. Invalid or unsupported store files are backed up, reset to a valid notice state, and surfaced through the `/supabase` dialog and tool errors.
