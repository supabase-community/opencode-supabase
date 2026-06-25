import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";

import {
  type SavedState,
  clearSavedAuth,
  getStoreFile,
  readSavedAuth,
  writeSavedAuth,
  writeSavedAuthNotice,
} from "../src/server/store.ts";

type PluginLikeInput = {
  directory: string;
  worktree: string;
};

const cleanupPaths: string[] = [];

async function createInput(): Promise<PluginLikeInput> {
  const root = await mkdtemp(join(tmpdir(), "opencode-supabase-store-"));
  cleanupPaths.push(root);
  return {
    directory: join(root, "packages", "consumer"),
    worktree: root,
  };
}

async function writeRawStore(input: PluginLikeInput, contents: string) {
  const path = getStoreFile(input);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return path;
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("server auth store", () => {
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

  test("concurrent corrupt-store reads share one recovery", async () => {
    const input = await createInput();
    const path = await writeRawStore(input, "{ not json");
    const warn = mock(async () => undefined);
    const backupPath = join(
      input.worktree,
      ".opencode",
      "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json",
    );
    const deps = {
      now: () => new Date("2026-05-11T10:20:30.000Z"),
      logger: { warn },
    };

    const [a, b] = await Promise.all([
      readSavedAuth(input, deps),
      readSavedAuth(input, deps),
    ]);

    const expected: SavedState = {
      version: 1,
      notice: {
        type: "auth_store_reset",
        message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
        backupPath,
      },
    };
    expect(a).toEqual(expected);
    expect(b).toEqual(expected);

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

  test("avoids overwriting an existing backup by appending a counter", async () => {
    const input = await createInput();
    const path = await writeRawStore(input, "{ not json");
    const existingBackup = join(
      input.worktree,
      ".opencode",
      "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json",
    );
    await mkdir(dirname(existingBackup), { recursive: true });
    await writeFile(existingBackup, "existing backup");

    const state = await readSavedAuth(input, {
      now: () => new Date("2026-05-11T10:20:30.000Z"),
    });

    expect(state.notice?.backupPath).toBe(
      join(input.worktree, ".opencode", "supabase-auth.corrupt-2026-05-11T10-20-30-000Z-1.json"),
    );
    await expect(readFile(existingBackup, "utf8")).resolves.toBe("existing backup");
  });

  test("waits for another process to recover when lock is held", async () => {
    const input = await createInput();
    const path = await writeRawStore(input, "{ not json");
    const lockPath = `${path}.recovering.lock`;
    await mkdir(dirname(lockPath), { recursive: true });
    // Write a lock with recent startedAt to simulate an active process
    await writeFile(lockPath, JSON.stringify({ startedAt: Date.now() }));

    const readPromise = readSavedAuth(input, {
      now: () => new Date("2026-05-11T10:20:30.000Z"),
    });

    // simulate another process finishing recovery
    await new Promise((resolve) => setTimeout(resolve, 100));
    const backupPath = join(input.worktree, ".opencode", "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json");
    const recoveredState: SavedState = {
      version: 1,
      notice: {
        type: "auth_store_reset",
        message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
        backupPath,
      },
    };
    await writeFile(path, JSON.stringify(recoveredState));
    await rm(lockPath, { force: true });

    await expect(readPromise).resolves.toEqual(recoveredState);
  });

  test("waits for another process when store is temporarily missing under recovery lock", async () => {
    const input = await createInput();
    const path = getStoreFile(input);
    const lockPath = `${path}.recovering.lock`;
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ startedAt: Date.now() }));

    const readPromise = readSavedAuth(input, {
      now: () => new Date("2026-05-11T10:20:30.000Z"),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const backupPath = join(input.worktree, ".opencode", "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json");
    const recoveredState: SavedState = {
      version: 1,
      notice: {
        type: "auth_store_reset",
        message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
        backupPath,
      },
    };
    await writeFile(path, JSON.stringify(recoveredState));
    await rm(lockPath, { force: true });

    await expect(readPromise).resolves.toEqual(recoveredState);
  });

  test("recovers again after waiting-on-lock read completes", async () => {
    const input = await createInput();
    const path = await writeRawStore(input, "{ not json");
    const lockPath = `${path}.recovering.lock`;
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ startedAt: Date.now() }));

    const readPromise = readSavedAuth(input, {
      now: () => new Date("2026-05-11T10:20:30.000Z"),
    });

    // simulate another process finishing recovery
    await new Promise((resolve) => setTimeout(resolve, 100));
    const backupPath = join(
      input.worktree,
      ".opencode",
      "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json",
    );
    const recoveredState: SavedState = {
      version: 1,
      notice: {
        type: "auth_store_reset",
        message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
        backupPath,
      },
    };
    await writeFile(path, JSON.stringify(recoveredState));
    await rm(lockPath, { force: true });

    await expect(readPromise).resolves.toEqual(recoveredState);

    // corrupt again and recover a second time to prove inFlightRecoveries was cleaned up
    await writeRawStore(input, "also not json");
    const secondBackupPath = join(
      input.worktree,
      ".opencode",
      "supabase-auth.corrupt-2026-05-11T10-20-31-000Z.json",
    );

    const secondState = await readSavedAuth(input, {
      now: () => new Date("2026-05-11T10:20:31.000Z"),
    });

    expect(secondState).toEqual({
      version: 1,
      notice: {
        type: "auth_store_reset",
        message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
        backupPath: secondBackupPath,
      },
    });

    await expect(readFile(secondBackupPath, "utf8")).resolves.toBe("also not json");
  });

  test("takes over a stale recovery lock and performs recovery", async () => {
    const input = await createInput();
    const path = await writeRawStore(input, "{ not json");
    const lockPath = `${path}.recovering.lock`;
    await mkdir(dirname(lockPath), { recursive: true });
    // Write a stale lock (startedAt far in the past relative to real wall clock)
    const staleStartedAt = Date.now() - 20_000;
    await writeFile(lockPath, JSON.stringify({ startedAt: staleStartedAt, token: "stale-owner" }));

    const backupPath = join(
      input.worktree,
      ".opencode",
      "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json",
    );

    const state = await readSavedAuth(input, {
      now: () => new Date("2026-05-11T10:20:30.000Z"),
    });

    expect(state).toEqual({
      version: 1,
      notice: {
        type: "auth_store_reset",
        message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
        backupPath,
      },
    });

    await expect(readFile(path, "utf8")).resolves.toContain("auth_store_reset");
    await expect(readFile(backupPath, "utf8")).resolves.toBe("{ not json");
    await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
  });

  test("takes over a malformed recovery lock and performs recovery", async () => {
    const input = await createInput();
    const path = await writeRawStore(input, "{ not json");
    const lockPath = `${path}.recovering.lock`;
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ startedAt: "not-a-number", token: "bad-owner" }));

    const backupPath = join(
      input.worktree,
      ".opencode",
      "supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json",
    );

    const state = await readSavedAuth(input, {
      now: () => new Date("2026-05-11T10:20:30.000Z"),
    });

    expect(state).toEqual({
      version: 1,
      notice: {
        type: "auth_store_reset",
        message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
        backupPath,
      },
    });

    await expect(readFile(backupPath, "utf8")).resolves.toBe("{ not json");
    await expect(Bun.file(lockPath).exists()).resolves.toBe(false);
  });

  test("stores auth in a plugin-owned file under the worktree .opencode directory", async () => {
    const input = await createInput();

    expect(getStoreFile(input)).toBe(join(input.worktree, ".opencode", "supabase-auth.json"));
  });

  test("reads empty state before any auth is written", async () => {
    const input = await createInput();

    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
  });

  test("writes and reads back saved auth tokens", async () => {
    const input = await createInput();

    await writeSavedAuth(input, {
      access: "access-token",
      refresh: "refresh-token",
      expires: 12345,
    });

    await expect(readSavedAuth(input)).resolves.toEqual({
      version: 1,
      auth: {
        access: "access-token",
        refresh: "refresh-token",
        expires: 12345,
      },
    });
  });

  test("clears persisted auth without deleting the store version", async () => {
    const input = await createInput();

    await writeSavedAuth(input, {
      access: "access-token",
      refresh: "refresh-token",
      expires: 12345,
    });
    await clearSavedAuth(input);

    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
  });

  test("falls back to the session directory when worktree is unavailable", async () => {
    const input = await createInput();

    expect(getStoreFile({ ...input, worktree: "" })).toBe(
      join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });

  test("falls back to the session directory when worktree resolves to root", async () => {
    const input = await createInput();

    expect(getStoreFile({ ...input, worktree: "/" })).toBe(
      join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });

  test("falls back to the session directory when worktree is unrelated", async () => {
    const input = await createInput();

    expect(getStoreFile({ ...input, worktree: resolve(input.worktree, "..", "unrelated") })).toBe(
      join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });

  test("stores auth under the worktree when a child path segment starts with dots", async () => {
    const input = await createInput();
    input.directory = join(input.worktree, "..cache", "package");

    expect(getStoreFile(input)).toBe(join(input.worktree, ".opencode", "supabase-auth.json"));
  });

  test("falls back to the session directory when worktree is nested inside the directory", async () => {
    const input = await createInput();

    expect(getStoreFile({ ...input, worktree: join(input.directory, "nested") })).toBe(
      join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });

  test("stores auth under a Windows drive-letter worktree when the directory is inside it", () => {
    const input = {
      directory: "C:\\Users\\Peter\\project\\packages\\consumer",
      worktree: "C:\\Users\\Peter\\project",
    };

    expect(getStoreFile(input)).toBe(
      win32.join(input.worktree, ".opencode", "supabase-auth.json"),
    );
  });

  test("falls back to the session directory when a Windows drive-letter worktree resolves to root", () => {
    const input = {
      directory: "C:\\Users\\Peter\\session",
      worktree: "C:\\",
    };

    expect(getStoreFile(input)).toBe(
      win32.join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });

  test("handles Windows UNC worktrees and avoids using the UNC share root", () => {
    const input = {
      directory: "\\\\server\\share\\project\\packages\\consumer",
      worktree: "\\\\server\\share\\project",
    };

    expect(getStoreFile(input)).toBe(
      win32.join(input.worktree, ".opencode", "supabase-auth.json"),
    );

    expect(getStoreFile({ ...input, worktree: "\\\\server\\share" })).toBe(
      win32.join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });

  test("handles Windows extended-length paths and avoids using the extended UNC share root", () => {
    const input = {
      directory: "\\\\?\\C:\\Users\\Peter\\project\\packages\\consumer",
      worktree: "\\\\?\\C:\\Users\\Peter\\project",
    };

    expect(getStoreFile(input)).toBe(
      win32.join(input.worktree, ".opencode", "supabase-auth.json"),
    );

    expect(getStoreFile({ ...input, worktree: "\\\\?\\UNC\\server\\share" })).toBe(
      win32.join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });

  test("treats POSIX double-slash paths as POSIX instead of Windows UNC", () => {
    // On a Windows host pathApiFor always selects win32, so this regression
    // only asserts the POSIX code path where process.platform !== "win32".
    if (process.platform === "win32") return;

    const input = {
      directory: "//server/share/project/packages/consumer",
      worktree: "//server/share/project",
    };

    // path.posix.resolve collapses the leading double slash to a single slash.
    expect(getStoreFile(input)).toBe(
      "/server/share/project/.opencode/supabase-auth.json",
    );
  });

  test("treats forward-slash Windows drive-letter paths as Windows paths", () => {
    const input = {
      directory: "C:/Users/Peter/project/packages/consumer",
      worktree: "C:/Users/Peter/project",
    };

    expect(getStoreFile(input)).toBe(
      win32.join(input.worktree, ".opencode", "supabase-auth.json"),
    );
  });
});
