import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import { getStoreFile, readSavedAuth, writeSavedAuth } from "../src/server/store.ts";
import {
  type SupabaseToolInput,
  createSupabaseTools,
  disconnectSupabaseAuth,
  ensureSupabaseToolAuth,
  getSupabaseAuthStatus,
} from "../src/server/tools.ts";
import { createSupabaseLogger } from "../src/shared/log.ts";
import type { FetchLike } from "../src/shared/types.ts";

type TestPluginInput = SupabaseToolInput;

type HostAuthSetMock = ReturnType<typeof mock>;

type TestFixtures = {
  hostAuthSet: HostAuthSetMock;
  input: TestPluginInput;
};

type TestToolContext = Pick<
  ToolContext,
  "directory" | "worktree" | "abort" | "sessionID" | "messageID" | "agent" | "metadata" | "ask"
>;

const cleanupPaths: string[] = [];
const originalBrokerUrl = process.env.OPENCODE_SUPABASE_BROKER_URL;

async function createInput(): Promise<TestFixtures> {
  const root = await mkdtemp(join(tmpdir(), "opencode-supabase-tools-"));
  cleanupPaths.push(root);
  const hostAuthSet = mock(async () => ({ data: true }));
  const input = {
    client: {
      auth: {
        set: hostAuthSet,
      },
    },
    directory: join(root, "consumer"),
    worktree: root,
    serverUrl: new URL("http://127.0.0.1:7777/"),
  } satisfies TestPluginInput;

  return { hostAuthSet, input };
}

async function writeRawStore(input: TestPluginInput, contents: string) {
  const path = getStoreFile(input);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return path;
}

function createContext(input: TestPluginInput): TestToolContext {
  return {
    directory: input.directory,
    worktree: input.worktree,
    abort: new AbortController().signal,
    sessionID: "session",
    messageID: "message",
    agent: "agent",
    metadata: () => {},
    ask: async () => {},
  };
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  if (originalBrokerUrl === undefined) {
    process.env.OPENCODE_SUPABASE_BROKER_URL = undefined;
  } else {
    process.env.OPENCODE_SUPABASE_BROKER_URL = originalBrokerUrl;
  }
});

describe("server tools auth helper", () => {
  test("logs tool execution boundaries and redacts sensitive args", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: `access-${Date.now()}`,
      refresh: `refresh-${Date.now()}`,
      expires: Date.now() + 60_000,
    });

    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ id: "project-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const write = mock(async () => true);
    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17671,
      },
      {
        fetch: fetchMock as unknown as FetchLike,
        logger: createSupabaseLogger({ write }),
      },
    );

    await tools.supabase_create_project.execute(
      {
        organization_id: "org-1",
        name: "My Project",
        region: "us-east-1",
        db_pass: "super-secret-db-pass",
      },
      createContext(input),
    );

    const entries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));
    expect(entries.some((entry) => entry.includes("supabase tool started"))).toBe(true);
    expect(entries.some((entry) => entry.includes("supabase tool completed"))).toBe(true);
    expect(entries.join(" ")).toContain("supabase_create_project");
    expect(entries.join(" ")).not.toContain("super-secret-db-pass");
  });

  test("logs tool auth failures and request failures", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const write = mock(async () => true);
    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17672,
      },
      {
        fetch: mock(async () => new Response("unexpected")) as unknown as FetchLike,
        logger: createSupabaseLogger({ write }),
      },
    );

    await expect(tools.supabase_list_projects.execute({}, createContext(input))).rejects.toThrow(
      "Supabase is not connected. Run /supabase first.",
    );

    const entries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));
    expect(entries.some((entry) => entry.includes("supabase tool started"))).toBe(true);
    expect(entries.some((entry) => entry.includes("supabase tool failed"))).toBe(true);
  });

  test("does not log tool completion when response json parsing fails", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: `access-${Date.now()}`,
      refresh: `refresh-${Date.now()}`,
      expires: Date.now() + 60_000,
    });

    const write = mock(async () => true);
    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17675,
      },
      {
        fetch: mock(async () =>
          new Response("not-json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })) as unknown as FetchLike,
        logger: createSupabaseLogger({ write }),
      },
    );

    await expect(tools.supabase_list_projects.execute({}, createContext(input))).rejects.toThrow();

    const entries = write.mock.calls.map((call) => JSON.stringify(((call as unknown) as [unknown])[0]));
    expect(entries.some((entry) => entry.includes("supabase tool completed"))).toBe(false);
    expect(entries.some((entry) => entry.includes("supabase tool failed"))).toBe(true);
  });

  test("fails clearly when no persisted Supabase auth exists", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";

    await expect(
      ensureSupabaseToolAuth(
        input,
        {
          clientId: "plugin-client",
          oauthPort: 17670,
        },
        { fetch: mock(async () => new Response("unexpected")) },
      ),
    ).rejects.toThrow("Supabase is not connected. Run /supabase first.");
  });

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

  test("updates host auth after a successful refresh", async () => {
    const { hostAuthSet, input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const fetchMock: FetchLike = mock(async (request) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 3600,
            token_type: "bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify([{ id: "proj_789" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17673,
      },
      { fetch: fetchMock },
    );

    await tools.supabase_list_projects.execute({}, createContext(input));

    expect(hostAuthSet).toHaveBeenCalledTimes(1);
  });

  test("reports connected when saved auth is still fresh", async () => {
    const { input } = await createInput();
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    await expect(getSupabaseAuthStatus(input)).resolves.toEqual({
      status: "connected",
      auth: {
        access: "saved-access",
        refresh: "saved-refresh",
        expires: expect.any(Number),
      },
      checked: false,
    });
  });

  test("reports disconnected when no saved auth exists", async () => {
    const { input } = await createInput();

    await expect(getSupabaseAuthStatus(input)).resolves.toEqual({
      status: "disconnected",
      checked: false,
    });
  });

  test("reports unknown when refresh fails for broker availability reasons", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const fetchMock: FetchLike = mock(async (request) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        return new Response(
          JSON.stringify({
            error: {
              code: "broker_unavailable",
              message: "broker unavailable",
            },
          }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`unexpected url: ${url}`);
    });

    await expect(getSupabaseAuthStatus(input, undefined, { fetch: fetchMock })).resolves.toEqual({
      status: "unknown",
      checked: true,
      message: "Supabase auth refresh failed: broker unavailable",
    });
  });

  test("disconnect helper clears saved auth and host auth", async () => {
    const { input } = await createInput();
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (request) => {
      const url = String(request);
      if (url === `http://127.0.0.1:7777/auth/supabase?directory=${encodeURIComponent(input.directory)}`) {
        return new Response(JSON.stringify(true), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`unexpected url: ${url}`);
    });

    await disconnectSupabaseAuth(input, { fetch: fetchMock });

    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("clears saved auth and host auth when refresh is unauthorized", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "bad-refresh",
      expires: Date.now() - 1_000,
    });

    const fetchMock: FetchLike = mock(async (request) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        return new Response(
          JSON.stringify({
            error: {
              code: "unauthorized",
              message: "refresh token invalid",
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === `http://127.0.0.1:7777/auth/supabase?directory=${encodeURIComponent(input.directory)}`) {
        return new Response(JSON.stringify(true), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`unexpected url: ${url}`);
    });

    await expect(
      ensureSupabaseToolAuth(
        input,
        {
          clientId: "plugin-client",
          oauthPort: 17674,
        },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("Supabase is not connected. Run /supabase first.");

    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
  });

  test("uses persisted plugin-owned auth for management API requests when access is still valid", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://api.supabase.com/v1/projects");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer saved-access",
        Accept: "application/json",
      });

      return new Response(JSON.stringify([{ id: "proj_123", name: "Example" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17671,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_projects.execute({}, createContext(input));

    expect(result).toContain("proj_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("uses session-scoped auth when worktree is unrelated", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth({ ...input, worktree: "" }, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const unrelatedInput = {
      ...input,
      worktree: resolve(input.worktree, "..", "unrelated"),
    } satisfies TestPluginInput;

    await expect(
      ensureSupabaseToolAuth(
        unrelatedInput,
        {
          clientId: "plugin-client",
          oauthPort: 17680,
        },
        { fetch: mock(async () => new Response("unexpected")) },
      ),
    ).resolves.toEqual({
      access: "saved-access",
      refresh: "saved-refresh",
      expires: expect.any(Number),
    });
  });

  test("uses session-scoped auth when worktree resolves to root", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth({ ...input, worktree: "/" }, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const rootInput = {
      ...input,
      worktree: "/",
    } satisfies TestPluginInput;

    await expect(
      ensureSupabaseToolAuth(
        rootInput,
        {
          clientId: "plugin-client",
          oauthPort: 17684,
        },
        { fetch: mock(async () => new Response("unexpected")) },
      ),
    ).resolves.toEqual({
      access: "saved-access",
      refresh: "saved-refresh",
      expires: expect.any(Number),
    });
  });

  test("refreshes expired persisted auth through the broker before calling the management API", async () => {
    const { hostAuthSet, input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          refresh_token: "saved-refresh",
        });

        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 3600,
            token_type: "bearer",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      expect(url).toBe("https://api.supabase.com/v1/projects");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer fresh-access",
        Accept: "application/json",
      });

      return new Response(JSON.stringify([{ id: "proj_456" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17672,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_projects.execute({}, createContext(input));

    expect(result).toContain("proj_456");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hostAuthSet).toHaveBeenCalledTimes(1);
    await expect(readSavedAuth(input)).resolves.toMatchObject({
      version: 1,
      auth: {
        access: "fresh-access",
        refresh: "fresh-refresh",
      },
    });
  });

  test("concurrent stale-auth refresh callers for the same store should join one broker refresh", async () => {
    const { hostAuthSet, input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    let brokerRefreshCalls = 0;
    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://example.com/broker/refresh");
      expect(init?.method).toBe("POST");
      brokerRefreshCalls += 1;

      await new Promise((resolve) => setTimeout(resolve, 0));

      return new Response(
        JSON.stringify({
          access_token: `fresh-access-${brokerRefreshCalls}`,
          refresh_token: `fresh-refresh-${brokerRefreshCalls}`,
          expires_in: 3600,
          token_type: "bearer",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const [firstAuth, secondAuth] = await Promise.all([
      ensureSupabaseToolAuth(
        input,
        {
          clientId: "plugin-client",
          oauthPort: 17686,
        },
        { fetch: fetchMock },
      ),
      ensureSupabaseToolAuth(
        input,
        {
          clientId: "plugin-client",
          oauthPort: 17686,
        },
        { fetch: fetchMock },
      ),
    ]);

    expect(firstAuth).toEqual(secondAuth);
    expect(brokerRefreshCalls).toBe(1);
    expect(hostAuthSet).toHaveBeenCalledTimes(1);
  });

  test("stale-auth callers from different directories in one worktree still sync host auth per directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-supabase-tools-"));
    cleanupPaths.push(root);
    const firstHostAuthSet = mock(async () => ({ data: true }));
    const secondHostAuthSet = mock(async () => ({ data: true }));
    const firstInput = {
      client: {
        auth: {
          set: firstHostAuthSet,
        },
      },
      directory: join(root, "consumer-a"),
      worktree: root,
      serverUrl: new URL("http://127.0.0.1:7777/"),
    } satisfies TestPluginInput;
    const secondInput = {
      client: {
        auth: {
          set: secondHostAuthSet,
        },
      },
      directory: join(root, "consumer-b"),
      worktree: root,
      serverUrl: new URL("http://127.0.0.1:7777/"),
    } satisfies TestPluginInput;

    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(firstInput, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    let brokerRefreshCalls = 0;
    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://example.com/broker/refresh");
      expect(init?.method).toBe("POST");
      brokerRefreshCalls += 1;

      await new Promise((resolve) => setTimeout(resolve, 0));

      return new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 3600,
          token_type: "bearer",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const [firstAuth, secondAuth] = await Promise.all([
      ensureSupabaseToolAuth(
        firstInput,
        {
          clientId: "plugin-client",
          oauthPort: 17686,
        },
        { fetch: fetchMock },
      ),
      ensureSupabaseToolAuth(
        secondInput,
        {
          clientId: "plugin-client",
          oauthPort: 17686,
        },
        { fetch: fetchMock },
      ),
    ]);

    expect(firstAuth).toEqual(secondAuth);
    expect(brokerRefreshCalls).toBe(1);
    expect(firstHostAuthSet).toHaveBeenCalledTimes(1);
    expect(secondHostAuthSet).toHaveBeenCalledTimes(1);
  });

  test("late joined directory still syncs host auth while leader sync is pending", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-supabase-tools-"));
    cleanupPaths.push(root);
    let releaseFirstHostSync: (() => void) | undefined;
    let markFirstHostSyncStarted: (() => void) | undefined;
    const firstHostSyncStarted = new Promise<void>((resolve) => {
      markFirstHostSyncStarted = resolve;
    });
    let secondPromise: Promise<Awaited<ReturnType<typeof ensureSupabaseToolAuth>>> | undefined;
    const secondHostAuthSet = mock(async () => ({ data: true }));
    const secondInput = {
      client: {
        auth: {
          set: secondHostAuthSet,
        },
      },
      directory: join(root, "consumer-b"),
      worktree: root,
      serverUrl: new URL("http://127.0.0.1:7777/"),
    } satisfies TestPluginInput;
    let brokerRefreshCalls = 0;
    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://example.com/broker/refresh");
      expect(init?.method).toBe("POST");
      brokerRefreshCalls += 1;

      return new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 3600,
          token_type: "bearer",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    const firstHostAuthSet = mock(async () => {
      markFirstHostSyncStarted?.();
      secondPromise ??= ensureSupabaseToolAuth(
        secondInput,
        {
          clientId: "plugin-client",
          oauthPort: 17686,
        },
        { fetch: fetchMock },
      );
      await new Promise<void>((resolve) => {
        releaseFirstHostSync = resolve;
      });
      return { data: true };
    });
    const firstInput = {
      client: {
        auth: {
          set: firstHostAuthSet,
        },
      },
      directory: join(root, "consumer-a"),
      worktree: root,
      serverUrl: new URL("http://127.0.0.1:7777/"),
    } satisfies TestPluginInput;

    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(firstInput, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const firstPromise = ensureSupabaseToolAuth(
      firstInput,
      {
        clientId: "plugin-client",
        oauthPort: 17686,
      },
      { fetch: fetchMock },
    );

    await firstHostSyncStarted;

    releaseFirstHostSync?.();

    const resolvedSecondPromise = secondPromise;
    if (!resolvedSecondPromise) {
      throw new Error("Expected second promise to start during leader host sync");
    }

    const [firstAuth, secondAuth] = await Promise.all([firstPromise, resolvedSecondPromise]);

    expect(firstAuth).toEqual(secondAuth);
    expect(brokerRefreshCalls).toBe(1);
    expect(firstHostAuthSet).toHaveBeenCalledTimes(1);
    expect(secondHostAuthSet).toHaveBeenCalledTimes(1);
  });

  test("disconnect wins if a stale-auth refresh is still in flight", async () => {
    const { hostAuthSet, input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    let resolveRefresh: (() => void) | undefined;
    let markRefreshStarted: (() => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://example.com/broker/refresh");
      expect(init?.method).toBe("POST");
      markRefreshStarted?.();

      await new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      });

      return new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_in: 3600,
          token_type: "bearer",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const refreshPromise = ensureSupabaseToolAuth(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17686,
      },
      { fetch: fetchMock },
    );

    await refreshStarted;

    await disconnectSupabaseAuth(input, { fetch: mock(async () => new Response(null, { status: 204 })) });

    resolveRefresh?.();

    await expect(refreshPromise).rejects.toThrow("Supabase is not connected. Run /supabase first.");
    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
    expect(hostAuthSet).not.toHaveBeenCalled();
  });

  test("stale refresh failure does not clear newer auth written mid-flight", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    let resolveRefresh: (() => void) | undefined;
    let markRefreshStarted: (() => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const hostClearFetch: FetchLike = mock(async () => new Response(null, { status: 204 }));
    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        expect(init?.method).toBe("POST");
        markRefreshStarted?.();

        await new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        });

        return new Response(
          JSON.stringify({
            error: "unauthorized",
            message: "upstream token request was rejected",
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return hostClearFetch(request, init);
    });

    const refreshPromise = ensureSupabaseToolAuth(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17686,
      },
      { fetch: fetchMock },
    );

    await refreshStarted;

    const newerAuth = {
      access: "newer-access",
      refresh: "newer-refresh",
      expires: Date.now() + 60_000,
    };
    await writeSavedAuth(input, newerAuth);

    resolveRefresh?.();

    await expect(refreshPromise).resolves.toEqual(newerAuth);
    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1, auth: newerAuth });
    expect(hostClearFetch).not.toHaveBeenCalled();
  });

  test("ambiguous broker refresh errors do not clear saved auth", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    const savedAuth = {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    };
    await writeSavedAuth(input, savedAuth);

    const hostClearFetch: FetchLike = mock(async () => new Response(null, { status: 204 }));
    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            error: {
              code: "invalid_request",
              message: "broker rejected malformed refresh request",
            },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return hostClearFetch(request, init);
    });

    await expect(
      ensureSupabaseToolAuth(
        input,
        {
          clientId: "plugin-client",
          oauthPort: 17686,
        },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("Supabase auth refresh failed: broker rejected malformed refresh request");

    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1, auth: savedAuth });
    expect(hostClearFetch).not.toHaveBeenCalled();
  });

  test("shared stale refresh rejection clears host auth for each joined directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-supabase-tools-"));
    cleanupPaths.push(root);
    const firstInput = {
      client: {
        auth: {
          set: mock(async () => ({ data: true })),
        },
      },
      directory: join(root, "consumer-a"),
      worktree: root,
      serverUrl: new URL("http://127.0.0.1:7777/"),
    } satisfies TestPluginInput;
    const secondInput = {
      client: {
        auth: {
          set: mock(async () => ({ data: true })),
        },
      },
      directory: join(root, "consumer-b"),
      worktree: root,
      serverUrl: new URL("http://127.0.0.1:7777/"),
    } satisfies TestPluginInput;

    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(firstInput, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    let brokerRefreshCalls = 0;
    let hostClearCalls = 0;
    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        brokerRefreshCalls += 1;
        return new Response(
          JSON.stringify({
            error: {
              code: "unauthorized",
              message: "upstream token request was rejected",
            },
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url.startsWith("http://127.0.0.1:7777/auth/supabase?directory=")) {
        expect(init?.method).toBe("DELETE");
        hostClearCalls += 1;
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    await expect(
      Promise.all([
        ensureSupabaseToolAuth(
          firstInput,
          {
            clientId: "plugin-client",
            oauthPort: 17686,
          },
          { fetch: fetchMock },
        ),
        ensureSupabaseToolAuth(
          secondInput,
          {
            clientId: "plugin-client",
            oauthPort: 17686,
          },
          { fetch: fetchMock },
        ),
      ]),
    ).rejects.toThrow("Supabase is not connected. Run /supabase first.");

    expect(brokerRefreshCalls).toBe(1);
    expect(hostClearCalls).toBe(2);
  });

  test("shared reset-notice refresh rejection clears host auth for each joined directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-supabase-tools-"));
    cleanupPaths.push(root);
    const firstInput = {
      client: {
        auth: {
          set: mock(async () => ({ data: true })),
        },
      },
      directory: join(root, "consumer-a"),
      worktree: root,
      serverUrl: new URL("http://127.0.0.1:7777/"),
    } satisfies TestPluginInput;
    const secondInput = {
      client: {
        auth: {
          set: mock(async () => ({ data: true })),
        },
      },
      directory: join(root, "consumer-b"),
      worktree: root,
      serverUrl: new URL("http://127.0.0.1:7777/"),
    } satisfies TestPluginInput;

    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(firstInput, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    let brokerRefreshCalls = 0;
    let hostClearCalls = 0;
    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        brokerRefreshCalls += 1;
        await writeRawStore(firstInput, "{ not json");
        return new Response(
          JSON.stringify({
            error: {
              code: "invalid_request",
              message: "broker rejected malformed refresh request",
            },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url.startsWith("http://127.0.0.1:7777/auth/supabase?directory=")) {
        expect(init?.method).toBe("DELETE");
        hostClearCalls += 1;
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch ${url}`);
    });

    const results = await Promise.allSettled([
      ensureSupabaseToolAuth(
        firstInput,
        {
          clientId: "plugin-client",
          oauthPort: 17686,
        },
        { fetch: fetchMock, now: () => new Date("2026-05-11T10:20:30.000Z") },
      ),
      ensureSupabaseToolAuth(
        secondInput,
        {
          clientId: "plugin-client",
          oauthPort: 17686,
        },
        { fetch: fetchMock, now: () => new Date("2026-05-11T10:20:30.000Z") },
      ),
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          message: expect.stringContaining("Supabase auth was reset because the local auth store was corrupted."),
        }),
        status: "rejected",
      }),
      expect.objectContaining({
        reason: expect.objectContaining({
          message: expect.stringContaining("Supabase auth was reset because the local auth store was corrupted."),
        }),
        status: "rejected",
      }),
    ]);

    expect(brokerRefreshCalls).toBe(1);
    expect(hostClearCalls).toBe(2);
  });

  test("refreshes session-scoped auth when worktree is unrelated", async () => {
    const { hostAuthSet, input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth({ ...input, worktree: "" }, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const unrelatedInput = {
      ...input,
      worktree: resolve(input.worktree, "..", "unrelated"),
    } satisfies TestPluginInput;

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          refresh_token: "saved-refresh",
        });

        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 3600,
            token_type: "bearer",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      expect(url).toBe("https://api.supabase.com/v1/projects");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer fresh-access",
        Accept: "application/json",
      });

      return new Response(JSON.stringify([{ id: "proj_unrelated_refresh" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      unrelatedInput,
      {
        clientId: "plugin-client",
        oauthPort: 17682,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_projects.execute({}, createContext(unrelatedInput));

    expect(result).toContain("proj_unrelated_refresh");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hostAuthSet).toHaveBeenCalledTimes(1);
    await expect(readSavedAuth({ ...input, worktree: "" })).resolves.toMatchObject({
      version: 1,
      auth: {
        access: "fresh-access",
        refresh: "fresh-refresh",
      },
    });
  });

  test("refreshes session-scoped auth when worktree resolves to root", async () => {
    const { hostAuthSet, input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth({ ...input, worktree: "/" }, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const rootInput = {
      ...input,
      worktree: "/",
    } satisfies TestPluginInput;

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          refresh_token: "saved-refresh",
        });

        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 3600,
            token_type: "bearer",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      expect(url).toBe("https://api.supabase.com/v1/projects");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer fresh-access",
        Accept: "application/json",
      });

      return new Response(JSON.stringify([{ id: "proj_root_refresh" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      rootInput,
      {
        clientId: "plugin-client",
        oauthPort: 17685,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_projects.execute({}, createContext(rootInput));

    expect(result).toContain("proj_root_refresh");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hostAuthSet).toHaveBeenCalledTimes(1);
    await expect(readSavedAuth({ ...input, worktree: "/" })).resolves.toMatchObject({
      version: 1,
      auth: {
        access: "fresh-access",
        refresh: "fresh-refresh",
      },
    });
  });

  test("refreshes a nearly expired token before calling the management API", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "stale-access",
      refresh: "saved-refresh",
      expires: Date.now() + 5_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 3600,
            token_type: "bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      expect(url).toBe("https://api.supabase.com/v1/projects");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer fresh-access",
      });

      return new Response(JSON.stringify([{ id: "proj_near" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17679,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_projects.execute({}, createContext(input));

    expect(result).toContain("proj_near");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("continues with refreshed plugin auth when host auth sync fails", async () => {
    const { hostAuthSet, input } = await createInput();
    hostAuthSet.mockImplementationOnce(async () => {
      throw new Error("host auth unavailable");
    });

    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "saved-refresh",
      expires: Date.now() - 1_000,
    });

    const fetchMock: FetchLike = mock(async (request) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "fresh-refresh",
            expires_in: 3600,
            token_type: "bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify([{ id: "proj_host_sync" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17680,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_projects.execute({}, createContext(input));

    expect(result).toContain("proj_host_sync");
    await expect(readSavedAuth(input)).resolves.toMatchObject({
      auth: {
        access: "fresh-access",
        refresh: "fresh-refresh",
      },
    });
  });

  test("still returns reconnect guidance when host auth cleanup fails", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "expired-access",
      refresh: "bad-refresh",
      expires: Date.now() - 1_000,
    });

    const fetchMock: FetchLike = mock(async (request) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        return new Response(
          JSON.stringify({
            error: {
              code: "unauthorized",
              message: "refresh token invalid",
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === `http://127.0.0.1:7777/auth/supabase?directory=${encodeURIComponent(input.directory)}`) {
        throw new Error("delete failed");
      }

      throw new Error(`unexpected url: ${url}`);
    });

    await expect(
      ensureSupabaseToolAuth(
        input,
        {
          clientId: "plugin-client",
          oauthPort: 17681,
        },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("Supabase is not connected. Run /supabase first.");

    await expect(readSavedAuth(input)).resolves.toEqual({ version: 1 });
  });

  test("clears session-scoped auth when refresh is unauthorized and worktree is unrelated", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth({ ...input, worktree: "" }, {
      access: "expired-access",
      refresh: "bad-refresh",
      expires: Date.now() - 1_000,
    });

    const unrelatedInput = {
      ...input,
      worktree: resolve(input.worktree, "..", "unrelated"),
    } satisfies TestPluginInput;

    const fetchMock: FetchLike = mock(async (request) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        return new Response(
          JSON.stringify({
            error: {
              code: "unauthorized",
              message: "refresh token invalid",
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === `http://127.0.0.1:7777/auth/supabase?directory=${encodeURIComponent(input.directory)}`) {
        return new Response(JSON.stringify(true), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`unexpected url: ${url}`);
    });

    await expect(
      ensureSupabaseToolAuth(
        unrelatedInput,
        {
          clientId: "plugin-client",
          oauthPort: 17683,
        },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("Supabase is not connected. Run /supabase first.");

    await expect(readSavedAuth({ ...input, worktree: "" })).resolves.toEqual({ version: 1 });
  });

  test("clears session-scoped auth when refresh is unauthorized and worktree resolves to root", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth({ ...input, worktree: "/" }, {
      access: "expired-access",
      refresh: "bad-refresh",
      expires: Date.now() - 1_000,
    });

    const rootInput = {
      ...input,
      worktree: "/",
    } satisfies TestPluginInput;

    const fetchMock: FetchLike = mock(async (request) => {
      const url = String(request);
      if (url === "https://example.com/broker/refresh") {
        return new Response(
          JSON.stringify({
            error: {
              code: "unauthorized",
              message: "refresh token invalid",
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url === `http://127.0.0.1:7777/auth/supabase?directory=${encodeURIComponent(input.directory)}`) {
        return new Response(JSON.stringify(true), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`unexpected url: ${url}`);
    });

    await expect(
      ensureSupabaseToolAuth(
        rootInput,
        {
          clientId: "plugin-client",
          oauthPort: 17686,
        },
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("Supabase is not connected. Run /supabase first.");

    await expect(readSavedAuth({ ...input, worktree: "/" })).resolves.toEqual({ version: 1 });
  });

  test("lists organizations for the authenticated user", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://api.supabase.com/v1/organizations");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer saved-access",
        Accept: "application/json",
      });

      return new Response(JSON.stringify([{ id: "org_123", name: "Acme" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17675,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_organizations.execute({}, createContext(input));

    expect(result).toContain("org_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("formats organization API failures clearly", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async () => {
      return new Response("nope", { status: 403 });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17676,
      },
      { fetch: fetchMock },
    );

    await expect(
      tools.supabase_list_organizations.execute({}, createContext(input)),
    ).rejects.toThrow("Failed to list organizations: 403 nope");
  });

  test("fetches project api keys for a project ref", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://api.supabase.com/v1/projects/proj_123/api-keys");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer saved-access",
        Accept: "application/json",
      });

      return new Response(JSON.stringify([{ api_key: "anon-key" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17677,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_get_project_api_keys.execute(
      { project_ref: "proj_123" },
      createContext(input),
    );

    expect(result).toContain("anon-key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("formats project api key failures clearly", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async () => {
      return new Response("missing", { status: 404 });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17678,
      },
      { fetch: fetchMock },
    );

    await expect(
      tools.supabase_get_project_api_keys.execute({ project_ref: "proj_404" }, createContext(input)),
    ).rejects.toThrow("Failed to get API keys: 404 missing");
  });

  test("creates a project with default region and generated db password", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://api.supabase.com/v1/projects");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer saved-access",
        Accept: "application/json",
        "Content-Type": "application/json",
      });

      const body = JSON.parse(String(init?.body)) as {
        organization_id: string;
        name: string;
        region: string;
        db_pass: string;
      };
      expect(body.organization_id).toBe("org_123");
      expect(body.name).toBe("demo-project");
      expect(body.region).toBe("us-east-1");
      expect(body.db_pass.length).toBeGreaterThanOrEqual(24);

      return new Response(JSON.stringify({ id: "proj_new", name: "demo-project" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17682,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_create_project.execute(
      { organization_id: "org_123", name: "demo-project" },
      createContext(input),
    );

    expect(result).toContain("proj_new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("creates a project with provided region and db password", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (_request, init) => {
      const body = JSON.parse(String(init?.body)) as {
        organization_id: string;
        name: string;
        region: string;
        db_pass: string;
      };
      expect(body).toEqual({
        organization_id: "org_999",
        name: "named-project",
        region: "eu-west-1",
        db_pass: "secret-pass",
      });

      return new Response(JSON.stringify({ id: "proj_custom" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17683,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_create_project.execute(
      {
        organization_id: "org_999",
        name: "named-project",
        region: "eu-west-1",
        db_pass: "secret-pass",
      },
      createContext(input),
    );

    expect(result).toContain("proj_custom");
  });

  test("formats create project failures clearly", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async () => new Response("bad request", { status: 400 }));

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17684,
      },
      { fetch: fetchMock },
    );

    await expect(
      tools.supabase_create_project.execute(
        { organization_id: "org_123", name: "bad-project" },
        createContext(input),
      ),
    ).rejects.toThrow("Failed to create project: 400 bad request");
  });

  test("fetches available regions for an organization", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async (request, init) => {
      const url = String(request);
      expect(url).toBe("https://api.supabase.com/v1/projects/available-regions?organization_slug=my-org");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer saved-access",
        Accept: "application/json",
      });

      return new Response(JSON.stringify({
        recommendations: { smartGroup: [], specific: [] },
        all: {
          smartGroup: [{ name: "Americas", code: "americas" }],
          specific: [{ name: "US East (North Virginia)", code: "us-east-1", type: "specific", provider: "AWS" }],
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17690,
      },
      { fetch: fetchMock },
    );

    const result = await tools.supabase_list_regions.execute({ organization_slug: "my-org" }, createContext(input));

    expect(result).toContain("us-east-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("formats regions API failures clearly", async () => {
    const { input } = await createInput();
    process.env.OPENCODE_SUPABASE_BROKER_URL = "https://example.com/broker";
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });

    const fetchMock: FetchLike = mock(async () => new Response("nope", { status: 403 }));

    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17691,
      },
      { fetch: fetchMock },
    );

    await expect(
      tools.supabase_list_regions.execute({ organization_slug: "my-org" }, createContext(input)),
    ).rejects.toThrow("Failed to list regions: 403 nope");
  });

  test("opens Supabase MCP setup page for a project ref", async () => {
    const { input } = await createInput();
    await writeSavedAuth(input, {
      access: "saved-access",
      refresh: "saved-refresh",
      expires: Date.now() + 60_000,
    });
    const openMock = mock(async () => undefined);
    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17686,
      },
      { open: openMock },
    );

    const result = await tools.supabase_open_mcp_setup.execute(
      { project_ref: "yepepldpwepdbczomujk" },
      createContext(input),
    );

    expect(openMock).toHaveBeenCalledWith(
      "https://supabase.com/dashboard/project/yepepldpwepdbczomujk?showConnect=true&connectTab=mcp&mcpClient=opencode",
    );
    expect(result).toContain("MCP Connect page is open:");
    expect(result).toContain(
      "https://supabase.com/dashboard/project/yepepldpwepdbczomujk?showConnect=true&connectTab=mcp&mcpClient=opencode",
    );
    expect(result).toContain("Grab config from Supabase Studio:");
    expect(result).toContain("In Connect -> MCP -> OpenCode, choose permissions.");
    expect(result).toContain("Copy the generated config under Configure MCP.");
    expect(result).toContain("Paste the Studio prompt or config snippet back here.");
    expect(result).toContain("Skip any install Supabase Agent Skills step; this plugin already bundles them.");
    expect(result).toContain("After adding config, restart OpenCode, then run:");
    expect(result).toContain("opencode mcp auth supabase");
    expect(result).toContain("Complete OAuth in the browser.");
    expect(result).not.toContain("if OAuth");
    expect(result).not.toContain("prompted automatically");
  });

  test("requires Supabase auth before opening MCP setup page", async () => {
    const { input } = await createInput();
    const openMock = mock(async () => undefined);
    const tools = createSupabaseTools(
      input,
      {
        clientId: "plugin-client",
        oauthPort: 17687,
      },
      { open: openMock },
    );

    await expect(
      tools.supabase_open_mcp_setup.execute({ project_ref: "proj_123" }, createContext(input)),
    ).rejects.toThrow("Supabase is not connected. Run /supabase first.");

    expect(openMock).not.toHaveBeenCalled();
  });

  test("supabase_login returns TUI guidance", async () => {
    const { input } = await createInput();

    const tools = createSupabaseTools(input, {
      clientId: "plugin-client",
      oauthPort: 17685,
    });

    await expect(tools.supabase_login.execute({}, createContext(input))).resolves.toBe(
      "Supabase login must be completed in the TUI. Run /supabase first.",
    );
  });
});
