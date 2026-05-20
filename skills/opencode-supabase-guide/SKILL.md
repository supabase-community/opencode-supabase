---
name: opencode-supabase-guide
description: Use when users ask to set up Supabase MCP in OpenCode, paste Supabase Studio MCP config, or need MCP tools connected.
---

# OpenCode Supabase Guide

## Question Tool Rule

Every interactive choice MUST use `question` tool. Never assume, never auto-pick. This includes:

- Selecting a project when multiple exist -- list options with name + ref in the question.
- Confirming before opening browser -- include project name + ref in the question.
- Choosing whether to apply Studio config to the repo.
- Any yes/no or selection prompt.

No prose "ask" -- always `question` tool invocation.

Question tool rules:

- Do not add `Other`, `Something else`, `Type your own answer`, or catch-all options.
- OpenCode adds `Type your own answer` automatically.
- Put the recommended option first and include `(Recommended)` in the label.
- Keep labels short and put explanatory text in `description`.

## Overview

List projects first. Do not lead with MCP setup immediately after `/supabase` auth.

Supabase MCP adds project-scoped Supabase tools to OpenCode. Before MCP setup, tell user to run `/supabase` to connect their account -- plugin tools (list projects, create project) need OAuth. MCP config comes from Studio prompt, not rebuilt from code.

## MCP Setup Flow

1. If user has not chosen a project, call `supabase_list_projects`.
2. If multiple projects exist, use the Question tool to choose one.
3. After a project is selected, offer to connect that project to Supabase MCP.
4. If user confirms, call `supabase_open_mcp_setup`.
5. Tell user to paste the Studio prompt or OpenCode config snippet back here.
6. After config is added, tell user to restart OpenCode, then run `opencode mcp auth supabase` and complete OAuth in the browser.

Use this Question tool shape before opening Studio:

```json
{
  "questions": [
    {
      "header": "Connect Supabase",
      "question": "Connect opencode-tester to Supabase MCP?",
      "multiple": false,
      "options": [
        {
          "label": "Open browser (Recommended)",
          "description": "Open Supabase Studio to choose permissions and copy config"
        },
        {
          "label": "Skip setup",
          "description": "Do not connect Supabase MCP now"
        }
      ]
    }
  ]
}
```

Replace `opencode-tester` with the selected project name.

## Required Phrases

Use explicit wording. Do not improvise around auth/setup state.

After `/supabase` auth succeeds:

Say this:

```text
Ask me to list your Supabase projects first.
Then pick a project and ask me to connect it to MCP.
```

Do not say:

```text
Set up Supabase MCP for my project.
```

After project selection:

Say this:

```text
Connect this project to Supabase MCP?
```

Do not say:

```text
I will set up MCP now.
```

After Studio config is pasted or applied:

Say this:

```text
Restart OpenCode, then run `opencode mcp auth supabase`.
Complete OAuth in the browser.
```

Do not say:

```text
OAuth will prompt automatically.
Run auth if it does not work.
```

If config already exists:

Say this:

```text
Supabase MCP config already exists for this workspace. No file changes needed.
Restart OpenCode, then run `opencode mcp auth supabase`.
```

Do not say:

```text
Already wired.
```

If user says MCP works after only restarting:

Say this:

```text
MCP auth may already be cached from an earlier setup.
Restarting loaded the config; cached auth let the MCP server work without a new browser auth step.
```

## OpenCode Auth

OpenCode does not automatically start OAuth after config is added. After adding MCP config, tell the user:

```text
Restart OpenCode, then run:
opencode mcp auth supabase

Complete OAuth in the browser.
```

## Studio Prompt Handling

Extract MCP JSON from Studio prompt. Strip line numbers (`1{`). Preserve URLs exactly -- never rebuild from `project_ref`. MCP server key usually `supabase`; auth: `opencode mcp auth supabase`. Skip `npx skills add supabase/agent-skills` -- already bundled.

## Config Rules

Prefer `.opencode/opencode.json` (or `.opencode/opencode.jsonc`). Global (`~/.config/opencode/opencode.json`) only on explicit request. Use `question` tool before editing. Remind to restart OpenCode.

If the Studio config is already present in `.opencode/opencode.json` or `.opencode/opencode.jsonc`, say:

```text
Supabase MCP config already exists for this workspace. No file changes needed.

Restart OpenCode, then run:
opencode mcp auth supabase

Complete OAuth in the browser.
```

Do not say `already wired` without explaining the restart and auth steps.

## Common Mistakes

| Mistake                                 | Fix                                      |
| --------------------------------------- | ---------------------------------------- |
| Rebuilding/normalizing Studio URLs      | Preserve pasted URLs exactly             |
| Omitting setup URL from output          | Always print exact returned URL          |
| Installing separate Agent Skills        | Already bundled in this plugin           |
| Writing global config by default        | Prefer `.opencode/opencode.json`            |
| Choosing MCP features for user          | Studio decides read-only, feature groups |
| Calling MCP setup while unauthenticated | Tell user to run `/supabase` first         |
| Asking user without `question` tool     | Always use `question` tool for confirmations, project selection, any interactive choice |
| Saying OAuth happens automatically      | OpenCode detects `needs_auth` but does not auto-start browser OAuth; user must run `opencode mcp auth supabase` |

## Troubleshooting

MCP tools missing after config? Say: `Restart OpenCode, then run opencode mcp auth supabase.`
