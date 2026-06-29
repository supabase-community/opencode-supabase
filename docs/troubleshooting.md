# Troubleshooting

Use this when `/supabase`, Supabase tools, or Supabase MCP setup fails.

## Capture Logs

If you hit auth or tool errors and need logs for an issue, collect the newest OpenCode session log from its default log directory:

- macOS/Linux: `~/.local/share/opencode/log/`
- Windows: `%USERPROFILE%\.local\share\opencode\log`

Run OpenCode with debug logging enabled while reproducing the problem:

```bash
opencode --log-level DEBUG --print-logs
```

Share that newest session log file in the issue. In our testing, the session log file is more reliable than redirecting `stderr` with `2>` for capturing plugin activity.

## Supabase Is Not Connected

If a tool says `Supabase is not connected. Run /supabase first.`, run `/supabase` in the OpenCode TUI and complete browser auth.

If `/supabase` says you are already connected but tools still fail, disconnect from the `/supabase` dialog, connect again, then retry the tool.

## Auth Store Was Reset

If OpenCode says the local Supabase auth file was corrupted, the plugin backed up the corrupt file and reset auth. Run `/supabase` again, then retry the tool.

## Browser Did Not Open

The `/supabase` dialog shows the auth URL while it waits. Copy that URL into your browser manually.

## Callback Ports Busy

The plugin listens on one of these local callback URLs during auth:

- `http://localhost:14589/auth/callback`
- `http://localhost:14590/auth/callback`
- `http://localhost:14591/auth/callback`

If all ports are busy, close other OpenCode sessions and retry `/supabase`.

## MCP Tools Missing

After adding the Supabase Studio MCP config, OpenCode must reload config and authenticate the MCP server:

1. Close OpenCode or exit the current session.
2. Run `opencode mcp auth supabase`.
3. Complete OAuth in the browser.
4. Start OpenCode again.

If MCP works after only restarting, auth was likely cached from an earlier setup.
