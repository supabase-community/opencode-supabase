import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
    await writeFile(lockPath, "");

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

  test("falls back to the session directory when worktree is nested inside the directory", async () => {
    const input = await createInput();

    expect(getStoreFile({ ...input, worktree: join(input.directory, "nested") })).toBe(
      join(input.directory, ".opencode", "supabase-auth.json"),
    );
  });
});
