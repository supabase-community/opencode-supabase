import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createSupabaseAuth, stopSupabaseAuthServer } from "../src/server/auth.ts";
import { readSavedAuth, writeSavedAuth, writeSavedAuthNotice } from "../src/server/store.ts";
import { createSupabaseLogger } from "../src/shared/log.ts";
import type { FetchLike } from "../src/shared/types.ts";

const cleanupPaths: string[] = [];
const occupiedPorts: Array<ReturnType<typeof Bun.serve>> = [];
const originalBrokerUrl = process.env.OPENCODE_SUPABASE_BROKER_URL;

async function createInput() {
  const root = await mkdtemp(join(tmpdir(), "opencode-supabase-auth-"));
  cleanupPaths.push(root);
  return {
    client: {
      auth: {
        set: mock(async () => true),
      },
    },
    directory: join(root, "consumer"),
    serverUrl: new URL("http://127.0.0.1:7777/"),
    worktree: root,
  };
}

function firstAuthMethod(auth: ReturnType<typeof createSupabaseAuth>) {
  const method = auth.methods[0];
  if (!method) throw new Error("Expected an auth method");
  return method;
}

function secondAuthMethod(auth: ReturnType<typeof createSupabaseAuth>) {
  const method = auth.methods[1];
  if (!method) throw new Error("Expected a status auth method");
  return method;
}

function requireSearchParam(url: URL, key: string) {
  const value = url.searchParams.get(key);
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function occupyPort(port: number) {
  const server = Bun.serve({
    port,
    fetch() {
      return new Response("busy");
    },
  });
  occupiedPorts.push(server);
  return server;
}

afterEach(async () => {
  await stopSupabaseAuthServer();
  for (const server of occupiedPorts.splice(0)) {
    server.stop();
  }
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  if (originalBrokerUrl === undefined) {
    process.env.OPENCODE_SUPABASE_BROKER_URL = undefined;
  } else {
    process.env.OPENCODE_SUPABASE_BROKER_URL = originalBrokerUrl;
  }
});

describe("server auth hook", () => {
  test("exposes status method alongside connect oauth", async () => {
    const input = await createInput();

    const auth = createSupabaseAuth(input as never);

    expect(auth.methods).toHaveLength(2);
    expect(auth.methods[0]).toMatchObject({ type: "oauth", label: "Supabase" });
    expect(auth.methods[1]).toMatchObject({ type: "oauth", label: "Supabase Status" });
  });

  test("status method reports disconnected when no saved auth exists", async () => {
    const input = await createInput();

    const auth = createSupabaseAuth(input as never);
    const result = await secondAuthMethod(auth).authorize();

    expect(JSON.parse(result.instructions)).toEqual({
      status: "disconnected",
      checked: false,
    });
  });

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

  test("status method reports refresh_required when saved auth is stale", async () => {
    const input = await createInput();
    await writeSavedAuth(input as never, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const auth = createSupabaseAuth(input as never);
    const result = await secondAuthMethod(auth).authorize();

    expect(JSON.parse(result.instructions)).toEqual({
      status: "refresh_required",
      checked: true,
    });
  });

  test("status method disconnect action clears saved auth", async () => {
    const input = await createInput();
    await writeSavedAuth(input as never, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const auth = createSupabaseAuth(input as never);
    const result = await secondAuthMethod(auth).authorize({ action: "disconnect" });

    expect(JSON.parse(result.instructions)).toEqual({
      status: "disconnected",
      checked: false,
    });
    expect(await readSavedAuth(input as never)).toEqual({ version: 1 });
  });

  test("status method refresh callback reports failed when refresh token is invalid", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input as never, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const auth = createSupabaseAuth(
      input as never,
      undefined,
      {
        fetch: mock(async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "unauthorized",
                message: "Refresh token expired",
              },
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ) as never,
      },
    );

    const result = await secondAuthMethod(auth).authorize();

    expect(JSON.parse(result.instructions)).toEqual({
      status: "refresh_required",
      checked: true,
    });
    await expect(result.callback?.()).resolves.toEqual({ type: "failed" });
  });

  test("logs auth authorize and callback completion without secrets", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const write = mock(async () => true);
    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17657,
      },
      {
        fetch: mock(async () =>
          new Response(
            JSON.stringify({
              access_token: "access-123",
              refresh_token: "refresh-123",
              expires_in: 1800,
              token_type: "bearer",
            }),
          ),
        ) as never,
        logger: createSupabaseLogger({ write }),
        callbackPorts: [17658, 17659, 17660],
      },
    );

    const result = await firstAuthMethod(auth).authorize();
    const authUrl = new URL(result.url);
    const redirectUri = new URL(requireSearchParam(authUrl, "redirect_uri"));
    const state = requireSearchParam(authUrl, "state");

    const pending = result.callback();
    await fetch(`${redirectUri.toString()}?code=code-123&state=${state}`);
    await pending;

    const logEntries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));

    expect(logEntries.some((entry) => entry.includes("supabase auth started"))).toBe(true);
    expect(logEntries.some((entry) => entry.includes("supabase auth completed"))).toBe(true);
    expect(logEntries.join(" ")).not.toContain("code-123");
    expect(logEntries.join(" ")).not.toContain("refresh-123");
  });

  test("logs broker failures without leaking oauth code", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const write = mock(async () => true);
    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17658,
      },
      {
        fetch: mock(async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "invalid_request",
                message: "redirect_uri not allowed",
              },
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ) as never,
        logger: createSupabaseLogger({ write }),
      },
    );

    const result = await firstAuthMethod(auth).authorize();
    const authUrl = new URL(result.url);
    const redirectUri = new URL(requireSearchParam(authUrl, "redirect_uri"));
    const state = requireSearchParam(authUrl, "state");

    const pending = result.callback();
    pending.catch(() => undefined);
    const response = await fetch(`${redirectUri.toString()}?code=code-123&state=${state}`);
    await expect(pending).rejects.toThrow("redirect_uri not allowed");

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("redirect_uri not allowed");

    const logEntries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));

    expect(logEntries.some((entry) => entry.includes("supabase broker exchange failed"))).toBe(true);
    expect(logEntries.join(" ")).not.toContain("code-123");
  });

  test("logs oauth provider denial without leaking callback values", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const write = mock(async () => true);
    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17659,
      },
      {
        logger: createSupabaseLogger({ write }),
        callbackPorts: [17659, 17660, 17661],
      },
    );

    const result = await firstAuthMethod(auth).authorize();
    const authUrl = new URL(result.url);
    const redirectUri = new URL(requireSearchParam(authUrl, "redirect_uri"));
    const state = requireSearchParam(authUrl, "state");

    const pending = result.callback();
    pending.catch(() => undefined);
    await fetch(`${redirectUri.toString()}?error=access_denied&error_description=User%20denied&state=${state}`);
    await expect(pending).rejects.toThrow("User denied");

    const logEntries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));
    expect(logEntries.some((entry) => entry.includes("supabase auth failed"))).toBe(true);
    expect(logEntries.join(" ")).not.toContain("access_denied");
  });

  test("logs callback timeout failures", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const write = mock(async () => true);
    const timer = { ref() { return timer; }, unref() { return timer; } } as unknown as ReturnType<typeof setTimeout>;

    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17660,
      },
      {
        logger: createSupabaseLogger({ write }),
        setCallbackTimeout: ((callback: (...args: Array<unknown>) => void) => {
          queueMicrotask(() => callback());
          return timer;
        }) as typeof setTimeout,
        callbackPorts: [17660, 17661, 17662],
      },
    );

    const result = await firstAuthMethod(auth).authorize();
    await expect(result.callback()).rejects.toThrow("OAuth callback timeout - authorization took too long");

    const logEntries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));
    expect(logEntries.some((entry) => entry.includes("supabase auth callback timed out"))).toBe(true);
    expect(logEntries.some((entry) => entry.includes("supabase callback server stopped"))).toBe(true);
  });

  test("falls back to next callback port when base port is busy", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    occupyPort(17670);
    const write = mock(async () => true);
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://example.com/broker/exchange");
      const body = JSON.parse(String(init?.body));
      expect(body.redirect_uri).toBe("http://localhost:17671/auth/callback");

      return new Response(
        JSON.stringify({
          access_token: "access-123",
          refresh_token: "refresh-123",
          expires_in: 1800,
          token_type: "bearer",
        }),
      );
    });

    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17670,
      },
      {
        fetch: fetchMock as unknown as FetchLike,
        logger: createSupabaseLogger({ write }),
        callbackPorts: [17670, 17671, 17672],
      },
    );

    const result = await firstAuthMethod(auth).authorize();
    const authUrl = new URL(result.url);
    const redirectUri = new URL(requireSearchParam(authUrl, "redirect_uri"));
    const state = requireSearchParam(authUrl, "state");

    expect(redirectUri.toString()).toBe("http://localhost:17671/auth/callback");

    const pending = result.callback();
    const response = await fetch(`${redirectUri.toString()}?code=code-123&state=${state}`);

    expect(response.status).toBe(200);
    await expect(pending).resolves.toMatchObject({
      type: "success",
      access: "access-123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const logEntries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));
    expect(logEntries.some((entry) => entry.includes("supabase callback port probe") && entry.includes('"port":17670'))).toBe(true);
    expect(logEntries.some((entry) => entry.includes("supabase callback port probe") && entry.includes('"port":17671'))).toBe(true);
    expect(logEntries.some((entry) => entry.includes("supabase auth started") && entry.includes('"port":17671'))).toBe(true);
    expect(logEntries.some((entry) => entry.includes("supabase callback server stopped"))).toBe(true);
  });

  test("fails clearly when callback port window is exhausted", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    occupyPort(17680);
    occupyPort(17681);
    occupyPort(17682);
    const write = mock(async () => true);

    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17680,
      },
      {
        logger: createSupabaseLogger({ write }),
        callbackPorts: [17680, 17681, 17682],
      },
    );

    await expect(firstAuthMethod(auth).authorize()).rejects.toThrow(
      "Supabase callback ports busy: 17680, 17681, 17682. Close other OpenCode sessions and retry.",
    );

    const logEntries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));
    expect(logEntries.some((entry) => entry.includes("supabase callback port window exhausted"))).toBe(true);
  });

  test("builds an auto oauth authorize result using the plugin callback server", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17654,
      },
      {
        fetch: mock(async () =>
          new Response(
            JSON.stringify({
              access_token: "a",
              refresh_token: "r",
              expires_in: 3600,
              token_type: "bearer",
            }),
          ),
        ) as never,
        callbackPorts: [17654, 17655, 17656],
      },
    );

    const result = await firstAuthMethod(auth).authorize();
    void result?.callback().catch(() => undefined);

    expect(result?.method).toBe("auto");
    expect(result?.instructions).toContain("browser");

    const url = new URL(String(result?.url));
    expect(url.origin + url.pathname).toBe("https://api.supabase.com/v1/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("plugin-client");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:17654/auth/callback");
    expect(typeof result?.callback).toBe("function");
  });

  test("uses fixed public callback window even when oauthPort config differs", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 19999,
      },
      {
        fetch: mock(async () =>
          new Response(
            JSON.stringify({
              access_token: "a",
              refresh_token: "r",
              expires_in: 3600,
              token_type: "bearer",
            }),
          ),
        ) as never,
      },
    );

    const result = await firstAuthMethod(auth).authorize();
    void result.callback().catch(() => undefined);
    const redirectUri = requireSearchParam(new URL(result.url), "redirect_uri");

    expect([
      "http://localhost:14589/auth/callback",
      "http://localhost:14590/auth/callback",
      "http://localhost:14591/auth/callback",
    ]).toContain(redirectUri);
    expect(redirectUri).not.toContain(":19999/");
  });

  test("rejects callback requests with missing state", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17655,
      },
      {
        fetch: mock(async () =>
          new Response(
            JSON.stringify({
              access_token: "a",
              refresh_token: "r",
              expires_in: 3600,
              token_type: "bearer",
            }),
          ),
        ) as never,
      },
    );

    const result = await firstAuthMethod(auth).authorize();
    void result?.callback().catch(() => undefined);
    const redirectUri = new URL(requireSearchParam(new URL(String(result.url)), "redirect_uri"));

    const response = await fetch(`${redirectUri.toString()}?code=code-123`);
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain("Missing required state parameter");
  });

  test("exchanges the callback code via broker, persists plugin-owned auth, and returns host oauth fields", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      // Verify it's calling the broker /exchange endpoint
      expect(url).toBe("https://example.com/broker/exchange");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/json",
        Accept: "application/json",
      });

      const body = JSON.parse(String(init?.body));
      expect(body.code).toBe("code-123");
      expect(body.code_verifier).toBeTruthy();
      expect(body.redirect_uri).toBe("http://localhost:17656/auth/callback");

      return new Response(
        JSON.stringify({
          access_token: "access-123",
          refresh_token: "refresh-123",
          expires_in: 1800,
          token_type: "bearer",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17656,
      },
      { fetch: fetchMock as unknown as FetchLike, callbackPorts: [17656, 17657, 17658] },
    );

    const result = await firstAuthMethod(auth).authorize();
    const authUrl = new URL(result.url);
    const redirectUri = new URL(requireSearchParam(authUrl, "redirect_uri"));
    const state = requireSearchParam(authUrl, "state");

    const pending = result.callback();
    const response = await fetch(`${redirectUri.toString()}?code=code-123&state=${state}`);

    expect(response.status).toBe(200);

    const callbackResult = await pending;
    expect(callbackResult).toMatchObject({
      type: "success",
      access: "access-123",
      refresh: "refresh-123",
    });
    if (callbackResult.type !== "success") {
      throw new Error("Expected OAuth callback to succeed");
    }
    expect(typeof callbackResult.expires).toBe("number");
    expect(callbackResult.expires).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(readSavedAuth(input as never)).resolves.toEqual({
      version: 1,
      auth: {
        access: "access-123",
        refresh: "refresh-123",
        expires: callbackResult.expires,
      },
    });
  });

  test("stops callback listener after provider denial when no auth remains", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const write = mock(async () => true);
    const auth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17683,
      },
      {
        logger: createSupabaseLogger({ write }),
        callbackPorts: [17683, 17684, 17685],
      },
    );

    const result = await firstAuthMethod(auth).authorize();
    const redirectUri = new URL(requireSearchParam(new URL(result.url), "redirect_uri"));
    const state = requireSearchParam(new URL(result.url), "state");

    const pending = result.callback();
    pending.catch(() => undefined);
    await fetch(`${redirectUri.toString()}?error=access_denied&error_description=User%20denied&state=${state}`);
    await expect(pending).rejects.toThrow("User denied");

    const nextAuth = createSupabaseAuth(
      input as never,
      {
        clientId: "plugin-client",
        oauthPort: 17683,
      },
      {
        logger: createSupabaseLogger({ write }),
        callbackPorts: [17683, 17684, 17685],
      },
    );
    const nextResult = await firstAuthMethod(nextAuth).authorize();
    void nextResult.callback().catch(() => undefined);
    expect(nextResult).toBeTruthy();

    const logEntries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));
    expect(logEntries.some((entry) => entry.includes("supabase callback server stopped"))).toBe(true);
  });

  test("persists oauth auth under the session directory when host worktree resolves to root", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const fetchMock = mock(async () =>
      new Response(
        JSON.stringify({
          access_token: "access-123",
          refresh_token: "refresh-123",
          expires_in: 1800,
          token_type: "bearer",
        }),
      )
    );

    const auth = createSupabaseAuth(
      { ...input, worktree: "/" } as never,
      {
        clientId: "plugin-client",
        oauthPort: 17661,
      },
      { fetch: fetchMock as unknown as FetchLike, callbackPorts: [17661, 17662, 17663] },
    );

    const result = await firstAuthMethod(auth).authorize();
    const authUrl = new URL(result.url);
    const redirectUri = new URL(requireSearchParam(authUrl, "redirect_uri"));
    const state = requireSearchParam(authUrl, "state");

    const pending = result.callback();
    const response = await fetch(`${redirectUri.toString()}?code=code-123&state=${state}`);

    expect(response.status).toBe(200);

    const callbackResult = await pending;
    expect(callbackResult).toMatchObject({
      type: "success",
      access: "access-123",
      refresh: "refresh-123",
    });
    if (callbackResult.type !== "success") {
      throw new Error("Expected OAuth callback to succeed");
    }
    expect(typeof callbackResult.expires).toBe("number");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(readSavedAuth({ ...input, worktree: "/" } as never)).resolves.toEqual({
      version: 1,
      auth: {
        access: "access-123",
        refresh: "refresh-123",
        expires: callbackResult.expires,
      },
    });
  });

  test("persists oauth auth under the session directory when host worktree is unrelated", async () => {
    const input = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const fetchMock = mock(async () =>
      new Response(
        JSON.stringify({
          access_token: "access-123",
          refresh_token: "refresh-123",
          expires_in: 1800,
          token_type: "bearer",
        }),
      )
    );

    const auth = createSupabaseAuth(
      { ...input, worktree: resolve(input.worktree, "..", "unrelated") } as never,
      {
        clientId: "plugin-client",
        oauthPort: 17662,
      },
      { fetch: fetchMock as unknown as FetchLike, callbackPorts: [17662, 17663, 17664] },
    );

    const result = await firstAuthMethod(auth).authorize();
    const authUrl = new URL(result.url);
    const redirectUri = new URL(requireSearchParam(authUrl, "redirect_uri"));
    const state = requireSearchParam(authUrl, "state");

    const pending = result.callback();
    const response = await fetch(`${redirectUri.toString()}?code=code-123&state=${state}`);

    expect(response.status).toBe(200);

    const callbackResult = await pending;
    expect(callbackResult).toMatchObject({
      type: "success",
      access: "access-123",
      refresh: "refresh-123",
    });
    if (callbackResult.type !== "success") {
      throw new Error("Expected OAuth callback to succeed");
    }
    expect(typeof callbackResult.expires).toBe("number");
    await expect(readSavedAuth({ ...input, worktree: "" } as never)).resolves.toEqual({
      version: 1,
      auth: {
        access: "access-123",
        refresh: "refresh-123",
        expires: callbackResult.expires,
      },
    });
  });
});
