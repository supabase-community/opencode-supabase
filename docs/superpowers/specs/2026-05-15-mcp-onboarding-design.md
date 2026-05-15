# MCP Onboarding Default Path Design

## Goal

Help OpenCode users connect the Supabase MCP server for a selected project through the existing Supabase Studio Connect Sheet.

The default path uses Studio's current deep-link support:

```text
https://supabase.com/dashboard/project/<project-ref>?showConnect=true&connectTab=mcp&mcpClient=opencode
```

The feature should explain what the Supabase MCP server does, confirm the target project before opening a browser, guide the user through the Connect page, and ask the user to paste the Studio prompt or OpenCode config snippet back if they want help applying it.

## Non-Goals

- Do not build or host a Supabase MCP server inside the plugin.
- Do not edit OpenCode MCP configuration automatically.
- Do not depend on Studio support for `mcpReadOnly=true`.
- Do not choose MCP feature groups or permissions on the user's behalf.
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
3. The agent confirms before opening a browser: `Open Supabase MCP Connect page for <project name> (<project-ref>)?`
4. After explicit user confirmation, the agent calls the MCP setup tool with the selected project ref.
5. The tool opens Studio to the Connect Sheet with the MCP tab and OpenCode client selected.
6. The agent guides the user through the visible Studio steps.
7. The agent tells the user to paste the Studio prompt or OpenCode config snippet back into chat if they want help applying it to this repository.

The agent should not give a hard-coded read-only recommendation until product feedback confirms the desired default. It should tell the user to choose feature groups and permissions in Studio based on their needs.

If the user pastes the Studio prompt or config snippet back into chat and asks for help applying it, the agent should adapt the MCP config for project-local OpenCode setup in `opencode.json` unless the user explicitly wants global setup. The agent should skip any Studio instruction to install Supabase Agent Skills because this plugin already bundles them.

## Plugin Skill

Add a plugin-owned skill:

```text
skills/opencode-supabase-guide/SKILL.md
```

This skill is local to this repository. It is separate from `skills/supabase` and `skills/supabase-postgres-best-practices`, which are vendored from `supabase/agent-skills`.

The skill should teach the agent that:

- Supabase MCP gives OpenCode project-scoped Supabase tools after the user connects it in OpenCode.
- MCP complements this plugin's Management API tools.
- Plugin tools are useful for account-level tasks like login, listing organizations, listing projects, creating projects, and opening setup pages.
- MCP is useful for richer project-level workflows such as database inspection, docs, advisors, and other MCP-exposed capabilities.
- Studio is the source of truth for MCP feature groups and permissions in the default flow.
- The agent should ask for confirmation before opening the browser for a selected project.
- `supabase_open_mcp_setup` should be used when the user asks to set up, connect, configure, or use Supabase MCP.
- If the project is ambiguous, the agent should list projects and ask which project to connect.
- If the user asks what MCP is, the agent should explain before opening Studio.
- After opening Studio, the agent should tell the user they can paste the Studio prompt or OpenCode config snippet back if they want help wiring it into this repo.
- If the user pastes Studio instructions, the agent should skip `npx skills add supabase/agent-skills` because this plugin already bundles Supabase skills.
- If the user asks for config editing, prefer project-local `opencode.json` in the repo root over global `~/.config/opencode/opencode.json`, unless the user explicitly wants a global MCP server.
- After config changes, the agent should tell the user to restart OpenCode and run `opencode mcp auth supabase` if OAuth is not prompted automatically.

Register `opencode-supabase-guide` as a bundled skill by adding it to the plugin skill registry. Keep the upstream skill sync script unchanged so it continues to manage only upstream-owned skill directories.

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
2. Choose the feature groups and permissions you want in Studio.
3. Follow the OpenCode config and auth steps shown by Studio.
4. If you want me to wire this into the current repo, paste the Studio prompt or OpenCode config snippet back here.
5. You can skip any "install Supabase Agent Skills" step because this plugin already bundles them.
6. Restart OpenCode after changing config; run `opencode mcp auth supabase` if OAuth is not prompted automatically.
```

## Permissions Follow-Up

Do not block this MVP on a plugin-owned read-only policy. Wait for product feedback on whether the plugin should recommend read-only, deep-link a read-only option, or leave permissions entirely to Studio copy.

If product feedback asks for read-only-by-default onboarding, create a non-blocking plugin issue:

```text
Use Studio MCP read-only deep link when available
```

The issue should track future Studio support for a parameter such as:

```text
mcpReadOnly=true
```

This is not required for the default-path MVP. Once Studio supports a read-only deep link and the product direction is confirmed, update the tool URL to include it.

## Documentation

Update `README.md` to include:

- MCP onboarding as a supported workflow.
- Example prompt: `Set up Supabase MCP for my project`.
- Short distinction between plugin tools and MCP tools.
- Note that Studio handles MCP feature groups and permissions.
- Note that users can paste the Studio prompt or OpenCode config snippet back into OpenCode if they want help adapting it for project-local `opencode.json`.
- Note that Supabase Agent Skills are already bundled with this plugin, so the user can skip separate Agent Skills installation if Studio shows it.
- Note that config changes may require restarting OpenCode and running `opencode mcp auth supabase`.

The docs should not promise automatic config editing or read-only-by-default behavior until those capabilities exist and product direction is confirmed.

## Testing

Add or update tests for:

- `resolveEnabledSupabaseSkills` includes `opencode-supabase-guide` by default.
- `registerSupabaseSkillPaths` registers the new skill path and preserves existing paths.
- The server config hook includes the new skill path.
- Tool registration includes `supabase_open_mcp_setup`.
- The tool builds the expected Studio URL.
- The tool requires Supabase auth consistently with other Supabase tools.
- The tool result includes paste-back guidance, bundled-skills guidance, and restart/auth guidance.

Use repository package scripts for verification. Do not run raw `bun test`; use `bun run test` or `bun run test <test-file>`.

## Acceptance Criteria

- User can ask OpenCode to set up Supabase MCP.
- Agent can explain what the Supabase MCP server does.
- Agent confirms the selected project before opening the browser.
- Agent can guide the user through the Studio Connect Sheet.
- Agent asks the user to paste the Studio prompt or OpenCode config snippet back if they want help applying it.
- Agent does not tell the user to install Supabase Agent Skills because this plugin already bundles them.
- Browser opens the deterministic Studio MCP/OpenCode URL for the selected project.
- Plugin-owned skill is bundled and enabled by default.
- Upstream vendored skills remain untouched.
- The release does not depend on Studio read-only URL support.
- Tests cover skill registration, tool URL generation, auth requirement, and returned guidance.
