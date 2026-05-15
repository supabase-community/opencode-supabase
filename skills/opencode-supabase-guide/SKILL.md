---
name: opencode-supabase-guide
description: Use when users ask about Supabase in OpenCode, especially setting up Supabase MCP, connecting project-scoped MCP tools, or applying Supabase Studio OpenCode MCP config prompts.
---

# OpenCode Supabase Guide

## Overview

Supabase MCP adds project-scoped Supabase tools to OpenCode after the remote MCP server is connected. This plugin's Management API tools handle account and project setup; MCP handles richer project workflows selected in Studio.

## When to Use

Use this skill when the user asks to set up, connect, configure, troubleshoot, or understand Supabase MCP in OpenCode, or pastes a Supabase Studio OpenCode MCP prompt/config.

## MCP Setup Flow

1. Explain that MCP adds project-scoped Supabase tools to OpenCode after connection.
2. Explain that plugin tools cover account/project Management API tasks like login, listing organizations/projects, creating projects, and opening setup pages.
3. Resolve the target project before opening Studio. If unclear, list projects and ask which one.
4. Ask explicit confirmation before calling `supabase_open_mcp_setup`: `Open Supabase MCP Connect page for <project name> (<project-ref>)?`
5. Only after confirmation, call `supabase_open_mcp_setup` with `project_ref`.
6. After Studio opens, ALWAYS print the exact MCP setup URL returned by `supabase_open_mcp_setup` in the next chat message, even if the browser opened successfully.
7. Tell the user the URL is a manual fallback if the browser did not open or opened the wrong page.
8. Tell the user to paste the Studio prompt or OpenCode config snippet back here and that you can apply/wire it into this repo's `opencode.json` to finish setup.

## Studio Prompt Handling

Studio's OpenCode MCP prompt is source of truth. Extract the MCP JSON config block, strip copied line numbers such as `1{` and `2  "$schema"...`, and parse/apply only after the user asks for config help.

Never rebuild Studio MCP URLs. Preserve pasted URLs exactly because Studio encodes project, read-only mode, feature groups, and future parameters.

Preserve the MCP server key from JSON, usually `supabase`. Use the auth command shown by Studio, usually `opencode mcp auth supabase`. Skip optional `npx skills add supabase/agent-skills` instructions because this plugin already bundles Supabase skills.

## Config Application Rules

Prefer repo-root `opencode.json` only after the user asks to apply config in this repo. Use global config only when the user explicitly asks for global setup. Ask before editing any config.

After config changes, remind the user to restart OpenCode and run the Studio auth command, usually `opencode mcp auth supabase`, if OAuth is not prompted automatically.

## Boundaries

Do not choose MCP feature groups or permissions for the user. Do not invent read-only policy: if Studio includes `read_only=true`, keep it; if Studio omits it, do not add it. Do not rebuild Studio MCP URLs from `project_ref`.

## Troubleshooting

If MCP tools are missing after config, tell the user to restart OpenCode and run `opencode mcp auth supabase` unless Studio showed a different auth command. If Studio says to install Agent Skills, tell the user to skip it because this plugin already bundles Supabase skills.

## Quick Reference

| Situation | Action |
| --- | --- |
| User asks what MCP is | Explain project-scoped MCP tools versus plugin Management API tools |
| User asks to set up MCP | Resolve project, ask confirmation, call `supabase_open_mcp_setup`, then print exact returned URL |
| Studio prompt pasted | Extract JSON, strip line numbers, preserve URL and server key exactly |
| User asks to wire repo | Ask before editing repo-root `opencode.json` |
| MCP tools missing | Restart OpenCode, run Studio auth command |

## Common Mistakes

- Rebuilding or normalizing Studio MCP URLs. Preserve pasted URL strings exactly.
- Omitting the setup URL after `supabase_open_mcp_setup`. Always print the exact returned URL for manual fallback.
- Installing Supabase Agent Skills again. This plugin already bundles them.
- Writing global config by default. Prefer repo-local `opencode.json` after explicit config-help request.
- Choosing read-only mode or feature groups for the user. Studio/user decides.
- Opening browser before resolving project and getting explicit confirmation.
