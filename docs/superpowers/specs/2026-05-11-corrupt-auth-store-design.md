# Corrupt Supabase Auth Store Recovery Design

## Summary

Issue #34 reports that `.opencode/supabase-auth.json` is trusted as valid JSON with the expected shape. If the file is truncated, manually edited, synced incorrectly, or has an unsupported version, the current `JSON.parse(...)` path throws and plugin auth paths can crash.

The fix is to make auth-store reads fail closed: validate the file before trusting it, preserve any corrupt file as a timestamped backup, reset the canonical store to a valid empty state, persist a user-visible reset notice, and surface that notice through the `/supabase` dialog or direct tool-call errors.

## Goals

- Prevent corrupt local auth files from crashing server auth, `/supabase` preflight, or tool execution.
- Preserve the corrupt file at `.opencode/supabase-auth.corrupt-<timestamp>.json` for user inspection.
- Reset the canonical auth store to a valid version `1` state automatically.
- Persist a durable corruption notice so `/supabase` shows a dialog instead of relying on a transient toast.
- Make direct tool calls fail with a clear reconnect message when corruption is discovered there.
- Log the original corruption error with enough context to diagnose it.
- Add regression tests for invalid JSON, wrong store version, wrong top-level shape, wrong auth shape, tool-call discovery, and `/supabase` notice rendering.

## Non-Goals

- Do not change issue #33 behavior in this issue. PR #51 covers that work.
- Do not revoke Supabase credentials remotely.
- Do not add a new user command.
- Do not change the OAuth broker contract.
- Do not introduce a schema validation dependency for this small persisted shape.
- Do not make every store write atomic in this issue. Atomic writes are useful future hardening but are separate from recovering existing corrupt stores.

## Existing Behavior

`src/server/store.ts` currently reads the auth store with:

```ts
const parsed = JSON.parse(await authFile.text()) as SavedState;
```

It then checks only `parsed.version !== 1` and returns auth if present. Invalid JSON, non-object values, wrong `auth` shape, and unsupported versions can throw through callers.

Call paths that read saved auth include:

- `/supabase` preflight through `src/server/auth.ts`
- tool auth through `ensureSupabaseToolAuth(...)` in `src/server/tools.ts`
- auth status checks through `getSupabaseAuthStatus(...)`

## Persisted State

Extend the store state with a corruption notice field that is valid persisted state, not transient process memory.

```ts
export type SavedStateNotice = {
  type: "auth_store_reset";
  message: string;
  backupPath: string;
};

export type SavedState = {
  version: 1;
  auth?: SavedAuth;
  notice?: SavedStateNotice;
};
```

The canonical store after corruption recovery should look like this:

```json
{
  "version": 1,
  "notice": {
    "type": "auth_store_reset",
    "message": "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
    "backupPath": ".opencode/supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json"
  }
}
```

`writeSavedAuth(...)` clears the notice by writing `{ version: 1, auth }` after successful reconnect. `clearSavedAuth(...)` clears the notice by writing `{ version: 1 }` after explicit disconnect.

## Store Validation

`readSavedAuth(input, deps?)` should own the validation and recovery policy because it owns the persisted file format.

Validation rules:

- Missing file returns `{ version: 1 }`.
- Top-level value must be a non-array object.
- `version` must be exactly `1`.
- `auth`, when present, must be a non-array object with `access: string`, `refresh: string`, and `expires: finite number`.
- `notice`, when present, must be an `auth_store_reset` object with string `message` and `backupPath` fields.

If parsing or validation fails, `readSavedAuth(...)` should:

1. Compute a deterministic backup path using a timestamp, for example `.opencode/supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json`.
2. Move the bad canonical store to that path.
3. Write the canonical store as valid empty state with an `auth_store_reset` notice.
4. Log a warning with the original error message, canonical path, and backup path.
5. Return the reset state, including the notice.

Tests should inject the timestamp to make backup names deterministic.

## User Experience

### `/supabase` Dialog Path

When `/supabase` preflight sees a disconnected state with an `auth_store_reset` notice, it should render a persistent confirm dialog.

- Title: `Supabase auth reset`
- Message says the local auth file was corrupted and Supabase auth was reset.
- Message includes the exact backup path.
- Confirm starts OAuth reconnect.
- Cancel closes the dialog.

The notice remains persisted when the user cancels. Running `/supabase` again should show the same dialog until successful reconnect or explicit disconnect clears the notice.

### Direct Tool Path

Tool execution cannot reliably open a TUI dialog. If `ensureSupabaseToolAuth(...)` discovers corruption, the tool should throw a clear error and leave the notice in the store for the next `/supabase` run.

Tool error:

```text
Supabase auth was reset because the local auth store was corrupted.

The corrupted file was preserved here:
.opencode/supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json

Run /supabase to reconnect, then retry this tool.
```

## Server API Changes

`src/server/store.ts` should export `SavedStateNotice` and a helper for writing a notice-only state, for example `writeSavedAuthNotice(input, notice)`. This helper is only for persisted auth-store corruption notices.

`src/server/tools.ts` should:

- pass logger deps into `readSavedAuth(...)` so corruption recovery can be logged from tool paths
- format `auth_store_reset` notices into direct tool errors
- include `notice` on disconnected auth-status results

`src/server/auth.ts` should include optional `notice` data in status instructions so the TUI can render the reset dialog.

## TUI Changes

`src/tui/dialog.tsx` should parse optional `auth_store_reset` notice data from status instructions.

Add a state like:

```ts
| { type: "notice"; notice: AuthNotice }
```

When preflight reads `{ status: "disconnected", notice }`, set the notice state instead of the generic idle state.

## Logging

Store corruption recovery should log:

- event: `supabase auth store reset`
- original error message
- canonical store path
- backup path

Do not log auth secrets, OAuth codes, or full auth file contents.

## Testing Expectations

Add automated coverage for these cases:

- invalid JSON is backed up, canonical store is reset, and `auth_store_reset` notice is returned
- unsupported version is backed up, canonical store is reset, and `auth_store_reset` notice is returned
- wrong top-level shape is backed up, canonical store is reset, and `auth_store_reset` notice is returned
- wrong `auth` shape is treated as corruption
- invalid persisted notice shape is treated as corruption
- backup file keeps the original corrupt bytes
- successful `writeSavedAuth(...)` clears a prior notice
- explicit `clearSavedAuth(...)` clears a prior notice
- direct tool call with a corrupt store throws a reconnect message with backup path
- auth status instructions include notice when disconnected because of recovery
- `/supabase` preflight maps the notice to a persistent dialog
- `/supabase` confirm from a notice dialog starts OAuth reconnect

## Acceptance Criteria

- Invalid JSON and unsupported structure/version do not crash the plugin.
- Corrupted file is preserved under deterministic backup name in tests.
- Canonical auth store is recreated as valid version `1` state with an `auth_store_reset` notice.
- User sees clear reconnect instructions in a persistent `/supabase` dialog.
- Dialog message includes that the auth file was corrupted and where it was backed up.
- Tool-call failure tells the user where the corrupt file was backed up, then tells them to run `/supabase` and retry.
- Existing connected, disconnected, unknown, and disconnect behavior remains intact.
