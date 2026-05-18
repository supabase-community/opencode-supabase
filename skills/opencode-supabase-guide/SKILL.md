---
name: opencode-supabase-guide
description: Use when users ask to set up Supabase MCP in OpenCode, paste Supabase Studio MCP config, or need MCP tools connected.
---

# OpenCode Supabase Guide

## Question Tool Rule

Every interactive choice MUST use `question` tool. Never assume, never auto-pick. This includes:

- Selecting a project when multiple exist — list options with name + ref in the question.
- Confirming before opening browser — include project name + ref in the question.
- Choosing whether to apply Studio config to the repo.
- Any yes/no or selection prompt.

No prose "ask" — always `question` tool invocation.

## Overview

Supabase MCP adds project-scoped Supabase tools to OpenCode. Before MCP setup, tell user to run `/supabase` to connect their account — plugin tools (list projects, create project) need OAuth. MCP config comes from Studio prompt, not rebuilt from code.

## MCP Setup Flow

1. Resolve project with `supabase_list_projects`. If auth fails, tell user: "Run `/supabase` to connect your Supabase account." If multiple projects, use `question` tool listing name + ref for each.
2. Use `question` tool to confirm: "Open Supabase MCP Connect for `<name>` (`<ref>`)?"
3. Call `supabase_open_mcp_setup`. Always print returned URL in output.
4. Tell user to paste Studio prompt/config back for wiring into `opencode.json`.

## Studio Prompt Handling

Extract MCP JSON from Studio prompt. Strip line numbers (`1{`). Preserve URLs exactly — never rebuild from `project_ref`. MCP server key usually `supabase`; auth: `opencode mcp auth supabase`. Skip `npx skills add supabase/agent-skills` — already bundled.

## Config Rules

Prefer repo-root `opencode.json` (or `.jsonc`). Global (`~/.config/opencode/opencode.json`) only on explicit request. Use `question` tool before editing. Remind to restart OpenCode.

## Common Mistakes

| Mistake                                 | Fix                                      |
| --------------------------------------- | ---------------------------------------- |
| Rebuilding/normalizing Studio URLs      | Preserve pasted URLs exactly             |
| Omitting setup URL from output          | Always print exact returned URL          |
| Installing separate Agent Skills        | Already bundled in this plugin           |
| Writing global config by default        | Prefer repo-root `opencode.json`            |
| Choosing MCP features for user          | Studio decides read-only, feature groups |
| Calling MCP setup while unauthenticated | Tell user to run `/supabase` first         |
| Asking user without `question` tool     | Always use `question` tool for confirmations, project selection, any interactive choice |

## Troubleshooting

MCP tools missing after config? Restart OpenCode, run `opencode mcp auth supabase`.
