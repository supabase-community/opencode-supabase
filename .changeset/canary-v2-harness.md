---
"opencode-supabase": patch
---

Make the packed-TUI e2e harness compatible with OpenCode V2 (`@opencode/cli`): register the plugin by writing project `.opencode/opencode.json` (V2 `plugin add` is an interactive wizard), use lowercase `--log-level debug`, and isolate the V2 managed `serve --service` daemon on its own port. V1 behavior unchanged.
