# opencode-supabase

Connect OpenCode to Supabase: account login, Management API tools, bundled Supabase agent skills, and guided Supabase MCP setup.

## Quickstart

Requires OpenCode `>= 1.3.4`.

```bash
opencode plugin opencode-supabase
```

Open `opencode` in your project, then run:

```text
/supabase
```

Approve Supabase in your browser. Back in OpenCode, start simple:

```text
List my Supabase projects
```

From there you can ask OpenCode to list organizations, list regions, get project API keys, create projects, or connect a project to Supabase MCP.

## Supabase MCP

MCP is optional. Use it when you want project-scoped database, docs, advisor, and management tools inside OpenCode.

After `/supabase`, ask:

```text
Connect this project to Supabase MCP
```

OpenCode opens Supabase Studio so you can choose permissions and copy the generated OpenCode config.

After adding that config:

1. Close OpenCode or exit the current session.
2. Run `opencode mcp auth supabase`.
3. Complete OAuth in the browser.
4. Start OpenCode again.

Skip any `install Supabase Agent Skills` step in Studio. This plugin already bundles the Supabase skills.

## Bundled Skills 🧰

Installed by default:

- `supabase`
- `supabase-postgres-best-practices`
- `opencode-supabase-guide`

No separate skills setup is needed.

## Need More?

- Configuration: https://github.com/supabase-community/opencode-supabase/blob/main/docs/configuration.md
- Troubleshooting: https://github.com/supabase-community/opencode-supabase/blob/main/docs/troubleshooting.md
- Development: https://github.com/supabase-community/opencode-supabase/blob/main/docs/development.md
- Releases: https://github.com/supabase-community/opencode-supabase/blob/main/docs/releasing.md

## Reference

- Supabase Management API: https://supabase.com/docs/reference/api/introduction
