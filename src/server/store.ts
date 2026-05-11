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

const STORE_FILE = "supabase-auth.json";
const AUTH_STORE_RESET_MESSAGE = "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.";
const inFlightRecoveries = new Map<string, Promise<SavedState>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAuth(value: unknown): SavedAuth | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("Invalid Supabase auth store auth shape");
  }

  if (
    typeof value.access !== "string" ||
    typeof value.refresh !== "string" ||
    typeof value.expires !== "number" ||
    !Number.isFinite(value.expires)
  ) {
    throw new Error("Invalid Supabase auth store auth shape");
  }

  return {
    access: value.access,
    refresh: value.refresh,
    expires: value.expires,
  };
}

function normalizeNotice(value: unknown): SavedStateNotice | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("Invalid Supabase auth store notice shape");
  }

  if (
    value.type !== "auth_store_reset" ||
    typeof value.message !== "string" ||
    typeof value.backupPath !== "string"
  ) {
    throw new Error("Invalid Supabase auth store notice shape");
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

  const auth = normalizeAuth(value.auth);
  const notice = normalizeNotice(value.notice);

  return {
    version: 1,
    ...(auth ? { auth } : {}),
    ...(notice ? { notice } : {}),
  };
}

function backupFile(path: string, now: () => Date) {
  const timestamp = now().toISOString().replace(/[:.]/g, "-");
  return join(dirname(path), `supabase-auth.corrupt-${timestamp}.json`);
}

async function writeState(path: string, state: SavedState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(state, null, 2));
}

async function recoverCorruptStoreOnce(path: string, error: unknown, deps: StoreDeps): Promise<SavedState> {
  const existing = inFlightRecoveries.get(path);
  if (existing) return existing;

  const recovery = (async () => {
    try {
      const backupPath = backupFile(path, deps.now ?? (() => new Date()));
      const state: SavedState = {
        version: 1,
        notice: {
          type: "auth_store_reset",
          message: AUTH_STORE_RESET_MESSAGE,
          backupPath,
        },
      };

      await mkdir(dirname(path), { recursive: true });
      await rename(path, backupPath);
      await writeState(path, state);
      await deps.logger?.warn("supabase auth store reset", {
        reason: error instanceof Error ? error.message : String(error),
        path,
        backupPath,
      });

      return state;
    } finally {
      inFlightRecoveries.delete(path);
    }
  })();

  inFlightRecoveries.set(path, recovery);
  return recovery;
}

// Use worktree only when it is non-root and directory is equal to or inside it;
// otherwise fall back to the session directory.
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
    return recoverCorruptStoreOnce(path, error, deps);
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
