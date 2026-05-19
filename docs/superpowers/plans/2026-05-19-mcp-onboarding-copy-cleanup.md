# MCP Onboarding Copy Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten Supabase MCP onboarding copy so users first list projects, then connect MCP, then restart OpenCode and run `opencode mcp auth supabase` explicitly.

**Architecture:** This is a small copy and guidance change. Keep behavior unchanged: no new tools, no MCP status tool, no config API integration, and no no-restart flow. Update source copy, guide instructions, README docs, and tests that assert exact strings.

**Tech Stack:** TypeScript, Bun test runner, OpenCode plugin tools, Markdown skill docs, React TUI strings.

---

## File Structure

- Modify `src/tui/dialog.tsx`: first-run TUI onboarding and post-auth dialog copy.
- Modify `src/server/auth-html.ts`: browser success page prompt copy if needed for exact alignment.
- Modify `src/server/tools.ts`: `supabase_open_mcp_setup` tool description and `formatMcpSetupResult()` output.
- Modify `skills/opencode-supabase-guide/SKILL.md`: agent guidance for ordering, Question tool examples, and explicit MCP auth steps.
- Modify `README.md`: user-facing MCP onboarding docs.
- Modify `test/plugin-exports.test.ts`: exact copy assertions for onboarding, post-auth, and HTML success output.
- Modify `test/server-tools.test.ts`: exact output assertions for `supabase_open_mcp_setup`.

## Scope Constraints

- Do not add `supabase_mcp_status` in this PR.
- Do not implement no-restart MCP config reload or OAuth triggering.
- Do not parse OpenCode config to detect existing MCP servers.
- Do not say OAuth might be prompted automatically. OpenCode currently detects `needs_auth` but does not auto-start browser OAuth.
- Keep `supabase_open_mcp_setup` return value as human-readable text, not JSON.

### Task 1: Align First-Run Copy Around Listing Projects

**Files:**
- Modify: `test/plugin-exports.test.ts`
- Modify: `src/tui/dialog.tsx`
- Modify: `src/server/auth-html.ts`

- [ ] **Step 1: Update failing tests for onboarding prompt**

In `test/plugin-exports.test.ts`, find the test that asserts `ONBOARDING_MESSAGE`. Change the expected onboarding text so `Try this:` uses project listing, not MCP setup.

Expected assertion content:

```ts
expect(plugin.ONBOARDING_MESSAGE).toContain("Supabase is connected.")
expect(plugin.ONBOARDING_MESSAGE).toContain("Try this:")
expect(plugin.ONBOARDING_MESSAGE).toContain("List my Supabase projects")
expect(plugin.ONBOARDING_MESSAGE).not.toContain("Set up Supabase MCP for my project")
```

If the existing test uses one exact multiline string, update the exact string to:

```text
Supabase is connected.

Start by listing your Supabase projects, then connect project-scoped MCP tools for database inspection, docs, advisors, and more in OpenCode.

You can also ask about:
- organizations and projects
- API keys
- regions
- creating a new project

Try this:
List my Supabase projects
```

- [ ] **Step 2: Update failing tests for auth success copy**

In `test/plugin-exports.test.ts`, keep or update the final success dialog assertion to this exact sentence:

```ts
expect(message).toContain("Your account is ready. Close this dialog and ask me to list your Supabase projects.")
```

Keep the HTML success assertion aligned with lowercase browser prompt:

```ts
expect(html).toContain("list my Supabase projects")
```

- [ ] **Step 3: Run focused test to verify failures**

Run:

```bash
bun run test test/plugin-exports.test.ts
```

Expected: FAIL because source copy still contains MCP-first onboarding text.

- [ ] **Step 4: Update TUI onboarding source copy**

In `src/tui/dialog.tsx`, change `ONBOARDING_MESSAGE` to:

```ts
export const ONBOARDING_MESSAGE = `Supabase is connected.

Start by listing your Supabase projects, then connect project-scoped MCP tools for database inspection, docs, advisors, and more in OpenCode.

You can also ask about:
- organizations and projects
- API keys
- regions
- creating a new project

Try this:
List my Supabase projects`
```

Keep the post-auth success dialog sentence as:

```ts
message: "Your account is ready. Close this dialog and ask me to list your Supabase projects.",
```

- [ ] **Step 5: Verify browser success source copy**

In `src/server/auth-html.ts`, keep the prompt box as:

```ts
list my Supabase projects
```

If the surrounding text competes with this direction, make it match:

```html
<div class="label">Try this next:</div>
<div class="prompt">list my Supabase projects</div>
```

- [ ] **Step 6: Run focused test to verify pass**

Run:

```bash
bun run test test/plugin-exports.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/tui/dialog.tsx src/server/auth-html.ts test/plugin-exports.test.ts
git commit -m "fix(tui): lead Supabase onboarding with projects"
```

Expected: commit succeeds. If `src/server/auth-html.ts` did not change, omit it from `git add`.

### Task 2: Simplify MCP Setup Tool Output

**Files:**
- Modify: `test/server-tools.test.ts`
- Modify: `src/server/tools.ts`

- [ ] **Step 1: Update failing tests for setup output**

In `test/server-tools.test.ts`, find the `supabase_open_mcp_setup` output test. Update expectations so the result includes:

```ts
expect(result).toContain("MCP Connect page is open:")
expect(result).toContain("Grab config from Supabase Studio:")
expect(result).toContain("In Connect -> MCP -> OpenCode, choose permissions.")
expect(result).toContain("Copy the generated config under Configure MCP.")
expect(result).toContain("Paste the Studio prompt or config snippet back here.")
expect(result).toContain("Skip any install Supabase Agent Skills step; this plugin already bundles them.")
expect(result).toContain("After adding config, restart OpenCode, then run:")
expect(result).toContain("opencode mcp auth supabase")
expect(result).toContain("Complete OAuth in the browser.")
expect(result).not.toContain("if OAuth")
expect(result).not.toContain("prompted automatically")
```

Preserve existing URL assertions for:

```text
https://supabase.com/dashboard/project/<project-ref>?showConnect=true&connectTab=mcp&mcpClient=opencode
```

- [ ] **Step 2: Run focused test to verify failures**

Run:

```bash
bun run test test/server-tools.test.ts
```

Expected: FAIL because source output still says `On the Connect page:` and conditional OAuth wording.

- [ ] **Step 3: Update `formatMcpSetupResult()` output**

In `src/server/tools.ts`, replace the returned text from `formatMcpSetupResult(projectRef: string)` with:

```ts
return [
  "MCP Connect page is open:",
  url,
  "",
  "Grab config from Supabase Studio:",
  "1. In Connect -> MCP -> OpenCode, choose permissions.",
  "2. Copy the generated config under Configure MCP.",
  "3. Paste the Studio prompt or config snippet back here.",
  "",
  "Skip any install Supabase Agent Skills step; this plugin already bundles them.",
  "",
  "After adding config, restart OpenCode, then run:",
  "opencode mcp auth supabase",
  "",
  "Complete OAuth in the browser.",
].join("\n")
```

Keep `createMcpSetupUrl(projectRef: string)` unchanged.

- [ ] **Step 4: Update `supabase_open_mcp_setup` description**

In `src/server/tools.ts`, update the tool description to stop telling agents to ask `Open Supabase MCP Connect page for <project name> (<project-ref>)?`. Use this description:

```ts
description:
  "Open Supabase Studio MCP Connect page for a project after the user confirms the project. Use when the user asks to set up, connect, configure, or use Supabase MCP in OpenCode. Before calling, briefly explain that MCP adds project-scoped database, docs, advisor, and management tools. Ask a Question tool confirmation with an Open browser recommended option and a Skip setup option.",
```

- [ ] **Step 5: Run focused test to verify pass**

Run:

```bash
bun run test test/server-tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/server/tools.ts test/server-tools.test.ts
git commit -m "fix(tools): clarify MCP setup instructions"
```

Expected: commit succeeds.

### Task 3: Rewrite Guide Flow and Question Examples

**Files:**
- Modify: `skills/opencode-supabase-guide/SKILL.md`
- Modify: `test/server-skills.test.ts` only if adding assertions for guide text

- [ ] **Step 1: Add guide assertions only if existing tests already inspect skill content**

Open `test/server-skills.test.ts`. If it only checks registration/enabling, do not add broad text assertions. If it already reads `SKILL.md` content, add these targeted assertions:

```ts
expect(skillContent).toContain("List projects first")
expect(skillContent).toContain("Open browser (Recommended)")
expect(skillContent).toContain("Do not add Other, Something else, or Type your own answer")
expect(skillContent).toContain("OpenCode does not automatically start OAuth")
expect(skillContent).toContain("opencode mcp auth supabase")
```

- [ ] **Step 2: Run guide-related test to verify current state**

If `test/server-skills.test.ts` was changed, run:

```bash
bun run test test/server-skills.test.ts
```

Expected: FAIL until guide text is updated.

If `test/server-skills.test.ts` was not changed, skip this step and rely on review plus full test suite.

- [ ] **Step 3: Update setup ordering in guide**

In `skills/opencode-supabase-guide/SKILL.md`, update the MCP flow section so it says:

```markdown
## MCP Setup Flow

List projects first. Do not lead with MCP setup immediately after `/supabase` auth.

1. If user has not chosen a project, call `supabase_list_projects`.
2. If multiple projects exist, use the Question tool to choose one.
3. After a project is selected, offer to connect that project to Supabase MCP.
4. If user confirms, call `supabase_open_mcp_setup`.
5. Tell user to paste the Studio prompt or OpenCode config snippet back here.
6. After config is added, tell user to restart OpenCode, then run `opencode mcp auth supabase` and complete OAuth in the browser.
```

- [ ] **Step 4: Add exact Question tool confirmation example**

In `skills/opencode-supabase-guide/SKILL.md`, add this example under the MCP setup flow:

````markdown
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
````

- [ ] **Step 5: Add Question tool anti-patterns**

In `skills/opencode-supabase-guide/SKILL.md`, add:

```markdown
Question tool rules:

- Do not add `Other`, `Something else`, `Type your own answer`, or catch-all options.
- OpenCode adds `Type your own answer` automatically.
- Put the recommended option first and include `(Recommended)` in the label.
- Keep labels short and put explanatory text in `description`.
```

- [ ] **Step 6: Add explicit auth wording**

In `skills/opencode-supabase-guide/SKILL.md`, replace conditional OAuth language with:

````markdown
OpenCode does not automatically start OAuth after config is added. After adding MCP config, tell the user:

```text
Restart OpenCode, then run:
opencode mcp auth supabase

Complete OAuth in the browser.
```
````

Remove all guide wording equivalent to:

```text
if OAuth is not prompted automatically
```

- [ ] **Step 7: Add clearer existing-config wording**

In `skills/opencode-supabase-guide/SKILL.md`, add this few-shot for already-wired config:

````markdown
If the Studio config is already present in `.opencode/opencode.json` or `.opencode/opencode.jsonc`, say:

```text
Supabase MCP config already exists for this workspace. No file changes needed.

Restart OpenCode, then run:
opencode mcp auth supabase

Complete OAuth in the browser.
```

Do not say `already wired` without explaining the restart and auth steps.
````

- [ ] **Step 8: Run guide-related test**

If `test/server-skills.test.ts` was changed, run:

```bash
bun run test test/server-skills.test.ts
```

Expected: PASS.

If `test/server-skills.test.ts` was not changed, skip this step.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add skills/opencode-supabase-guide/SKILL.md test/server-skills.test.ts
git commit -m "fix(skill): clarify Supabase MCP setup flow"
```

Expected: commit succeeds. If `test/server-skills.test.ts` did not change, omit it from `git add`.

### Task 4: Update README Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README copy**

In `README.md`, find the MCP onboarding section around the current prompt `Set up Supabase MCP for my project`. Replace that flow with:

````markdown
After connecting Supabase, start by asking OpenCode to list projects:

```text
List my Supabase projects
```

Pick the project you want to work with, then ask OpenCode to connect Supabase MCP for that project. OpenCode opens Supabase Studio so you can choose MCP permissions and copy the generated OpenCode config.

After OpenCode adds the config, restart OpenCode and authenticate the MCP server:

```bash
opencode mcp auth supabase
```

Complete OAuth in the browser. Skip any `install Supabase Agent Skills` step in Studio; this plugin already bundles the Supabase skills.
````

- [ ] **Step 2: Check README for removed conditional auth wording**

Search `README.md` for:

```text
if OAuth
prompted automatically
Set up Supabase MCP for my project
```

Expected: no remaining matches unless the old MCP prompt appears in a historical changelog section that should remain unchanged.

- [ ] **Step 3: Commit Task 4**

Run:

```bash
git add README.md
git commit -m "docs: update Supabase MCP onboarding flow"
```

Expected: commit succeeds.

### Task 5: Full Verification

**Files:**
- Verify all changed files

- [ ] **Step 1: Run focused test suite**

Run:

```bash
bun run test test/plugin-exports.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run server tool tests**

Run:

```bash
bun run test test/server-tools.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run skill tests if changed**

If `test/server-skills.test.ts` changed, run:

```bash
bun run test test/server-skills.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
bun run lint
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Run full tests**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 7: Run package verification**

Run:

```bash
bun run verify:pack
```

Expected: PASS.

- [ ] **Step 8: Inspect final diff**

Run:

```bash
git diff --stat
git diff
```

Expected: diff only touches planned files and contains no `if OAuth isn't prompted automatically` wording.

- [ ] **Step 9: Final commit if verification changed files**

If verification changed generated files, commit them with:

```bash
git add <changed-generated-files>
git commit -m "chore: update generated artifacts"
```

Expected: no commit needed unless a verification command intentionally updated generated output.

## Self-Review Notes

- Spec coverage: onboarding copy, setup tool output, guide flow, Question tool examples, README docs, and tests are covered.
- Scope check: no MCP status tool, no no-restart flow, and no journal update are included.
- Placeholder scan: plan contains no placeholder markers.
- Type consistency: no new TypeScript APIs are introduced; existing string-returning plugin tool behavior is preserved.
