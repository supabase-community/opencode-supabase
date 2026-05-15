# MCP Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users ask OpenCode to connect Supabase MCP for a project through Studio's existing OpenCode MCP Connect Sheet.

**Architecture:** Keep runtime behavior minimal: add one plugin-owned skill, register it with existing bundled skills, and add one authenticated server tool that opens the deterministic Studio MCP/OpenCode URL. Studio remains source of truth for MCP feature groups and permissions; the agent explains, confirms, opens, and asks for pasted Studio config if the user wants project-local setup help.

**Tech Stack:** TypeScript, Bun test runner, OpenCode plugin server tools, OpenCode bundled skills, Supabase Studio Connect Sheet deep links, `open` package.

---

## Current Branch

Use existing branch:

```bash
git status --short --branch
```

Expected:

```text
## docs/mcp-onboarding-spec...origin/docs/mcp-onboarding-spec [ahead 1]
```

The branch already contains the design spec commit. Continue on this branch unless the user asks for a new worktree.

## File Structure

- Create: `skills/opencode-supabase-guide/SKILL.md`
  - plugin-owned guidance for OpenCode Supabase integration; teaches MCP setup flow, browser confirmation, paste-back flow, bundled-skills skip, and project-local config preference only after user asks for config help
- Modify: `src/server/skills.ts`
  - add `opencode-supabase-guide` to `BUNDLED_SUPABASE_SKILLS`
- Modify: `src/server/tools.ts`
  - add browser-opening dependency, deterministic Studio URL helper, result text helper, and `supabase_open_mcp_setup` server tool
- Modify: `test/server-skills.test.ts`
  - update bundled skill defaults, path registration, duplicate handling, missing-directory behavior, and server config hook expectations
- Modify: `test/server-tools.test.ts`
  - add tests for MCP setup tool registration, auth requirement, URL opening, and returned guidance
- Modify: `README.md`
  - document MCP onboarding, Studio source of truth, paste-back flow, bundled-skills skip, restart/auth guidance, and no automatic config editing promise

## Task 1: Skill Behavior Pressure Tests

**Files:**
- Create later: `skills/opencode-supabase-guide/SKILL.md`

- [ ] **Step 1: Run baseline pressure scenario without plugin skill**

Use the `task` tool with `subagent_type: general`. Do not create the skill before this step.

Prompt:

```text
You are testing baseline agent behavior for a future OpenCode plugin skill. Do not read or assume any `skills/opencode-supabase-guide/SKILL.md` file exists. Read only `/home/jumski/Code/jumski/opencode-supabase/docs/superpowers/specs/2026-05-15-mcp-onboarding-design.md` if needed. Scenario: user says, "Set up Supabase MCP for my project." You know there is a project named "Acme Prod" with ref "yepepldpwepdbczomujk". Return the exact user-facing response and any tool call you would make. Do not edit files.
```

Expected RED signal: the response violates at least one target behavior, such as opening/calling before explicit confirmation, recommending read-only as a fixed default, choosing feature groups, omitting paste-back guidance, or recommending `npx skills add supabase/agent-skills`.

- [ ] **Step 2: Run config-snippet baseline scenario without plugin skill**

Use the `task` tool with `subagent_type: general`.

Prompt:

```text
You are testing baseline agent behavior for a future OpenCode plugin skill. Do not read or assume any `skills/opencode-supabase-guide/SKILL.md` file exists. Read only `/home/jumski/Code/jumski/opencode-supabase/docs/superpowers/specs/2026-05-15-mcp-onboarding-design.md` if needed. Scenario: user pasted this Studio prompt: "Add this to ~/.config/opencode/opencode.json, then run opencode mcp auth supabase, then run npx skills add supabase/agent-skills." The user asks, "Can you apply this here?" Return what you would do and what config path you would prefer. Do not edit files.
```

Expected RED signal: the response follows global config by default, installs Agent Skills, skips restart/auth guidance, or edits config without preserving the Studio-provided MCP URL.

- [ ] **Step 3: Record baseline failures in implementation notes**

Add a short implementation note in the PR description or local scratch notes, not in the repository. Use exact failures from the subagent output. This example shows the required shape:

```text
Skill baseline failures observed:
- Opened or called MCP setup before explicit project confirmation.
- Followed Studio's global Agent Skills install step instead of skipping it for this plugin.
```

Expected: at least one concrete failure is recorded before writing the skill.

## Task 2: Plugin Skill

**Files:**
- Create: `skills/opencode-supabase-guide/SKILL.md`

- [ ] **Step 1: Create plugin-owned skill**

Create `skills/opencode-supabase-guide/SKILL.md`:

```markdown
---
name: opencode-supabase-guide
description: Use when users ask about Supabase in OpenCode, especially setting up Supabase MCP, connecting project-scoped MCP tools, or applying Supabase Studio OpenCode MCP config prompts.
---

# OpenCode Supabase Guide

## Overview

Supabase MCP adds project-scoped Supabase tools to OpenCode after the user connects the remote MCP server. This plugin also has Management API tools for account-level tasks like login, listing organizations/projects, creating projects, and opening setup pages.

## MCP Setup Flow

When the user asks to set up, connect, configure, or use Supabase MCP:

1. Explain briefly: MCP gives OpenCode project-scoped Supabase tools such as database, docs, advisors, and other Studio-selected capabilities.
2. If the project is unclear, use Supabase project-listing tools and ask which project to connect.
3. Before opening a browser, ask: `Open Supabase MCP Connect page for <project name> (<project-ref>)?`
4. Only after explicit confirmation, call `supabase_open_mcp_setup` with the selected `project_ref`.
5. Tell the user Studio is the source of truth for MCP feature groups and permissions.
6. Tell the user they can paste the Studio prompt or OpenCode config snippet back if they want help wiring it into this repo.

## Studio Prompt Handling

If the user pastes Studio instructions or an OpenCode MCP config snippet and asks for help applying it:

- Preserve the MCP URL Studio generated, including `project_ref`, `features`, and any permission parameters.
- Prefer project-local `opencode.json` in the repo root unless the user explicitly asks for global setup.
- Do not install Supabase Agent Skills. This plugin already bundles Supabase skills.
- After config changes, tell the user to restart OpenCode and run `opencode mcp auth supabase` if OAuth is not prompted automatically.

## Boundaries

- Do not choose MCP feature groups for the user.
- Do not choose a hard-coded read-only policy until product direction is confirmed.
- Do not edit MCP config unless the user asks for config help after seeing or pasting Studio output.
- Do not use slash-command injection, prompt injection, or chat-message automation for MCP onboarding.

## Quick Reference

| User asks | Agent should |
| --- | --- |
| "What is Supabase MCP?" | Explain project-scoped MCP tools; do not open browser yet |
| "Set up MCP for this project" | Resolve project, confirm project/ref, then call `supabase_open_mcp_setup` |
| "Studio says install Agent Skills" | Say this plugin already bundles Supabase skills; skip that step |
| "Apply this config" | Prefer repo-root `opencode.json`, preserve Studio URL, restart/auth guidance |
```

- [ ] **Step 2: Verify skill file shape**

Run:

```bash
bun run typecheck
```

Expected: existing TypeScript check remains green; the markdown file does not affect typecheck.

- [ ] **Step 3: Run pressure scenario with skill content**

Use the `task` tool with `subagent_type: general`.

Prompt:

```text
Read `/home/jumski/Code/jumski/opencode-supabase/skills/opencode-supabase-guide/SKILL.md` and `/home/jumski/Code/jumski/opencode-supabase/docs/superpowers/specs/2026-05-15-mcp-onboarding-design.md`. Scenario: user says, "Set up Supabase MCP for my project." You know there is a project named "Acme Prod" with ref "yepepldpwepdbczomujk". Return the exact user-facing response and any tool call you would make. Do not edit files.
```

Expected GREEN signal:

```text
Explains MCP briefly.
Asks "Open Supabase MCP Connect page for Acme Prod (yepepldpwepdbczomujk)?"
Does not call supabase_open_mcp_setup until the user confirms.
Does not choose feature groups or read-only policy.
```

- [ ] **Step 4: Run config-snippet scenario with skill content**

Use the `task` tool with `subagent_type: general`.

Prompt:

```text
Read `/home/jumski/Code/jumski/opencode-supabase/skills/opencode-supabase-guide/SKILL.md` and `/home/jumski/Code/jumski/opencode-supabase/docs/superpowers/specs/2026-05-15-mcp-onboarding-design.md`. Scenario: user pasted this Studio prompt: "Add this to ~/.config/opencode/opencode.json, then run opencode mcp auth supabase, then run npx skills add supabase/agent-skills." The Studio config URL is `https://mcp.supabase.com/mcp?project_ref=yepepldpwepdbczomujk&features=docs%2Cdatabase`. The user asks, "Can you apply this here?" Return what you would do and what config path you would prefer. Do not edit files.
```

Expected GREEN signal:

```text
Prefers repo-root opencode.json.
Preserves the Studio MCP URL including features.
Says to skip Agent Skills installation because plugin bundles them.
Mentions restart OpenCode and run opencode mcp auth supabase if OAuth is not prompted.
```

- [ ] **Step 5: Commit skill file**

Run:

```bash
git add skills/opencode-supabase-guide/SKILL.md
git commit -m "feat: add opencode-supabase-guide skill"
```

Expected: commit succeeds.

## Task 3: Skill Registration

**Files:**
- Modify: `src/server/skills.ts`
- Test: `test/server-skills.test.ts`

- [ ] **Step 1: Update failing skill-registration tests**

In `test/server-skills.test.ts`, update the default enabled skills test:

```ts
expect(resolveEnabledSupabaseSkills(undefined)).toEqual([
  "supabase",
  "supabase-postgres-best-practices",
  "opencode-supabase-guide",
]);
```

Update the omitted-key test:

```ts
expect(resolveEnabledSupabaseSkills({ skills: { "supabase-postgres-best-practices": false } })).toEqual([
  "supabase",
  "opencode-supabase-guide",
]);
```

Update the unknown-key and non-boolean tests to expect all three bundled skills:

```ts
expect(resolveEnabledSupabaseSkills({ skills: { typo: false } }, { warn: (_message, data) => warnings.push(data) })).toEqual([
  "supabase",
  "supabase-postgres-best-practices",
  "opencode-supabase-guide",
]);
```

```ts
expect(resolveEnabledSupabaseSkills({ skills: { supabase: "yes" } }, { warn: (_message, data) => warnings.push(data) })).toEqual([
  "supabase",
  "supabase-postgres-best-practices",
  "opencode-supabase-guide",
]);
```

Update registered path expectations to include:

```ts
"/plugin/skills/opencode-supabase-guide"
```

Update server hook expectation to include:

```ts
path.join(skillsRoot, "opencode-supabase-guide")
```

- [ ] **Step 2: Run focused test to verify RED**

Run:

```bash
bun run test test/server-skills.test.ts
```

Expected: FAIL because `BUNDLED_SUPABASE_SKILLS` does not include `opencode-supabase-guide` yet.

- [ ] **Step 3: Register the new skill**

In `src/server/skills.ts`, change `BUNDLED_SUPABASE_SKILLS` to:

```ts
export const BUNDLED_SUPABASE_SKILLS = [
  "supabase",
  "supabase-postgres-best-practices",
  "opencode-supabase-guide",
] as const;
```

- [ ] **Step 4: Run focused test to verify GREEN**

Run:

```bash
bun run test test/server-skills.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit registration**

Run:

```bash
git add src/server/skills.ts test/server-skills.test.ts
git commit -m "feat: register opencode-supabase-guide skill"
```

Expected: commit succeeds.

## Task 4: MCP Setup Tool

**Files:**
- Modify: `src/server/tools.ts`
- Test: `test/server-tools.test.ts`

- [ ] **Step 1: Write failing tool tests**

Add these tests near the end of `test/server-tools.test.ts`, before the existing `supabase_login returns TUI guidance` test:

```ts
test("opens Supabase MCP setup page for a project ref", async () => {
  const { input } = await createInput();
  await writeSavedAuth(input, {
    access: "saved-access",
    refresh: "saved-refresh",
    expires: Date.now() + 60_000,
  });
  const openMock = mock(async () => undefined);
  const tools = createSupabaseTools(
    input,
    {
      clientId: "plugin-client",
      oauthPort: 17686,
    },
    { open: openMock },
  );

  const result = await tools.supabase_open_mcp_setup.execute(
    { project_ref: "yepepldpwepdbczomujk" },
    createContext(input),
  );

  expect(openMock).toHaveBeenCalledWith(
    "https://supabase.com/dashboard/project/yepepldpwepdbczomujk?showConnect=true&connectTab=mcp&mcpClient=opencode",
  );
  expect(result).toContain("Opened Supabase MCP setup for project yepepldpwepdbczomujk in Studio.");
  expect(result).toContain("paste the Studio prompt or OpenCode config snippet back here");
  expect(result).toContain("skip any \"install Supabase Agent Skills\" step");
  expect(result).toContain("Restart OpenCode after changing config");
  expect(result).toContain("opencode mcp auth supabase");
});

test("requires Supabase auth before opening MCP setup page", async () => {
  const { input } = await createInput();
  const openMock = mock(async () => undefined);
  const tools = createSupabaseTools(
    input,
    {
      clientId: "plugin-client",
      oauthPort: 17687,
    },
    { open: openMock },
  );

  await expect(
    tools.supabase_open_mcp_setup.execute({ project_ref: "proj_123" }, createContext(input)),
  ).rejects.toThrow("Supabase is not connected. Run /supabase first.");

  expect(openMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused test to verify RED**

Run:

```bash
bun run test test/server-tools.test.ts
```

Expected: FAIL because `supabase_open_mcp_setup` and `ToolDeps.open` do not exist yet.

- [ ] **Step 3: Add browser dependency and helpers**

In `src/server/tools.ts`, add import:

```ts
import open from "open";
```

Change `ToolDeps` to:

```ts
type ToolDeps = {
  fetch?: FetchLike;
  logger?: SupabaseLogger;
  now?: () => Date;
  open?: (target: string) => Promise<unknown>;
};
```

Add these helpers before `createSupabaseTools`:

```ts
function createMcpSetupUrl(projectRef: string) {
  const url = new URL(`https://supabase.com/dashboard/project/${encodeURIComponent(projectRef)}`);
  url.searchParams.set("showConnect", "true");
  url.searchParams.set("connectTab", "mcp");
  url.searchParams.set("mcpClient", "opencode");
  return url.toString();
}

function formatMcpSetupResult(projectRef: string) {
  return `Opened Supabase MCP setup for project ${projectRef} in Studio.

On the Connect page:
1. Confirm MCP tab and OpenCode client are selected.
2. Choose the feature groups and permissions you want in Studio.
3. Follow the OpenCode config and auth steps shown by Studio.
4. If you want me to wire this into the current repo, paste the Studio prompt or OpenCode config snippet back here.
5. You can skip any "install Supabase Agent Skills" step because this plugin already bundles them.
6. Restart OpenCode after changing config; run \`opencode mcp auth supabase\` if OAuth is not prompted automatically.`;
}
```

- [ ] **Step 4: Add tool implementation**

In the object returned by `createSupabaseTools`, add this tool before `supabase_login`:

```ts
    supabase_open_mcp_setup: tool({
      description:
        "Open Supabase Studio MCP Connect page for a project after the user confirms the project. Use when the user asks to set up, connect, configure, or use Supabase MCP in OpenCode. Before calling, explain MCP briefly and ask: Open Supabase MCP Connect page for <project name> (<project-ref>)?",
      args: {
        project_ref: tool.schema.string().describe("Supabase project reference ID"),
      },
      async execute(args, _context: SupabaseToolContext) {
        await ensureSupabaseToolAuth(input, options, deps);
        const url = createMcpSetupUrl(args.project_ref);
        const openBrowser = deps.open ?? open;
        await openBrowser(url);
        await deps.logger?.info("supabase mcp setup opened", {
          tool: "supabase_open_mcp_setup",
          sessionID: _context.sessionID,
          messageID: _context.messageID,
          agent: _context.agent,
        });
        return formatMcpSetupResult(args.project_ref);
      },
    }),
```

- [ ] **Step 5: Run focused test to verify GREEN**

Run:

```bash
bun run test test/server-tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit tool**

Run:

```bash
git add src/server/tools.ts test/server-tools.test.ts
git commit -m "feat: add supabase mcp setup tool"
```

Expected: commit succeeds.

## Task 5: README Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README bundled skills list**

In `README.md`, add `opencode-supabase-guide` to the bundled skills list:

```md
- `supabase`
- `supabase-postgres-best-practices`
- `opencode-supabase-guide`
```

- [ ] **Step 2: Add MCP onboarding docs**

Add this section after the bundled skills section and before `Disable Bundled Skills`:

````md
## Supabase MCP Onboarding

Ask your agent:

```text
Set up Supabase MCP for my project
```

The agent can explain Supabase MCP, help you choose the target project, and open the Supabase Studio Connect Sheet with the MCP tab and OpenCode client selected.

Studio remains the source of truth for MCP feature groups, permissions, generated OpenCode config, and auth steps. If you want help applying the Studio output to this repository, paste the Studio prompt or OpenCode config snippet back into OpenCode.

You can skip any Studio instruction to install Supabase Agent Skills separately. This plugin already bundles Supabase skills.

After changing OpenCode MCP config, restart OpenCode. If OAuth is not prompted automatically, run:

```bash
opencode mcp auth supabase
```

This plugin opens the MCP setup page and guides the workflow. It does not automatically edit MCP config or choose read-only/feature-group settings for you.
````

- [ ] **Step 3: Fix maintainer test command while touching README**

Replace raw `bun test` in the maintainer section with the repository-approved script:

```bash
bun run test
```

- [ ] **Step 4: Commit docs**

Run:

```bash
git add README.md
git commit -m "docs: document mcp onboarding"
```

Expected: commit succeeds.

## Task 6: Final Verification

**Files:**
- Verify all changed files

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun run test test/server-skills.test.ts test/server-tools.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository verification**

Run:

```bash
bun run lint
bun run typecheck
bun run test
bun run verify:pack
```

Expected: all commands exit 0.

- [ ] **Step 3: Confirm package includes new skill**

Inspect `bun run verify:pack` output and confirm package file list includes:

```text
skills/opencode-supabase-guide/SKILL.md
```

Expected: file appears in dry-run package contents.

- [ ] **Step 4: Review final diff**

Run:

```bash
git status --short --branch
git log --oneline -5
git diff origin/docs/mcp-onboarding-spec...HEAD --stat
```

Expected: working tree clean; recent commits include skill, registration, tool, docs; diff touches only planned files.

- [ ] **Step 5: Push branch**

Run:

```bash
git push
```

Expected: branch pushes to `origin/docs/mcp-onboarding-spec`.

## Self-Review Checklist

- Spec coverage:
  - Skill explains MCP, confirmation, Studio source of truth, paste-back flow, bundled-skills skip, project-local config preference after explicit ask.
  - Tool requires auth, opens deterministic Studio URL, and returns setup guidance.
  - Tests cover skill registration, tool URL, auth requirement, and returned guidance.
  - README documents MCP onboarding and avoids automatic config/read-only promises.
- Placeholder scan:
  - No unresolved placeholders or vague implementation steps.
- Type consistency:
  - `opencode-supabase-guide` matches skill directory and registry key.
  - `supabase_open_mcp_setup` matches test and tool names.
  - `project_ref` matches tool schema and spec contract.
  - `open` dependency is injected as `deps.open` and defaults to imported `open`.
