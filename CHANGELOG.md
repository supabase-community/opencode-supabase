# Changelog

## 0.4.2

### Patch Changes

- 53ea5a2: Fix Supabase auth store path resolution for Windows drive-letter, UNC, and extended-length paths so credentials are written to the correct project worktree root instead of mixing separators or falling back unexpectedly.

## 0.4.1

### Patch Changes

- f71506e: Switch npm publishing to trusted publishing with GitHub OIDC and update repository links for the transferred supabase-community repo.

## 0.4.0

### Minor Changes

- 3d50f7a: Update default OAuth broker URL and client ID for new Supabase project deployment

## 0.3.1

### Patch Changes

- 35f3b08: Tighten Supabase MCP onboarding copy to guide users from listing projects into MCP connection.

## 0.3.0

### Minor Changes

- 691346a: Add Supabase MCP onboarding: plugin-owned `opencode-supabase-guide` skill, authenticated `supabase_open_mcp_setup` server tool, updated TUI onboarding message, and README docs.

## 0.2.2

### Patch Changes

- a5d9160: Persist Supabase onboarding before navigating to newly created chat sessions, preventing the prompt from being dropped when confirming an already-connected account from the home screen.

## 0.2.1

### Patch Changes

- 3a6ea04: Prevent ambiguous broker refresh errors from clearing saved Supabase auth.
- 6fe8bd6: Recover corrupt Supabase auth store instead of crashing. Invalid or unsupported store files are backed up, reset to a valid notice state, and surfaced through the `/supabase` dialog and tool errors.

## 0.2.0

### Minor Changes

- fd5e418: Bundle Supabase agent skills as vendored files with configurable runtime registration

  - Vendor `supabase` and `supabase-postgres-best-practices` skill directories from `supabase/agent-skills`
  - Add `skills:sync` script to update vendored skills from upstream (defaults to latest default branch, accepts explicit commit/ref)
  - Register skill paths via plugin `config` hook; disable per-skill or entirely through plugin options
  - Add tests for skill resolution and path registration

## 0.1.1

### Patch Changes

- 51a6aec: ## Features

  - **Disconnect toast**: Show a confirmation toast after successfully disconnecting from Supabase.

- 51a6aec: ## UI Improvements

  - **Supabase auth progress**: Replaced static auth checks with an animated spinner dialog, markdown instructions, and clearer "No action needed" preflight copy.
  - **OAuth dismiss behavior**: Renamed in-progress auth action to `Dismiss`. Dismiss closes only the dialog; browser approval can still complete auth and show the success toast.
  - **Connection flow polish**: Unified "Connect to Supabase" titles, shortened browser approval copy, simplified post-auth onboarding, and replaced the success dialog with a single OK action.

- 28bd647: Update Supabase dialog copy to match the reviewed onboarding wording.

## 0.1.0

### Minor Changes

- c80607a: ## Features

  - **Connected-state detection**: `/supabase` now checks saved auth before showing the connect dialog. If already connected, shows "Already connected to Supabase" with options to continue or disconnect.
  - **Disconnect action**: Added ability to disconnect from Supabase via the already-connected dialog.
  - **Auth status preflight**: Dialog now shows "Checking Supabase connection..." while verifying auth state.

  ## Fixes

  - **Preflight deduplication**: Prevent duplicate auth status checks when dialog re-renders.
  - **Broker refresh single-flight**: Concurrent stale-auth callers now join one broker refresh instead of spawning multiple.
  - **Disconnect race protection**: Explicit disconnect wins over in-flight refresh operations.
  - **Stale refresh handling**: Refreshes that complete after newer auth is written no longer overwrite or clear the newer credentials.

  ## UI Improvements

  - **Disconnect label**: Already-connected dialog cancel button now explicitly labeled "Disconnect" instead of generic "Cancel".

## 0.0.8

### Patch Changes

- 958036d: Replace fleeting success toasts with a persistent post-auth dialog that lists concrete example prompts (`list my Supabase projects`, `list my Supabase organizations`, `for organization <name>, list available regions`). The waiting dialog now uses centered built-in `DialogAlert` instead of a custom off-center shell. Browser success page stays minimal with a small prompt snippet. Dismissing the waiting dialog suppresses the success dialog to avoid surprise popups. Also fixes error dialog retry to start a fresh OAuth flow instead of reopening stale browser tabs.

  Refs: #22, #27

- 6271160: Fix inconsistent auth error messages between toast/dialog and browser/TUI by extracting a shared `formatAuthError` helper that unwraps nested SDK error payloads.
- c8e538b: Add `supabase_list_regions` tool — calls `GET /v1/projects/available-regions?organization_slug=<slug>` so the LLM can discover valid region codes before creating projects.

## 0.0.7

### Patch Changes

- 34202de: Fix Supabase OAuth callback collisions by retrying a fixed localhost callback window (`14589`-`14591`) and stopping the callback listener as soon as auth finishes.

## 0.0.6

### Patch Changes

- d64d8f3: Dummy release test for Changesets workflow.

All notable changes to this project will be documented in this file.

## 0.0.5 - 2026-04-14

### Fixed

- Fix Supabase auth failures in non-git directories when invalid host `worktree` values caused writes to `/.opencode` instead of the session directory.
- Harden auth store path resolution to reject root, unrelated, and nested-inside-directory `worktree` values before falling back to the session directory.
- Add regression coverage across store, auth callback, and tool auth read/refresh/clear flows for invalid `worktree` inputs.
