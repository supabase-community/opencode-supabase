# MCP Onboarding Default Path Design

## Goal

Help OpenCode users connect the Supabase MCP server for a selected project through the existing Supabase Studio Connect Sheet.

The default path uses Studio's current deep-link support:

```text
https://supabase.com/dashboard/project/<project-ref>?showConnect=true&connectTab=mcp&mcpClient=opencode
```

The feature should explain what the Supabase MCP server does, guide the user through the Connect page, and recommend read-only setup as a manual choice until Studio supports a read-only deep-link parameter.

## Non-Goals

- Do not build or host a Supabase MCP server inside the plugin.
- Do not edit OpenCode MCP configuration automatically.
- Do not depend on Studio support for `mcpReadOnly=true`.
- Do not change upstream-owned vendored skills from `supabase/agent-skills`.
- Do not add slash command injection, prompt injection, or chat-message automation for this MVP.

## User Experience

After Supabase login/onboarding, the plugin should mention MCP as an optional next step:

```text
You can also ask me to set up Supabase MCP for a project to unlock project-scoped database, docs, and advisor tools.
```

When the user asks to set up or learn about Supabase MCP:

1. The agent explains briefly what the Supabase MCP server does.
2. If the target project is unclear, the agent uses existing organization/project tools and asks the user which project to use.
3. The agent calls the MCP setup tool with the selected project ref.
4. The tool opens Studio to the Connect Sheet with the MCP tab and OpenCode client selected.
5. The agent guides the user through the visible Studio steps.

The agent should tell the user to keep Read-only enabled unless they explicitly need writes, migrations, or admin actions. Read-only is a recommendation for first setup, not an enforced plugin policy.

## Plugin Skill

Add a plugin-owned skill:

```text
skills/supabase-opencode/SKILL.md
```

This skill is local to this repository. It is separate from `skills/supabase` and `skills/supabase-postgres-best-practices`, which are vendored from `supabase/agent-skills`.

The skill should teach the agent that:

- Supabase MCP gives OpenCode project-scoped Supabase tools after the user connects it in OpenCode.
- MCP complements this plugin's Management API tools.
- Plugin tools are useful for account-level tasks like login, listing organizations, listing projects, creating projects, and opening setup pages.
- MCP is useful for richer project-level workflows such as database inspection, docs, advisors, and other MCP-exposed capabilities.
- Read-only should be recommended for first setup unless the user explicitly needs writes or admin actions.
- `supabase_open_mcp_setup` should be used when the user asks to set up, connect, configure, or use Supabase MCP.
- If the project is ambiguous, the agent should list projects and ask which project to connect.
- If the user asks what MCP is, the agent should explain before opening Studio.

Register `supabase-opencode` as a bundled skill by adding it to the plugin skill registry. Keep the upstream skill sync script unchanged so it continues to manage only upstream-owned skill directories.

## Tool Contract

Add a server tool:

```text
supabase_open_mcp_setup
```

Input:

```ts
{
  project_ref: string
}
```

Behavior:

- Require Supabase authentication using the same auth guard pattern as existing Supabase tools.
- Build the Studio URL with the provided project ref:

```text
https://supabase.com/dashboard/project/<project_ref>?showConnect=true&connectTab=mcp&mcpClient=opencode
```

- Open the URL in the user's browser using the existing browser-opening dependency.
- Return concise setup guidance for the agent to show the user.

Recommended result text:

```text
Opened Supabase MCP setup for project <project_ref> in Studio.

On the Connect page:
1. Confirm MCP tab and OpenCode client are selected.
2. Turn on Read-only unless you need write/admin actions.
3. Add the generated OpenCode config.
4. Run any auth command Studio shows, then reload OpenCode if needed.
```

## Read-Only Follow-Up

Create a non-blocking plugin issue:

```text
Use Studio MCP read-only deep link when available
```

The issue should track future Studio support for a parameter such as:

```text
mcpReadOnly=true
```

This is not required for the default-path MVP. Once Studio supports a read-only deep link, update the tool URL to include it.

## Documentation

Update `README.md` to include:

- MCP onboarding as a supported workflow.
- Example prompt: `Set up Supabase MCP for my project`.
- Short distinction between plugin tools and MCP tools.
- Read-only recommendation for first setup.

The docs should not promise automatic config editing or read-only-by-default behavior until those capabilities exist.

## Testing

Add or update tests for:

- `resolveEnabledSupabaseSkills` includes `supabase-opencode` by default.
- `registerSupabaseSkillPaths` registers the new skill path and preserves existing paths.
- The server config hook includes the new skill path.
- Tool registration includes `supabase_open_mcp_setup`.
- The tool builds the expected Studio URL.
- The tool requires Supabase auth consistently with other Supabase tools.
- The tool result includes Read-only guidance.

Use repository package scripts for verification. Do not run raw `bun test`; use `bun run test` or `bun run test <test-file>`.

## Acceptance Criteria

- User can ask OpenCode to set up Supabase MCP.
- Agent can explain what the Supabase MCP server does.
- Agent can guide the user through the Studio Connect Sheet.
- Browser opens the deterministic Studio MCP/OpenCode URL for the selected project.
- Plugin-owned skill is bundled and enabled by default.
- Upstream vendored skills remain untouched.
- The release does not depend on Studio read-only URL support.
- Tests cover skill registration, tool URL generation, auth requirement, and returned guidance.
