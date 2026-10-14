# opencode-supabase

Connect OpenCode to Supabase: account login, Management API tools, bundled Supabase agent skills, and guided Supabase MCP setup.

![opencode-supabase screenshot](assets/screenshot.png)

## Quickstart

Supports OpenCode 1 (`>= 1.17.4`) and OpenCode 2 (`>= 2.0.27`).

OpenCode 1:

```bash
opencode plugin opencode-supabase
```

OpenCode 2:

```bash
opencode plugin add opencode-supabase
```

Both versions use `/supabase`. The V2 connected dialog uses OpenCode 2's native
selection component and offers **Continue with current account** or
**Disconnect current account**. These actions are plugin-defined; V1 keeps its
existing dialog.

OpenCode 2 stores credentials in its native integration system. Unlike V1's
provider-focused `/connect`, V2's `/connect` also manages service integrations,
including Supabase: add, switch, rename, or remove saved accounts there.
The active Supabase account is shared by projects using the same OpenCode profile,
not bound to a repository. Disconnect removes only the current saved credential
and does not revoke access at Supabase; if another account is saved, OpenCode
makes it active. Existing V1 local credentials are not imported automatically;
reconnect when moving to V2.

Open `opencode` in your project, then run:

```text
/supabase
```

Approve Supabase in your browser. Back in OpenCode, start simple:

```text
List my Supabase projects
```

From there you can ask OpenCode to list organizations, list regions, create projects, or connect a project to Supabase MCP.

## Supabase MCP

MCP is optional. Use it when you want project-scoped database, docs, advisor, and management tools inside OpenCode.

After `/supabase`, ask:

```text
Connect this project to Supabase MCP
```

OpenCode opens Supabase Studio so you can choose permissions and MCP parameters. Copy the generated OpenCode prompt from Studio.

Then switch OpenCode to Build mode and paste that prompt into OpenCode. The plugin knows how to handle the Studio prompt and guide the config update.

After config is added:

1. Close OpenCode or exit the current session.
2. Run `opencode mcp auth supabase`.
3. Complete OAuth in the browser.
4. Start OpenCode again.

## Bundled Skills 🧰

Installed by default:

- `supabase`
- `supabase-postgres-best-practices`
- `opencode-supabase-guide`

No separate skills setup is needed.

## Need More?

- [Configuration options](docs/configuration.md)
- [Troubleshooting login and MCP setup](docs/troubleshooting.md)
- [Development and testing](docs/development.md)
- [Release process](docs/releasing.md)

## Reference

- Supabase Management API: https://supabase.com/docs/reference/api/introduction
