import { createConnection } from "node:net";
import type { PluginInput, PluginOptions } from "@opencode-ai/plugin";

import { formatAuthError } from "../shared/auth-errors.ts";
import {
  BrokerClientError,
  type BrokerConfig,
  exchangeCodeThroughBroker,
} from "../shared/broker.ts";
import { readSupabaseConfig } from "../shared/cfg.ts";
import type { SupabaseLogger } from "../shared/log.ts";
import { buildAuthorizeUrl, generatePKCE, generateState } from "../shared/oauth.ts";
import type { FetchLike, SupabaseTokenResponse } from "../shared/types.ts";
import { HTML_SUCCESS, htmlError } from "./auth-html.ts";
import type { SavedStateNotice } from "./store.ts";
import { readSavedAuth, writeSavedAuth } from "./store.ts";
import { NOT_CONNECTED_MESSAGE, disconnectSupabaseAuth, ensureSupabaseToolAuth } from "./tools.ts";

const CALLBACK_PATH = "/auth/callback";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const CALLBACK_PORTS = [14589, 14590, 14591] as const;

type PendingAuth = {
  codeVerifier: string;
  redirectUri: string;
  resolve: (result: { tokens: SupabaseTokenResponse; expires: number }) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type AuthDeps = {
  callbackPorts?: number[];
  fetch?: FetchLike;
  logger?: SupabaseLogger;
  setCallbackTimeout?: typeof setTimeout;
};

type SupabaseAuthInput = Pick<PluginInput, "client" | "directory" | "serverUrl" | "worktree">;

type SupabaseStatusInstructions =
  | {
      status: "connected";
      checked: false;
    }
  | {
      status: "disconnected";
      checked: false;
      notice?: SavedStateNotice;
    }
  | {
      status: "refresh_required";
      checked: true;
    };

let server: ReturnType<typeof Bun.serve> | undefined;
let serverPort: number | undefined;
const pendingAuths = new Map<string, PendingAuth>();
const REFRESH_BUFFER_MS = 30_000;

function isRefreshNeeded(expires: number) {
  return expires <= Date.now() + REFRESH_BUFFER_MS;
}

function encodeStatusInstructions(status: SupabaseStatusInstructions) {
  return JSON.stringify(status);
}

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

function callbackUrl(port: number) {
  return `http://localhost:${port}${CALLBACK_PATH}`;
}

function normalizeCallbackPorts(ports: readonly number[]) {
  if (ports.length === 0) {
    throw new Error("Supabase callback ports must not be empty");
  }
  return [...ports];
}

async function isPortInUse(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection(port, "localhost");
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      resolve(false);
    });
  });
}

async function ensureServer(
  callbackPorts: readonly number[],
  _config: ReturnType<typeof readSupabaseConfig>,
  input: Pick<PluginInput, "directory" | "worktree">,
  deps: AuthDeps,
) {
  const candidatePorts = normalizeCallbackPorts(callbackPorts);

  if (server) {
    if (!serverPort || !candidatePorts.includes(serverPort)) {
      throw new Error(`Supabase callback server already running on port ${serverPort}`);
    }
    return serverPort;
  }

  const brokerConfig: BrokerConfig = {
    baseUrl: _config.brokerBaseUrl,
  };

  let selectedPort: number | undefined;
  for (const port of candidatePorts) {
    const portBusy = await isPortInUse(port);
    await deps.logger?.debug("supabase callback port probe", {
      port,
      available: !portBusy,
    });
    if (!portBusy) {
      try {
        server = Bun.serve({
          port,
          async fetch(req) {
            const url = new URL(req.url);
            if (url.pathname !== CALLBACK_PATH) {
              return new Response("Not found", { status: 404 });
            }

            const state = url.searchParams.get("state");
            await deps.logger?.debug("supabase auth callback received", {
              has_state: Boolean(state),
              has_code: Boolean(url.searchParams.get("code")),
              has_error: Boolean(url.searchParams.get("error")),
            });
            if (!state) {
              return new Response(htmlError("Missing required state parameter - potential CSRF attack"), {
                status: 400,
                headers: { "Content-Type": "text/html" },
              });
            }

            const pending = pendingAuths.get(state);
            if (!pending) {
              return new Response(htmlError("Invalid or expired state parameter - potential CSRF attack"), {
                status: 400,
                headers: { "Content-Type": "text/html" },
              });
            }

            const error = url.searchParams.get("error");
            const errorDescription = url.searchParams.get("error_description");
            if (error) {
              clearTimeout(pending.timeout);
              pendingAuths.delete(state);
              await deps.logger?.error("supabase auth failed", {
                reason: "provider_denied",
              });
              pending.reject(new Error(errorDescription || error));
              await stopServerIfIdle(deps.logger, "provider_denied");
              return new Response(htmlError(errorDescription || error), {
                headers: { "Content-Type": "text/html" },
              });
            }

            const code = url.searchParams.get("code");
            if (!code) {
              clearTimeout(pending.timeout);
              pendingAuths.delete(state);
              await deps.logger?.error("supabase auth failed", {
                reason: "missing_code",
              });
              pending.reject(new Error("Missing authorization code"));
              await stopServerIfIdle(deps.logger, "missing_code");
              return new Response(htmlError("Missing authorization code"), {
                status: 400,
                headers: { "Content-Type": "text/html" },
              });
            }

            clearTimeout(pending.timeout);
            pendingAuths.delete(state);

            try {
              const tokens = await exchangeCodeThroughBroker(
                brokerConfig,
                {
                  code,
                  redirect_uri: pending.redirectUri,
                  code_verifier: pending.codeVerifier,
                },
                deps.fetch,
                deps.logger,
              );

              const expires = Date.now() + (tokens.expires_in || 3600) * 1000;
              await writeSavedAuth(input, {
                access: tokens.access_token,
                refresh: tokens.refresh_token,
                expires,
              });

              pending.resolve({ tokens, expires });

              await deps.logger?.info("supabase auth completed", {
                status: "success",
              });

              await stopServerIfIdle(deps.logger, "auth_completed");

              return new Response(HTML_SUCCESS, {
                headers: { "Content-Type": "text/html" },
              });
            } catch (cause) {
              const message = formatAuthError("exchange", cause);

              await deps.logger?.error("supabase auth failed", {
                status: cause instanceof BrokerClientError ? cause.status : 400,
                broker_error: cause instanceof BrokerClientError,
              });

              pending.reject(cause instanceof Error ? cause : new Error(message));
              await stopServerIfIdle(deps.logger, "broker_exchange_failed");

              return new Response(htmlError(message), {
                status: cause instanceof BrokerClientError && cause.status >= 500 ? 502 : 400,
                headers: { "Content-Type": "text/html" },
              });
            }
          },
        });
        selectedPort = port;
        break;
      } catch (error) {
        await deps.logger?.warn("supabase callback server bind failed", {
          port,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (selectedPort === undefined) {
    await deps.logger?.error("supabase callback port window exhausted", {
      ports_tried: candidatePorts,
    });
    throw new Error(
      `Supabase callback ports busy: ${candidatePorts.join(", ")}. Close other OpenCode sessions and retry.`,
    );
  }

  await deps.logger?.info("supabase callback server started", {
    port: selectedPort,
  });

  serverPort = selectedPort;
  return selectedPort;
}

async function stopServerIfIdle(logger?: SupabaseLogger, reason?: string) {
  if (pendingAuths.size > 0 || !server) return;
  const port = serverPort;
  server.stop();
  server = undefined;
  serverPort = undefined;
  await logger?.info("supabase callback server stopped", {
    reason,
    port,
  });
}

function waitForCallback(
  state: string,
  codeVerifier: string,
  redirectUri: string,
  deps: AuthDeps,
) {
  return new Promise<{ tokens: SupabaseTokenResponse; expires: number }>((resolve, reject) => {
    const scheduleTimeout = deps.setCallbackTimeout ?? setTimeout;
    const timeout = scheduleTimeout(() => {
      if (!pendingAuths.has(state)) return;
      pendingAuths.delete(state);
      void deps.logger?.error("supabase auth callback timed out", {
        reason: "timeout",
      });
      void stopServerIfIdle(deps.logger, "timeout");
      reject(new Error("OAuth callback timeout - authorization took too long"));
    }, CALLBACK_TIMEOUT_MS);

    pendingAuths.set(state, {
      codeVerifier,
      redirectUri,
      resolve,
      reject,
      timeout,
    });
  });
}

export function createSupabaseAuth(
  input: SupabaseAuthInput,
  options?: PluginOptions,
  deps: AuthDeps = {},
) {
  const config = readSupabaseConfig(options);
  const authCallbackPorts = normalizeCallbackPorts(deps.callbackPorts ?? CALLBACK_PORTS);

  return {
    provider: "supabase",
    methods: [
      {
        type: "oauth" as const,
        label: "Supabase",
        async authorize() {
          const port = await ensureServer(authCallbackPorts, config, input, deps);
          await deps.logger?.info("supabase auth started", {
            port,
          });
          const pkce = await generatePKCE();
          const state = generateState();
          const redirectUri = callbackUrl(port);
          const callbackPromise = waitForCallback(state, pkce.verifier, redirectUri, deps);

          return {
            url: buildAuthorizeUrl(config, redirectUri, pkce, state),
            instructions: "Complete Supabase authorization in your browser.",
            method: "auto" as const,
            callback: async () => {
              const { tokens, expires } = await callbackPromise;
              return {
                type: "success" as const,
                access: tokens.access_token,
                refresh: tokens.refresh_token,
                expires,
              };
            },
          };
        },
      },
      {
        type: "oauth" as const,
        label: "Supabase Status",
        async authorize(inputs?: Record<string, string>) {
          if (inputs?.action === "disconnect") {
            await disconnectSupabaseAuth(input, { fetch: deps.fetch });
            return {
              url: "https://supabase.com/",
              instructions: encodeStatusInstructions({ status: "disconnected", checked: false }),
              method: "auto" as const,
              callback: async () => ({ type: "failed" as const }),
            };
          }

          const instructions = await getStatusInstructions(input, deps);
          const status = JSON.parse(instructions) as SupabaseStatusInstructions;

          if (status.status !== "refresh_required") {
            return {
              url: "https://supabase.com/",
              instructions,
              method: "auto" as const,
              callback: async () => ({ type: "failed" as const }),
            };
          }

          return {
            url: "https://supabase.com/",
            instructions,
            method: "auto" as const,
            callback: async () => {
              try {
                const auth = await ensureSupabaseToolAuth(input, options, deps);
                return {
                  type: "success" as const,
                  access: auth.access,
                  refresh: auth.refresh,
                  expires: auth.expires,
                };
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message === NOT_CONNECTED_MESSAGE) {
                  return { type: "failed" as const };
                }
                throw error;
              }
            },
          };
        },
      },
    ],
  };
}

export async function stopSupabaseAuthServer() {
  if (server) {
    server.stop();
    server = undefined;
    serverPort = undefined;
  }

  for (const [state, pending] of pendingAuths) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("OAuth callback server stopped"));
    pendingAuths.delete(state);
  }
}
