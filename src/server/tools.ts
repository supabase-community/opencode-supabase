import type { PluginOptions } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import { supabaseManagementApiFetch } from "../shared/api.ts";
import {
  BrokerClientError,
  refreshTokenThroughBroker,
} from "../shared/broker.ts";
import { readSupabaseConfig } from "../shared/cfg.ts";
import type { SupabaseLogger } from "../shared/log.ts";
import type { FetchLike } from "../shared/types.ts";
import {
  type SavedAuth,
  type SavedStateNotice,
  clearSavedAuth,
  getStoreFile,
  readSavedAuth,
  writeSavedAuth,
} from "./store.ts";

type ToolDeps = {
  fetch?: FetchLike;
  logger?: SupabaseLogger;
  now?: () => Date;
};

type InFlightRefresh = {
  promise: Promise<SavedAuth>;
  syncedDirectories: Set<string>;
  syncPromises: Map<string, Promise<void>>;
};

type HostAuthWriter = {
  set(input: {
    path: { id: string };
    query: { directory: string };
    body: {
      type: "oauth";
      access: string;
      refresh: string;
      expires: number;
    };
  }): Promise<unknown>;
};

export type SupabaseToolInput = {
  client: {
    auth: HostAuthWriter;
  };
  directory: string;
  serverUrl: URL;
  worktree: string;
};

type SupabaseToolContext = Pick<
  ToolContext,
  "directory" | "worktree" | "abort" | "sessionID" | "messageID" | "agent" | "metadata" | "ask"
>;

export type SupabaseAuthStatus =
  | {
      status: "connected";
      auth: SavedAuth;
      checked: boolean;
    }
  | {
      status: "disconnected";
      checked: boolean;
      notice?: SavedStateNotice;
    }
  | {
      status: "unknown";
      checked: true;
      message: string;
    };

export const NOT_CONNECTED_MESSAGE = "Supabase is not connected. Run /supabase first.";
const REFRESH_BUFFER_MS = 30_000;
const inFlightRefreshes = new Map<string, InFlightRefresh>();

function formatAuthNoticeForTool(notice: SavedStateNotice) {
  return `${notice.message.replace(". Reconnect to continue.", ".")}\n\nThe corrupted file was preserved here:\n${notice.backupPath}\n\nRun /supabase to reconnect, then retry this tool.`;
}

async function throwAuthNotice(input: SupabaseToolInput, notice: SavedStateNotice, deps: ToolDeps): Promise<never> {
  const fetchImpl = deps.fetch ?? fetch;
  try {
    await clearHostAuth(input, fetchImpl);
  } catch {}
  throw new Error(formatAuthNoticeForTool(notice));
}

function isRefreshNeeded(auth: SavedAuth) {
  return auth.expires <= Date.now() + REFRESH_BUFFER_MS;
}

function isSameAuth(left: SavedAuth | undefined, right: SavedAuth | undefined) {
  if (!left || !right) return left === right;
  return left.access === right.access && left.refresh === right.refresh && left.expires === right.expires;
}

function generateRandomString(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, length);
}

function sanitizeToolArgs(name: string, args: Record<string, unknown>) {
  const next = { ...args };
  if (name === "supabase_create_project" && typeof next.db_pass === "string") {
    next.db_pass = "[redacted]";
  }
  return next;
}

async function executeSupabaseRequest(
  input: SupabaseToolInput,
  options: PluginOptions | undefined,
  deps: ToolDeps,
  toolName: string,
  context: SupabaseToolContext,
  path: string,
  errorLabel: string,
  init?: RequestInit,
) {
  const startedAt = Date.now();
  await deps.logger?.info("supabase tool started", {
    tool: toolName,
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
  });
  try {
    const config = readSupabaseConfig(options);
    const auth = await ensureSupabaseToolAuth(input, options, deps);
    const response = await supabaseManagementApiFetch(
      config,
      auth.access,
      path,
      init,
      deps.fetch,
    );

    await deps.logger?.debug("supabase api response received", {
      tool: toolName,
      path,
      status: response.status,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      await deps.logger?.error("supabase tool failed", {
        tool: toolName,
        path,
        status: response.status,
      });
      throw new Error(`Failed to ${errorLabel}: ${response.status} ${body}`.trim());
    }

    const payload = await response.json();

    await deps.logger?.info("supabase tool completed", {
      tool: toolName,
      duration_ms: Date.now() - startedAt,
    });

    return JSON.stringify(payload, null, 2);
  } catch (error) {
    await deps.logger?.error("supabase tool failed", {
      tool: toolName,
      path,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function executeSupabaseGet(
  input: SupabaseToolInput,
  options: PluginOptions | undefined,
  deps: ToolDeps,
  toolName: string,
  context: SupabaseToolContext,
  path: string,
  errorLabel: string,
) {
  return executeSupabaseRequest(input, options, deps, toolName, context, path, errorLabel);
}

async function setHostAuth(
  input: Pick<SupabaseToolInput, "client" | "directory">,
  auth: SavedAuth,
) {
  await input.client.auth.set({
    path: { id: "supabase" },
    query: { directory: input.directory },
    body: {
      type: "oauth",
      access: auth.access,
      refresh: auth.refresh,
      expires: auth.expires,
    },
  });
}

async function clearHostAuth(
  input: Pick<SupabaseToolInput, "directory" | "serverUrl">,
  fetchImpl: FetchLike,
) {
  const url = new URL(`/auth/supabase?directory=${encodeURIComponent(input.directory)}`, input.serverUrl);
  const response = await fetchImpl(url.toString(), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Failed to clear host auth: ${response.status}`);
  }
}

async function syncHostAuthForDirectory(entry: InFlightRefresh, input: SupabaseToolInput, auth: SavedAuth) {
  if (entry.syncedDirectories.has(input.directory)) {
    return;
  }

  const existing = entry.syncPromises.get(input.directory);
  if (existing) {
    await existing.catch(() => undefined);
    return;
  }

  const syncPromise = (async () => {
    await setHostAuth(input, auth);
    entry.syncedDirectories.add(input.directory);
  })().finally(() => {
    entry.syncPromises.delete(input.directory);
  });

  entry.syncPromises.set(input.directory, syncPromise);
  await syncPromise.catch(() => undefined);
}

export async function disconnectSupabaseAuth(
  input: SupabaseToolInput,
  deps: Pick<ToolDeps, "fetch"> = {},
) {
  const fetchImpl = deps.fetch ?? fetch;
  await clearSavedAuth(input);
  inFlightRefreshes.delete(getStoreFile(input));
  try {
    await clearHostAuth(input, fetchImpl);
  } catch {}
}

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

export async function ensureSupabaseToolAuth(
  input: SupabaseToolInput,
  options?: PluginOptions,
  deps: ToolDeps = {},
): Promise<SavedAuth> {
  const refreshKey = getStoreFile(input);
  const saved = await readSavedAuth(input, { logger: deps.logger, now: deps.now });
  if (!saved.auth) {
    if (saved.notice) {
      await throwAuthNotice(input, saved.notice, deps);
    }
    throw new Error(NOT_CONNECTED_MESSAGE);
  }

  const inFlight = inFlightRefreshes.get(refreshKey);
  if (inFlight) {
    const fetchImpl = deps.fetch ?? fetch;
    try {
      const auth = await inFlight.promise;
      await syncHostAuthForDirectory(inFlight, input, auth);
      return auth;
    } catch (error) {
      if ((error instanceof Error ? error.message : String(error)) === NOT_CONNECTED_MESSAGE) {
        try {
          await clearHostAuth(input, fetchImpl);
        } catch {}
      } else {
        const latest = await readSavedAuth(input, { logger: deps.logger, now: deps.now });
        if (!latest.auth && latest.notice) {
          try {
            await clearHostAuth(input, fetchImpl);
          } catch {}
        }
      }
      throw error;
    }
  }

  if (!isRefreshNeeded(saved.auth)) {
    try {
      await setHostAuth(input, saved.auth);
    } catch {}
    return saved.auth;
  }

  const refreshEntry: InFlightRefresh = {
    promise: Promise.resolve({ access: "", refresh: "", expires: 0 }),
    syncedDirectories: new Set<string>(),
    syncPromises: new Map<string, Promise<void>>(),
  };
  const refreshPromise = (async () => {
    const fetchImpl = deps.fetch ?? fetch;
    const current = await readSavedAuth(input, { logger: deps.logger, now: deps.now });
    if (!current.auth) {
      if (current.notice) {
        await throwAuthNotice(input, current.notice, deps);
      }
      throw new Error(NOT_CONNECTED_MESSAGE);
    }

    if (!isRefreshNeeded(current.auth)) {
      return current.auth;
    }

    const config = readSupabaseConfig(options);

    try {
      const refreshed = await refreshTokenThroughBroker(
        { baseUrl: config.brokerBaseUrl },
        { refresh_token: current.auth.refresh },
        deps.fetch,
        deps.logger,
      );

      const nextAuth: SavedAuth = {
        access: refreshed.access_token,
        refresh: refreshed.refresh_token,
        expires: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
      };

      const latest = await readSavedAuth(input, { logger: deps.logger, now: deps.now });
      if (!latest.auth) {
        if (latest.notice) {
          await throwAuthNotice(input, latest.notice, deps);
        }
        throw new Error(NOT_CONNECTED_MESSAGE);
      }

      if (!isSameAuth(latest.auth, current.auth)) {
        return latest.auth;
      }

      await writeSavedAuth(input, nextAuth);
      return nextAuth;
    } catch (error) {
      if (error instanceof BrokerClientError) {
        const latest = await readSavedAuth(input, { logger: deps.logger, now: deps.now });
        if (!isSameAuth(latest.auth, current.auth)) {
          if (latest.auth) {
            return latest.auth;
          }
          if (latest.notice) {
            await throwAuthNotice(input, latest.notice, deps);
          }
          throw new Error(NOT_CONNECTED_MESSAGE);
        }

        if (error.code === "unauthorized") {
          await clearSavedAuth(input);
          try {
            await clearHostAuth(input, fetchImpl);
          } catch {}
          throw new Error(NOT_CONNECTED_MESSAGE);
        }

        throw new Error(`Supabase auth refresh failed: ${error.message}`);
      }
      throw error;
    }
  })();
  refreshEntry.promise = refreshPromise
    .then(async (auth) => {
      await syncHostAuthForDirectory(refreshEntry, input, auth);
      return auth;
    })
    .finally(() => {
      if (inFlightRefreshes.get(refreshKey)?.promise === refreshEntry.promise) {
        inFlightRefreshes.delete(refreshKey);
      }
    });

  inFlightRefreshes.set(refreshKey, refreshEntry);
  return refreshEntry.promise;
}

export function createSupabaseTools(
  input: SupabaseToolInput,
  options?: PluginOptions,
  deps: ToolDeps = {},
) {
  return {
    supabase_list_organizations: tool({
      description: "List all Supabase organizations for the authenticated user.",
      args: {},
      async execute(_args, _context: SupabaseToolContext) {
        return executeSupabaseGet(
          input,
          options,
          deps,
          "supabase_list_organizations",
          _context,
          "/organizations",
          "list organizations",
        );
      },
    }),
    supabase_list_projects: tool({
      description: "List all Supabase projects for the authenticated user.",
      args: {},
      async execute(_args, _context: SupabaseToolContext) {
        return executeSupabaseGet(
          input,
          options,
          deps,
          "supabase_list_projects",
          _context,
          "/projects",
          "list projects",
        );
      },
    }),
    supabase_list_regions: tool({
      description: "List all available database regions for creating a Supabase project in a specific organization.",
      args: {
        organization_slug: tool.schema.string().describe("Organization slug to list regions for"),
      },
      async execute(args, _context: SupabaseToolContext) {
        return executeSupabaseGet(
          input,
          options,
          deps,
          "supabase_list_regions",
          _context,
          `/projects/available-regions?organization_slug=${encodeURIComponent(args.organization_slug)}`,
          "list regions",
        );
      },
    }),
    supabase_get_project_api_keys: tool({
      description: "Get the API keys for a Supabase project.",
      args: {
        project_ref: tool.schema.string().describe("Project reference ID"),
      },
      async execute(args, _context: SupabaseToolContext) {
        return executeSupabaseGet(
          input,
          options,
          deps,
          "supabase_get_project_api_keys",
          _context,
          `/projects/${args.project_ref}/api-keys`,
          "get API keys",
        );
      },
    }),
    supabase_create_project: tool({
      description: "Create a new Supabase project in an organization.",
      args: {
        organization_id: tool.schema.string().describe("Organization ID to create the project in"),
        name: tool.schema.string().describe("Project name"),
        region: tool.schema.string().describe("Database region").optional(),
        db_pass: tool.schema.string().describe("Database password").optional(),
      },
      async execute(args, _context: SupabaseToolContext) {
        await deps.logger?.debug("supabase tool args prepared", {
          tool: "supabase_create_project",
          args: sanitizeToolArgs("supabase_create_project", args),
        });
        return executeSupabaseRequest(
          input,
          options,
          deps,
          "supabase_create_project",
          _context,
          "/projects",
          "create project",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organization_id: args.organization_id,
              name: args.name,
              region: args.region ?? "us-east-1",
              db_pass: args.db_pass ?? generateRandomString(32),
            }),
          },
        );
      },
    }),
    supabase_login: tool({
      description: "Explain how to connect Supabase in the TUI.",
      args: {},
      async execute(_args, _context: SupabaseToolContext) {
        return "Supabase login must be completed in the TUI. Run /supabase first.";
      },
    }),
  };
}
