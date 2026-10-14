import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IntegrationEditor, IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { ToolEditor } from "@opencode/plugin/effect/tool";
import type { Credential } from "@opencode/schema/credential";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Exit, Scope } from "effect";
import { createSupabaseOAuth, stopSupabaseAuthServer } from "../src/server/auth.ts";
import server from "../src/server/index.ts";
import { readSavedAuth, writeSavedAuth } from "../src/server/store.ts";

const roots: string[] = [];
const scopes: Scope.Closeable[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const scope of scopes.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void));
  await stopSupabaseAuthServer();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "supabase-v2-test-"));
  roots.push(directory);
  const scope = await Effect.runPromise(Scope.make());
  scopes.push(scope);
  const tools = new Map<string, Tool.Info>();
  let method: IntegrationOAuthMethodRegistration | undefined;
  let active = true;
  let account = { type: "oauth", methodID: "supabase", access: "host-A", refresh: "refresh-A", expires: Date.now() + 3600000 } as Credential.OAuth;
  let activeCalls = 0;
  const context = {
    options: { skills: false, brokerBaseUrl: "https://example.com/broker" },
    location: { directory, project: { directory } },
    integration: {
      transform: (f: (editor: IntegrationEditor) => void) => Effect.sync(() => f({
        update: (_id: string, update: (integration: { id: string; name: string }) => void) => update({ id: "supabase", name: "supabase" }),
        method: { update: (value: IntegrationOAuthMethodRegistration) => { method = value; } },
      } as IntegrationEditor)),
      connection: {
        active: () => Effect.sync(() => { activeCalls++; return active ? { type: "credential", id: "A", label: "Account A" } : undefined; }),
        resolve: () => Effect.sync(() => account),
      },
    },
    tool: { transform: (f: (editor: ToolEditor) => void) => Effect.sync(() => f({ add: (t: Tool.Info) => tools.set(t.name, t) } as unknown as ToolEditor)) },
    skill: { transform: () => Effect.void },
  } as unknown as Context;
  await Effect.runPromise(server.effect(context).pipe(Scope.provide(scope)));
  const registered = method as IntegrationOAuthMethodRegistration | undefined;
  if (!registered?.refresh) throw new Error("Missing Supabase OAuth registration");
  return { directory, scope, tools, method: { ...registered, refresh: registered.refresh },
    select: (value: typeof account) => { account = value; },
    disconnect: () => { active = false; }, calls: () => activeCalls };
}

const toolContext = { sessionID: "session", messageID: "message", agent: "build", id: "call", progress: () => Effect.void } as unknown as Tool.Context;

describe("V2 server", () => {
  test("keeps both real host entrypoints and Zod optional argument validation", async () => {
    expect(typeof server.server).toBe("function");
    expect(typeof server.effect).toBe("function");
    const instance = await setup();
    const schema = instance.tools.get("supabase_create_project")?.input as import("zod").ZodType;
    expect(schema.parse({ organization_id: "org", name: "name" })).toEqual({ organization_id: "org", name: "name" });
    expect(() => schema.parse({ name: "name" })).toThrow();
    expect(() => schema.parse({ organization_id: "org", name: 1 })).toThrow();
  });

  test("tools follow the host account and refuse disconnected hosts despite local tokens", async () => {
    const instance = await setup();
    await writeSavedAuth({ directory: instance.directory, worktree: instance.directory }, { access: "local-B", refresh: "local-B-refresh", expires: Date.now() + 3600000 });
    const headers: string[] = [];
    globalThis.fetch = (async (_url, init) => { headers.push(new Headers(init?.headers).get("authorization") ?? ""); return Response.json([]); }) as typeof fetch;
    const tool = instance.tools.get("supabase_list_projects");
    if (!tool) throw new Error("Missing projects tool");
    await Effect.runPromise(tool.execute({}, toolContext));
    instance.select({ type: "oauth", methodID: "supabase", access: "host-C", refresh: "refresh-C", expires: Date.now() + 3600000 } as Credential.OAuth);
    await Effect.runPromise(tool.execute({}, toolContext));
    expect(headers).toEqual(["Bearer host-A", "Bearer host-C"]);
    instance.disconnect();
    await expect(Effect.runPromise(tool.execute({}, toolContext))).rejects.toThrow("Supabase is not connected");
    expect(headers).toHaveLength(2);
    expect(instance.calls()).toBe(3);
    const mcpTool = instance.tools.get("supabase_open_mcp_setup");
    if (!mcpTool) throw new Error("Missing MCP setup tool");
    await expect(Effect.runPromise(mcpTool.execute({ project_ref: "project" }, toolContext))).rejects.toThrow("Supabase is not connected");
  });

  test("refresh uses the supplied account rather than the local store", async () => {
    const instance = await setup();
    await writeSavedAuth({ directory: instance.directory, worktree: instance.directory }, { access: "local-B", refresh: "local-B-refresh", expires: Date.now() + 3600000 });
    let refreshToken: unknown;
    globalThis.fetch = (async (_url, init) => {
      refreshToken = JSON.parse(String(init?.body)).refresh_token;
      return Response.json({ access_token: "new-A", refresh_token: "new-refresh-A", expires_in: 3600, token_type: "bearer" });
    }) as typeof fetch;
    const old = { type: "oauth", methodID: "supabase", access: "expired-A", refresh: "refresh-A", expires: 0 } as Credential.OAuth;
    const result = await Effect.runPromise(instance.method.refresh(old));
    expect(refreshToken).toBe("refresh-A");
    expect(result.access).toBe("new-A");
    expect((await readSavedAuth({ directory: instance.directory, worktree: instance.directory })).auth?.access).toBe("local-B");
  });

  test("concurrent Locations refresh the same credential once without mixing accounts", async () => {
    const a = await setup();
    const b = await setup();
    const requests: string[] = [];
    globalThis.fetch = (async (_url, init) => {
      const token = JSON.parse(String(init?.body)).refresh_token;
      requests.push(token);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ access_token: `${token}-access`, refresh_token: `${token}-next`, expires_in: 3600, token_type: "bearer" });
    }) as typeof fetch;
    const credential = { type: "oauth", methodID: "supabase", access: "expired", refresh: "A", expires: 0 } as Credential.OAuth;
    const results = await Promise.all([
      Effect.runPromise(a.method.refresh(credential)),
      Effect.runPromise(b.method.refresh(credential)),
      Effect.runPromise(b.method.refresh({ ...credential, refresh: "B" })),
    ]);
    expect(requests).toEqual(["A", "B"]);
    expect(results.map((r) => r.access)).toEqual(["A-access", "A-access", "B-access"]);
  });

  test("closing one location leaves another location's OAuth pending; attempt scope cancels only its flow", async () => {
    const a = await setup();
    const b = await setup();
    const attemptScopeA = await Effect.runPromise(Scope.make());
    const attemptScopeB = await Effect.runPromise(Scope.make());
    scopes.push(attemptScopeA, attemptScopeB);
    const authorizationA = await Effect.runPromise(a.method.authorize({}).pipe(Scope.provide(attemptScopeA)));
    const authorizationB = await Effect.runPromise(b.method.authorize({}).pipe(Scope.provide(attemptScopeB)));
    if (authorizationA.mode !== "auto" || authorizationB.mode !== "auto") throw new Error("Expected auto OAuth");
    await Effect.runPromise(Scope.close(b.scope, Exit.void));
    await expect(Effect.runPromise(authorizationB.callback)).rejects.toThrow("OAuth callback server stopped");
    const url = new URL(authorizationA.url);
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");
    const response = await fetch(callback);
    expect(response.status).toBe(400);
    await expect(Effect.runPromise(authorizationA.callback)).rejects.toThrow("Missing authorization code");
    const fresh = await Effect.runPromise(a.method.authorize({}).pipe(Scope.provide(attemptScopeA)));
    if (fresh.mode !== "auto") throw new Error("Expected auto OAuth");
    await Effect.runPromise(Scope.close(attemptScopeA, Exit.void));
    await expect(Effect.runPromise(fresh.callback)).rejects.toThrow("OAuth authorization cancelled");
  });

  test("V2 OAuth does not write a second local credential copy", async () => {
    const { directory } = await setup();
    const auth = createSupabaseOAuth({ directory, worktree: directory }, { clientId: "test" }, {
      persist: false, callbackPorts: [17710, 17711, 17712],
      fetch: async () => Response.json({ access_token: "A", refresh_token: "R", expires_in: 3600, token_type: "bearer" }),
    });
    const authorization = await auth.authorize();
    const url = new URL(authorization.url);
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");
    callback.searchParams.set("code", "fake-code");
    expect((await fetch(callback)).status).toBe(200);
    expect((await authorization.callback()).access).toBe("A");
    expect(await readSavedAuth({ directory, worktree: directory })).toEqual({ version: 1 });
  });
});
