# Corrupt Supabase Auth Store Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make corrupted Supabase auth stores recover gracefully with backups, reset state, durable reconnect dialogs, and clear tool errors.

**Architecture:** Keep persisted-state validation and corruption recovery in `src/server/store.ts`, where the auth-store format is owned. Surface persisted `auth_store_reset` notices through `src/server/tools.ts` and `src/server/auth.ts`, then let `src/tui/dialog.tsx` render a durable confirm dialog that starts OAuth reconnect.

**Tech Stack:** TypeScript, Bun, Bun test runner, OpenCode plugin server/TUI APIs, Solid signal state.

---

## Worktree Setup

Run this from `/home/jumski/Code/jumski/opencode-supabase` before implementation:

```bash
git fetch origin
git worktree add -b issue-34-corrupt-auth-store .worktrees/issue-34-corrupt-auth-store origin/main
```

Use this workdir for every implementation command:

```bash
/home/jumski/Code/jumski/opencode-supabase/.worktrees/issue-34-corrupt-auth-store
```

## File Structure

- Modify: `src/server/store.ts`
  - own persisted-state validation, backup, reset, `auth_store_reset` notice type, notice writes, and logger-aware recovery
- Modify: `src/server/tools.ts`
  - format corruption notices for tool-call errors, pass logger/timestamp deps to store reads, include notices in auth status, and preserve PR #51 refresh-race semantics unchanged
- Modify: `src/server/auth.ts`
  - include optional corruption notice data in status instructions
- Modify: `src/tui/dialog.tsx`
  - parse corruption notice data, add notice state, and render persistent reconnect dialog
- Modify: `test/server-store.test.ts`
  - cover invalid JSON, wrong version, wrong shape, backup contents, notice clearing, and deterministic backup names
- Modify: `test/server-tools.test.ts`
  - cover tool-call corruption discovery and reconnect error text
- Modify: `test/server-auth.test.ts`
  - cover status instructions that include persisted corruption notices
- Modify: `test/plugin-exports.test.ts`
  - cover `/supabase` preflight and dialog rendering for corruption notices

## Task 1: Store Validation, Backup, Reset, And Notice

**Files:**
- Modify: `src/server/store.ts`
- Test: `test/server-store.test.ts`

- [ ] **Step 1: Write failing store recovery tests**

Update the imports in `test/server-store.test.ts`:

```ts
import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
```

Add `writeSavedAuthNotice` to the existing store import:

```ts
import {
  clearSavedAuth,
  getStoreFile,
  readSavedAuth,
  writeSavedAuth,
  writeSavedAuthNotice,
} from "../src/server/store.ts";
```

Add this helper after `createInput()`:

```ts
async function writeRawStore(input: PluginLikeInput, contents: string) {
  const path = getStoreFile(input);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return path;
}
```

Add these tests inside `describe("server auth store", () => { ... })`:

```ts
test("backs up invalid JSON and resets the auth store with a notice", async () => {
  const input = await createInput();
  const path = await writeRawStore(input, "{ not json");
  const warn = mock(async () => undefined);
  const backupPath = join(
    input.worktree,
    ".opencode",
    "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json",
  );

  await expect(
    readSavedAuth(input, {
      now: () => new Date("2026-05-11T10:20:30.000Z"),
      logger: { warn },
    }),
  ).resolves.toEqual({
    version: 1,
    notice: {
      type: "auth_store_reset",
      message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
      backupPath,
    },
  });

  await expect(readFile(path, "utf8")).resolves.toContain("auth_store_reset");
  await expect(readFile(backupPath, "utf8")).resolves.toBe("{ not json");
  expect(warn).toHaveBeenCalledTimes(1);
});

test("backs up an unsupported store version and resets the auth store", async () => {
  const input = await createInput();
  await writeRawStore(input, JSON.stringify({ version: 2, auth: { access: "a", refresh: "r", expires: 1 } }));

  const state = await readSavedAuth(input, {
    now: () => new Date("2026-05-11T10:20:30.000Z"),
  });

  expect(state).toMatchObject({
    version: 1,
    notice: {
      type: "auth_store_reset",
      backupPath: join(input.worktree, ".opencode", "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json"),
    },
  });
});

test("backs up a wrong top-level shape and resets the auth store", async () => {
  const input = await createInput();
  await writeRawStore(input, JSON.stringify(["not", "an", "object"]));

  await expect(
    readSavedAuth(input, {
      now: () => new Date("2026-05-11T10:20:30.000Z"),
    }),
  ).resolves.toMatchObject({
    version: 1,
    notice: {
      type: "auth_store_reset",
      backupPath: join(input.worktree, ".opencode", "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json"),
    },
  });
});

test("backs up a wrong auth shape and resets the auth store", async () => {
  const input = await createInput();
  await writeRawStore(input, JSON.stringify({ version: 1, auth: { access: "a", refresh: "r", expires: "soon" } }));

  await expect(
    readSavedAuth(input, {
      now: () => new Date("2026-05-11T10:20:30.000Z"),
    }),
  ).resolves.toMatchObject({
    version: 1,
    notice: {
      type: "auth_store_reset",
    },
  });
});

test("backs up an invalid persisted notice shape and resets the auth store", async () => {
  const input = await createInput();
  await writeRawStore(input, JSON.stringify({ version: 1, notice: { type: "auth_store_reset" } }));

  await expect(
    readSavedAuth(input, {
      now: () => new Date("2026-05-11T10:20:30.000Z"),
    }),
  ).resolves.toMatchObject({
    version: 1,
    notice: {
      type: "auth_store_reset",
    },
  });
});

test("successful auth writes and explicit clears remove persisted notices", async () => {
  const input = await createInput();
  await writeSavedAuthNotice(input, {
    type: "auth_store_reset",
    message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
    backupPath: join(input.worktree, ".opencode", "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json"),
  });

  await writeSavedAuth(input, {
    access: "access-token",
    refresh: "saved-refresh",
    expires: 12345,
  });
  await expect(readSavedAuth(input)).resolves.toEqual({
    version: 1,
    auth: {
      access: "access-token",
      refresh: "saved-refresh",
      expires: 12345,
    },
  });

  await writeSavedAuthNotice(input, {
    type: "auth_store_reset",
    message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
    backupPath: join(input.worktree, ".opencode", "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json"),
  });
  await clearSavedAuth(input);
  await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
});
```

- [ ] **Step 2: Run store tests to verify failure**

Run:

```bash
bun test test/server-store.test.ts
```

Expected: FAIL because `readSavedAuth` does not accept deps, `writeSavedAuthNotice` does not exist, and corrupt JSON still throws.

- [ ] **Step 3: Implement store validation and recovery**

Replace `src/server/store.ts` with this implementation, preserving existing exported aliases:

```ts
import { mkdir, rename } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import type { SupabaseLogger } from "../shared/log.ts";

type StoreInput = Pick<PluginInput, "directory" | "worktree">;

type StoreDeps = {
  now?: () => Date;
  logger?: Pick<SupabaseLogger, "warn">;
};

export type SavedAuth = {
  access: string;
  refresh: string;
  expires: number;
};

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

export const AUTH_STORE_RESET_MESSAGE =
  "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.";

const STORE_FILE = "supabase-auth.json";

function resolveStoreRoot(input: StoreInput): string {
  const directory = resolve(input.directory);
  if (!input.worktree) {
    return directory;
  }

  const worktree = resolve(input.worktree);
  if (worktree === dirname(worktree)) {
    return directory;
  }

  const pathFromWorktree = relative(worktree, directory);
  if (
    pathFromWorktree === "" ||
    (!pathFromWorktree.startsWith("..") && !pathFromWorktree.startsWith(`..${sep}`))
  ) {
    return worktree;
  }

  return directory;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAuth(value: unknown): SavedAuth {
  if (!isRecord(value)) {
    throw new Error("Invalid Supabase auth store auth shape");
  }
  if (typeof value.access !== "string") {
    throw new Error("Invalid Supabase auth store access token");
  }
  if (typeof value.refresh !== "string") {
    throw new Error("Invalid Supabase auth store refresh value");
  }
  if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) {
    throw new Error("Invalid Supabase auth store expiry");
  }

  return {
    access: value.access,
    refresh: value.refresh,
    expires: value.expires,
  };
}

function normalizeNotice(value: unknown): SavedStateNotice {
  if (!isRecord(value)) {
    throw new Error("Invalid Supabase auth store notice shape");
  }
  if (value.type !== "auth_store_reset") {
    throw new Error("Unsupported Supabase auth store notice type");
  }
  if (typeof value.message !== "string" || typeof value.backupPath !== "string") {
    throw new Error("Invalid Supabase auth store reset notice");
  }

  return {
    type: "auth_store_reset",
    message: value.message,
    backupPath: value.backupPath,
  };
}

function normalizeState(value: unknown): SavedState {
  if (!isRecord(value)) {
    throw new Error("Invalid Supabase auth store shape");
  }
  if (value.version !== 1) {
    throw new Error("Unsupported Supabase auth store version");
  }

  const state: SavedState = { version: 1 };
  if (value.auth !== undefined) {
    state.auth = normalizeAuth(value.auth);
  }
  if (value.notice !== undefined) {
    state.notice = normalizeNotice(value.notice);
  }
  return state;
}

function formatBackupTimestamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function backupFile(path: string, deps: StoreDeps) {
  return join(dirname(path), `supabase-auth.corrupt-${formatBackupTimestamp(deps.now?.() ?? new Date())}.json`);
}

async function writeState(path: string, state: SavedState) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(state, null, 2));
}

async function recoverCorruptStore(path: string, cause: unknown, deps: StoreDeps): Promise<SavedState> {
  const backupPath = backupFile(path, deps);
  await mkdir(dirname(path), { recursive: true });
  await rename(path, backupPath);

  const state: SavedState = {
    version: 1,
    notice: {
      type: "auth_store_reset",
      message: AUTH_STORE_RESET_MESSAGE,
      backupPath,
    },
  };
  await writeState(path, state);

  await deps.logger?.warn("supabase auth store reset", {
    reason: cause instanceof Error ? cause.message : String(cause),
    path,
    backupPath,
  });

  return state;
}

export function file(input: StoreInput): string {
  const root = resolveStoreRoot(input);
  return join(root, ".opencode", STORE_FILE);
}

export async function read(input: StoreInput, deps: StoreDeps = {}): Promise<SavedState> {
  const path = file(input);
  const authFile = Bun.file(path);
  if (!(await authFile.exists())) {
    return { version: 1 };
  }

  try {
    return normalizeState(JSON.parse(await authFile.text()));
  } catch (error) {
    return recoverCorruptStore(path, error, deps);
  }
}

export async function write(input: StoreInput, auth: SavedAuth): Promise<void> {
  await writeState(file(input), { version: 1, auth });
}

export async function writeNotice(input: StoreInput, notice: SavedStateNotice): Promise<void> {
  await writeState(file(input), { version: 1, notice });
}

export async function clear(input: StoreInput): Promise<void> {
  await writeState(file(input), { version: 1 });
}

export const getStoreFile = file;
export const readSavedAuth = read;
export const writeSavedAuth = write;
export const writeSavedAuthNotice = writeNotice;
export const clearSavedAuth = clear;
```

- [ ] **Step 4: Run store tests to verify pass**

Run:

```bash
bun test test/server-store.test.ts
```

Expected: PASS for all store tests.

- [ ] **Step 5: Commit the store slice**

```bash
git add src/server/store.ts test/server-store.test.ts
git commit -m "fix(auth): recover corrupt Supabase auth store"
```

## Task 2: Tool-Call Corruption Notices

PR #51 is already merged on `main`. Preserve its refresh-race behavior while adding corrupt-store notices: keep in-flight refresh dedupe, keep `error.code === "unauthorized"` as the only broker refresh error that clears auth, keep ambiguous broker errors as `Supabase auth refresh failed: ...`, and only use corruption notice formatting when a store read recovers/reset state and returns no auth with `notice`.

**Files:**
- Modify: `src/server/tools.ts`
- Test: `test/server-tools.test.ts`

- [ ] **Step 1: Write failing tool test**

Update the imports in `test/server-tools.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
```

Add `getStoreFile` to the store import:

```ts
import { getStoreFile, readSavedAuth, writeSavedAuth } from "../src/server/store.ts";
```

Add this helper after `createInput()`:

```ts
async function writeRawStore(input: TestPluginInput, contents: string) {
  const path = getStoreFile(input);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return path;
}
```

Add this test inside `describe("server tools auth helper", () => { ... })` near the no-auth test:

```ts
test("tool auth reports corrupt store recovery with backup path", async () => {
  const { input } = await createInput();
  await writeRawStore(input, "{ not json");
  const backupPath = join(input.worktree, ".opencode", "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json");

  await expect(
    ensureSupabaseToolAuth(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17670,
      },
      {
        fetch: mock(async () => new Response("unexpected")),
        now: () => new Date("2026-05-11T10:20:30.000Z"),
      },
    ),
  ).rejects.toThrow(
    `Supabase auth was reset because the local auth store was corrupted.\n\nThe corrupted file was preserved here:\n${backupPath}\n\nRun /supabase to reconnect, then retry this tool.`,
  );

  await expect(readSavedAuth(input)).resolves.toMatchObject({
    version: 1,
    notice: {
      type: "auth_store_reset",
      backupPath,
    },
  });
});
```

- [ ] **Step 2: Run tool tests to verify failure**

Run:

```bash
bun test test/server-tools.test.ts
```

Expected: FAIL because tool deps do not accept `now`, store notices are not formatted for tool errors, and corrupt JSON still throws.

- [ ] **Step 3: Implement tool notice handling**

Update the store import in `src/server/tools.ts`:

```ts
import {
  type SavedAuth,
  type SavedStateNotice,
  clearSavedAuth,
  getStoreFile,
  readSavedAuth,
  writeSavedAuth,
} from "./store.ts";
```

Extend `ToolDeps`:

```ts
type ToolDeps = {
  fetch?: FetchLike;
  logger?: SupabaseLogger;
  now?: () => Date;
};
```

Add this helper near `NOT_CONNECTED_MESSAGE`:

```ts
function formatAuthNoticeForTool(notice: SavedStateNotice) {
  return `${notice.message.replace(" Reconnect to continue.", ".")}\n\nThe corrupted file was preserved here:\n${notice.backupPath}\n\nRun /supabase to reconnect, then retry this tool.`;
}
```

Update `SupabaseAuthStatus` disconnected variant:

```ts
  | {
      status: "disconnected";
      checked: boolean;
      notice?: SavedStateNotice;
    }
```

Update `getSupabaseAuthStatus(...)` to pass store deps and include notices:

```ts
export async function getSupabaseAuthStatus(
  input: SupabaseToolInput,
  options?: PluginOptions,
  deps: ToolDeps = {},
): Promise<SupabaseAuthStatus> {
  const saved = await readSavedAuth(input, { logger: deps.logger, now: deps.now });
  if (!saved.auth) {
    return saved.notice
      ? { status: "disconnected", checked: false, notice: saved.notice }
      : { status: "disconnected", checked: false };
  }

  if (!isRefreshNeeded(saved.auth)) {
    return { status: "connected", auth: saved.auth, checked: false };
  }

  try {
    const auth = await ensureSupabaseToolAuth(input, options, deps);
    return { status: "connected", auth, checked: true };
  } catch (error) {
    const latest = await readSavedAuth(input, { logger: deps.logger, now: deps.now });
    if (!latest.auth && latest.notice) {
      return { status: "disconnected", checked: true, notice: latest.notice };
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message === NOT_CONNECTED_MESSAGE) {
      return { status: "disconnected", checked: true };
    }

    return { status: "unknown", checked: true, message };
  }
}
```

In `ensureSupabaseToolAuth(...)`, change the first no-auth block to:

```ts
const saved = await readSavedAuth(input, { logger: deps.logger, now: deps.now });
if (!saved.auth) {
  throw new Error(saved.notice ? formatAuthNoticeForTool(saved.notice) : NOT_CONNECTED_MESSAGE);
}
```

Change later `readSavedAuth(input)` calls in `ensureSupabaseToolAuth(...)` to pass the same deps:

```ts
const current = await readSavedAuth(input, { logger: deps.logger, now: deps.now });
const latest = await readSavedAuth(input, { logger: deps.logger, now: deps.now });
```

Where a later no-auth branch throws `NOT_CONNECTED_MESSAGE`, preserve a corruption notice when present. This includes the `current` no-auth branch before broker refresh, the post-refresh `latest` no-auth branch, and the `BrokerClientError` catch branch when `latest.auth` is absent:

```ts
throw new Error(latest.notice ? formatAuthNoticeForTool(latest.notice) : NOT_CONNECTED_MESSAGE);
```

Do not change the PR #51 broker error branches except to pass store deps and format notices on no-auth states:

```ts
if (!isSameAuth(latest.auth, current.auth)) {
  if (latest.auth) {
    return latest.auth;
  }
  throw new Error(latest.notice ? formatAuthNoticeForTool(latest.notice) : NOT_CONNECTED_MESSAGE);
}

if (error.code === "unauthorized") {
  await clearSavedAuth(input);
  try {
    await clearHostAuth(input, fetchImpl);
  } catch {}
  throw new Error(NOT_CONNECTED_MESSAGE);
}

throw new Error(`Supabase auth refresh failed: ${error.message}`);
```

- [ ] **Step 4: Run tool tests to verify pass**

Run:

```bash
bun test test/server-tools.test.ts
```

Expected: PASS for tool auth tests.

- [ ] **Step 5: Commit the tool slice**

```bash
git add src/server/tools.ts test/server-tools.test.ts
git commit -m "fix(auth): surface corrupt store notices"
```

## Task 3: Server Auth Status Instructions Include Notices

**Files:**
- Modify: `src/server/auth.ts`
- Test: `test/server-auth.test.ts`

- [ ] **Step 1: Write failing server auth test**

Add `writeSavedAuthNotice` to the store import in `test/server-auth.test.ts`:

```ts
import { readSavedAuth, writeSavedAuth, writeSavedAuthNotice } from "../src/server/store.ts";
```

Add this test after the existing disconnected status test:

```ts
test("status method reports disconnected notice when auth store was reset", async () => {
  const input = await createInput();
  const backupPath = join(input.worktree, ".opencode", "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json");
  await writeSavedAuthNotice(input as never, {
    type: "auth_store_reset",
    message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
    backupPath,
  });

  const auth = createSupabaseAuth(input as never);
  const result = await secondAuthMethod(auth).authorize();

  expect(JSON.parse(result.instructions)).toEqual({
    status: "disconnected",
    checked: false,
    notice: {
      type: "auth_store_reset",
      message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
      backupPath,
    },
  });
});
```

- [ ] **Step 2: Run server auth tests to verify failure**

Run:

```bash
bun test test/server-auth.test.ts
```

Expected: FAIL because status instructions do not include `notice`.

- [ ] **Step 3: Implement notice-aware status instructions**

Update imports in `src/server/auth.ts`:

```ts
import type { SavedStateNotice } from "./store.ts";
import { readSavedAuth, writeSavedAuth } from "./store.ts";
```

Update the disconnected status type:

```ts
  | {
      status: "disconnected";
      checked: false;
      notice?: SavedStateNotice;
    }
```

Change `getStatusInstructions(...)` to accept deps and include notices:

```ts
async function getStatusInstructions(input: Pick<SupabaseAuthInput, "directory" | "worktree">, deps: AuthDeps = {}) {
  const saved = await readSavedAuth(input, { logger: deps.logger });
  if (!saved.auth) {
    return encodeStatusInstructions(
      saved.notice
        ? { status: "disconnected", checked: false, notice: saved.notice }
        : { status: "disconnected", checked: false },
    );
  }

  if (!isRefreshNeeded(saved.auth.expires)) {
    return encodeStatusInstructions({ status: "connected", checked: false });
  }

  return encodeStatusInstructions({ status: "refresh_required", checked: true });
}
```

Update the status authorize call site:

```ts
const instructions = await getStatusInstructions(input, deps);
```

- [ ] **Step 4: Run server auth tests to verify pass**

Run:

```bash
bun test test/server-auth.test.ts
```

Expected: PASS for server auth hook tests.

- [ ] **Step 5: Commit the server auth slice**

```bash
git add src/server/auth.ts test/server-auth.test.ts
git commit -m "fix(auth): include corrupt store notices in status"
```

## Task 4: TUI Persistent Corruption Dialog

**Files:**
- Modify: `src/tui/dialog.tsx`
- Test: `test/plugin-exports.test.ts`

- [ ] **Step 1: Write failing TUI tests**

Add these tests near existing `runAuthPreflight` and dialog state tests in `test/plugin-exports.test.ts`:

```ts
test("supabase auth preflight surfaces corrupt-store notice", async () => {
  const states: Array<Record<string, unknown>> = [];
  const notice = {
    type: "auth_store_reset",
    message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
    backupPath: "/tmp/project/.opencode/supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json",
  };
  const api = createDialogApi({
    client: {
      app: { log: (_input: unknown) => Promise.resolve(true) },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: { promptAsync: () => Promise.resolve({ data: true }) },
      provider: {
        oauth: {
          authorize: ({ method }: { method?: number }) => {
            if (method === 1) {
              return Promise.resolve({
                data: {
                  url: "https://supabase.com/",
                  instructions: JSON.stringify({ status: "disconnected", checked: false, notice }),
                  method: "code",
                },
              });
            }
            return Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } });
          },
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  });

  await runAuthPreflight({
    api: api as never,
    logger: createLogger(),
    setState: (state) => {
      states.push(state as unknown as Record<string, unknown>);
    },
  });

  expect(states).toEqual([{ type: "checking_auth" }, { type: "notice", notice }]);
});

test("supabase dialog notice shows backup path and reconnect action", async () => {
  let authorizeCalls = 0;
  const api = createDialogApi({
    client: {
      app: { log: (_input: unknown) => Promise.resolve(true) },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        create: () => Promise.resolve({ data: { id: "ses-notice" } }),
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: ({ method }: { method?: number }) => {
            authorizeCalls += 1;
            return Promise.resolve({
              data: {
                url: method === 1 ? "https://supabase.com/" : "https://example.com/auth",
                instructions: method === 1 ? JSON.stringify({ status: "disconnected", checked: false }) : "Test",
                method: "manual",
              },
            });
          },
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  });

  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: {
      type: "notice",
      notice: {
        type: "auth_store_reset",
        message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
        backupPath: "/tmp/project/.opencode/supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json",
      },
    },
  }) as { title?: string; message?: string; onConfirm?: () => Promise<void> };

  expect(dialog.title).toBe("Supabase auth reset");
  expect(dialog.message).toContain("local auth store was corrupted");
  expect(dialog.message).toContain("/tmp/project/.opencode/supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json");

  await dialog.onConfirm?.();
  expect(authorizeCalls).toBe(1);
});
```

- [ ] **Step 2: Run TUI tests to verify failure**

Run:

```bash
bun test test/plugin-exports.test.ts
```

Expected: FAIL because `AuthStatus` cannot parse notices and `OAuthState` has no `notice` state.

- [ ] **Step 3: Implement notice parsing and dialog state**

In `src/tui/dialog.tsx`, add notice type near `AuthStatus`:

```ts
type AuthNotice = {
  type: "auth_store_reset";
  message: string;
  backupPath: string;
};
```

Add notice state to `OAuthState`:

```ts
| { type: "notice"; notice: AuthNotice }
```

Update `AuthStatus` disconnected variant:

```ts
| { status: "disconnected"; checked: boolean; notice?: AuthNotice }
```

Add these helpers near `getErrorMessage(...)`:

```ts
function parseAuthNotice(value: unknown): AuthNotice | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const notice = value as Partial<AuthNotice>;
  if (
    notice.type === "auth_store_reset" &&
    typeof notice.message === "string" &&
    typeof notice.backupPath === "string"
  ) {
    return {
      type: "auth_store_reset",
      message: notice.message,
      backupPath: notice.backupPath,
    };
  }

  return undefined;
}

function noticeMessage(notice: AuthNotice) {
  return `${notice.message}\n\nThe corrupted file was preserved here:\n${notice.backupPath}`;
}
```

Update `parseAuthStatus(...)` so disconnected status may include a parsed notice:

```ts
function parseAuthStatus(instructions: string): AuthStatus {
  const parsed = JSON.parse(instructions) as Partial<AuthStatus> & { notice?: unknown };
  if (parsed.status === "connected") {
    return { status: "connected", checked: Boolean(parsed.checked) };
  }
  if (parsed.status === "disconnected") {
    const notice = parseAuthNotice(parsed.notice);
    return notice
      ? { status: "disconnected", checked: Boolean(parsed.checked), notice }
      : { status: "disconnected", checked: Boolean(parsed.checked) };
  }
  if (parsed.status === "refresh_required") {
    return { status: "refresh_required", checked: true };
  }

  throw new Error("Invalid Supabase auth status response");
}
```

In `runAuthPreflight(...)`, change the disconnected branch:

```ts
if (status.status === "disconnected") {
  context.setState(status.notice ? { type: "notice", notice: status.notice } : { type: "idle" });
  return;
}
```

Add a dialog branch before the existing `idle` branch:

```tsx
if (currentState.type === "notice") {
  return props.api.ui.DialogConfirm({
    title: "Supabase auth reset",
    message: `${noticeMessage(currentState.notice)}\n\nReconnect to continue.`,
    onConfirm: startOAuth,
    onCancel: closeDialog,
  });
}
```

- [ ] **Step 4: Run TUI tests to verify pass**

Run:

```bash
bun test test/plugin-exports.test.ts
```

Expected: PASS for existing and new TUI tests.

- [ ] **Step 5: Commit the TUI slice**

```bash
git add src/tui/dialog.tsx test/plugin-exports.test.ts
git commit -m "fix(tui): show corrupt auth store notice"
```

## Task 5: Final Verification

**Files:**
- Verify all modified code and tests

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun test test/server-store.test.ts test/server-tools.test.ts test/server-auth.test.ts test/plugin-exports.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
bun run lint
```

Expected: PASS.

- [ ] **Step 4: Inspect changed files**

Run:

```bash
git status --short
git diff -- src/server/store.ts src/server/tools.ts src/server/auth.ts src/tui/dialog.tsx test/server-store.test.ts test/server-tools.test.ts test/server-auth.test.ts test/plugin-exports.test.ts
```

Expected: only issue #34 implementation files are changed, with no unrelated edits.

- [ ] **Step 5: Commit final verification notes if hooks or formatters changed files**

If verification commands modify files, review the diff and commit those modifications:

```bash
git add src/server/store.ts src/server/tools.ts src/server/auth.ts src/tui/dialog.tsx test/server-store.test.ts test/server-tools.test.ts test/server-auth.test.ts test/plugin-exports.test.ts
git commit -m "test(auth): cover corrupt store recovery"
```

Skip this commit when there are no new changes after the previous task commits.

## Self-Review Checklist

- Spec coverage: store corruption, backup, reset, persistent dialog, tool error, logging, and tests are covered.
- Placeholder scan: plan contains concrete file paths, commands, expected outcomes, and code snippets.
- Type consistency: `SavedStateNotice`, `AuthNotice`, and `auth_store_reset` names are consistent across store, tools, auth, TUI, and tests.
- Scope check: issue #33 behavior, atomic writes, and remote credential revocation remain out of scope for issue #34.
