import { describe, expect, mock, test } from "bun:test";

import {
  DEFAULT_SUPABASE_API_BASE_URL,
  DEFAULT_SUPABASE_BROKER_URL,
  DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL,
  DEFAULT_SUPABASE_OAUTH_CLIENT_ID,
  DEFAULT_SUPABASE_OAUTH_PORT,
} from "../src/shared/api.ts";
import {
  BrokerClientError,
  exchangeCodeThroughBroker,
  refreshTokenThroughBroker,
} from "../src/shared/broker.ts";
import { readSupabaseConfig } from "../src/shared/cfg.ts";
import {
  type LogEntry,
  createServerLogWriter,
  createSupabaseLogger,
  createTuiLogWriter,
} from "../src/shared/log.ts";
import { buildAuthorizeUrl } from "../src/shared/oauth.ts";
import type { FetchLike } from "../src/shared/types.ts";

describe("shared config", () => {
  test("reads broker base url from env while keeping plugin options for other fields", () => {
    const config = readSupabaseConfig(
      {
        clientId: "plugin-client",
        oauthPort: 1456,
      },
      {
        OPENCODE_SUPABASE_BROKER_URL: "https://example.com/env-broker",
      },
    );

    expect(config).toEqual({
      clientId: "plugin-client",
      oauthPort: DEFAULT_SUPABASE_OAUTH_PORT,
      authorizeUrl: DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL,
      brokerBaseUrl: "https://example.com/env-broker",
      apiBaseUrl: DEFAULT_SUPABASE_API_BASE_URL,
    });
  });

  test("respects brokerBaseUrl in plugin options over env", () => {
    const config = readSupabaseConfig(
      {
        clientId: "plugin-client",
        oauthPort: 1456,
        brokerBaseUrl: "https://example.com/plugin-broker",
      },
      {
        OPENCODE_SUPABASE_BROKER_URL: "https://example.com/env-broker",
      },
    );

    expect(config.brokerBaseUrl).toBe("https://example.com/plugin-broker");
  });

  test("reads values from env when plugin options are absent", () => {
    const config = readSupabaseConfig(undefined, {
      OPENCODE_SUPABASE_OAUTH_CLIENT_ID: "env-client",
      OPENCODE_SUPABASE_OAUTH_PORT: "4567",
      SUPABASE_OAUTH_AUTHORIZE_URL: "https://example.com/authorize",
      OPENCODE_SUPABASE_BROKER_URL: "https://example.com/broker",
      SUPABASE_API_BASE_URL: "https://example.com/api",
    });

    expect(config).toEqual({
      clientId: "env-client",
      oauthPort: DEFAULT_SUPABASE_OAUTH_PORT,
      authorizeUrl: "https://example.com/authorize",
      brokerBaseUrl: "https://example.com/broker",
      apiBaseUrl: "https://example.com/api",
    });
  });

  test("uses the default client id when not provided", () => {
    const config = readSupabaseConfig(
      {
        oauthPort: 1456,
      },
      {},
    );

    expect(config.clientId).toBe(DEFAULT_SUPABASE_OAUTH_CLIENT_ID);
  });

  test("uses default broker base url when not provided", () => {
    const config = readSupabaseConfig(
      {
        clientId: "plugin-client",
        oauthPort: 1456,
      },
      {},
    );

    expect(config.brokerBaseUrl).toBe(DEFAULT_SUPABASE_BROKER_URL);
  });

  test("uses the fixed default oauth port regardless of overrides", () => {
    expect(
      readSupabaseConfig(
        {
          clientId: "plugin-client",
          oauthPort: 9999,
        },
        {},
      ).oauthPort,
    ).toBe(DEFAULT_SUPABASE_OAUTH_PORT);

    expect(
      readSupabaseConfig(undefined, {
        OPENCODE_SUPABASE_OAUTH_CLIENT_ID: "env-client",
        OPENCODE_SUPABASE_OAUTH_PORT: "abc",
      }).oauthPort,
    ).toBe(DEFAULT_SUPABASE_OAUTH_PORT);
  });
});

describe("shared oauth", () => {
  test("builds a config-driven authorize url for PKCE", () => {
    const url = buildAuthorizeUrl(
      {
        clientId: "plugin-client",
        authorizeUrl: "https://example.com/oauth/authorize",
      },
      "http://localhost:1456/callback",
      { verifier: "verifier", challenge: "challenge" },
      "state-123",
    );

    expect(url).toBe(
      "https://example.com/oauth/authorize?response_type=code&client_id=plugin-client&redirect_uri=http%3A%2F%2Flocalhost%3A1456%2Fcallback&code_challenge=challenge&code_challenge_method=S256&state=state-123",
    );
  });
});

describe("shared log", () => {
  test("writes structured entries with the supabase service name", async () => {
    const write = mock(async () => true);
    const logger = createSupabaseLogger({ write });

    await logger.info("supabase auth started", { phase: "authorize" });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({
      service: "opencode-supabase",
      level: "info",
      message: "supabase auth started",
      extra: { phase: "authorize" },
    });
  });

  test("swallows host logger failures and prints to console.error", async () => {
    const write = mock(async () => {
      throw new Error("host logger offline");
    });
    const logger = createSupabaseLogger({ write });
    const originalError = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => errors.push(...args);

    try {
      await logger.error("supabase auth failed");
      expect(errors.some((e) => String(e).includes("host logger offline"))).toBe(true);
    } finally {
      console.error = originalError;
    }
  });

  test("detects v2 SDK error responses that do not throw", async () => {
    const write = mock(async () => ({ error: "bad request" }));
    const logger = createSupabaseLogger({ write });
    const originalError = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => errors.push(...args);

    try {
      await logger.info("test message");
      expect(errors.some((e) => String(e).includes("host log rejected"))).toBe(true);
    } finally {
      console.error = originalError;
    }
  });
});

describe("server log writer", () => {
  test("wraps log entry in body for v1 SDK", async () => {
    const logCalls: Array<{ body: LogEntry }> = [];
    const client = {
      app: {
        log: (input: { body: LogEntry }) => {
          logCalls.push(input);
          return Promise.resolve(true);
        },
      },
    };

    const write = createServerLogWriter(client);
    const entry: LogEntry = { service: "opencode-supabase", level: "info", message: "test" };
    await write(entry);

    expect(logCalls).toHaveLength(1);
    expect(logCalls[0]?.body).toEqual(entry);
  });
});

describe("tui log writer", () => {
  test("passes flat entry with throwOnError for v2 SDK", async () => {
    const logCalls: Array<{ params: LogEntry; options: { throwOnError?: boolean } }> = [];
    const client = {
      app: {
        log: (input: LogEntry, options?: { throwOnError?: boolean }) => {
          logCalls.push({ params: input, options: options ?? { throwOnError: false } });
          return Promise.resolve(true);
        },
      },
    };

    const write = createTuiLogWriter(client);
    const entry: LogEntry = { service: "opencode-supabase", level: "info", message: "test" };
    await write(entry);

    expect(logCalls).toHaveLength(1);
    expect(logCalls[0]?.params).toEqual(entry);
    expect(logCalls[0]?.options.throwOnError).toBe(true);
  });
});

describe("broker client", () => {
  test("exchanges codes via broker POST /exchange", async () => {
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://example.com/broker/exchange");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        Accept: "application/json",
      });

      const body = JSON.parse(String(init?.body));
      expect(body.code).toBe("code-123");
      expect(body.code_verifier).toBe("verifier-123");
      expect(body.redirect_uri).toBe("http://localhost:1456/callback");

      return new Response(
        JSON.stringify({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          token_type: "bearer",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const tokens = await exchangeCodeThroughBroker(
      { baseUrl: "https://example.com/broker" },
      {
        code: "code-123",
        code_verifier: "verifier-123",
        redirect_uri: "http://localhost:1456/callback",
      },
      fetchMock as unknown as FetchLike,
    );

    expect(tokens.access_token).toBe("access");
    expect(tokens.refresh_token).toBe("refresh");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.token_type).toBe("bearer");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("refreshes tokens via broker POST /refresh", async () => {
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://example.com/broker/refresh");
      expect(init?.method).toBe("POST");

      const body = JSON.parse(String(init?.body));
      expect(body.refresh_token).toBe("refresh-123");

      return new Response(
        JSON.stringify({
          access_token: "next-access",
          refresh_token: "next-refresh",
          expires_in: 3600,
          token_type: "bearer",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const tokens = await refreshTokenThroughBroker(
      { baseUrl: "https://example.com/broker" },
      { refresh_token: "refresh-123" },
      fetchMock as unknown as FetchLike,
    );

    expect(tokens.access_token).toBe("next-access");
    expect(tokens.refresh_token).toBe("next-refresh");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("throws BrokerClientError on broker error response", async () => {
    const fetchMock = mock(async () => {
      return new Response(
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
      );
    });

    await expect(
      exchangeCodeThroughBroker(
        { baseUrl: "https://example.com/broker" },
        {
          code: "code-123",
          code_verifier: "verifier-123",
          redirect_uri: "http://evil.com/callback",
        },
        fetchMock as unknown as FetchLike,
      ),
    ).rejects.toThrow(BrokerClientError);

    try {
      await exchangeCodeThroughBroker(
        { baseUrl: "https://example.com/broker" },
        {
          code: "code-123",
          code_verifier: "verifier-123",
          redirect_uri: "http://evil.com/callback",
        },
        fetchMock as unknown as FetchLike,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(BrokerClientError);
      expect((error as BrokerClientError).code).toBe("invalid_request");
      expect((error as BrokerClientError).status).toBe(400);
    }
  });

  test("throws on invalid token response from broker", async () => {
    const fetchMock = mock(async () => {
      return new Response(
        JSON.stringify({
          access_token: "access",
          // missing refresh_token
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    await expect(
      exchangeCodeThroughBroker(
        { baseUrl: "https://example.com/broker" },
        {
          code: "code-123",
          code_verifier: "verifier-123",
          redirect_uri: "http://localhost:1456/callback",
        },
        fetchMock as unknown as FetchLike,
      ),
    ).rejects.toThrow(BrokerClientError);
  });
});
