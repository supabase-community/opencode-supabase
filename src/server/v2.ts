// V2 host registration builds on Rafael Santos's migration in PR #79.
// Keep V1's real Zod definitions; V2 accepts Standard Schema directly.
import fs from "node:fs";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin/tool";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { Credential } from "@opencode/schema/credential";
import type { Skill } from "@opencode/schema/skill";
import { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";
import { normalizeBrokerBaseUrl, refreshTokenThroughBroker } from "../shared/broker.ts";
import { readSupabaseConfig } from "../shared/cfg.ts";
import { createSupabaseLogger } from "../shared/log.ts";
import type { SupabaseTokenResponse } from "../shared/types.ts";
import { createSupabaseOAuth, stopSupabaseAuthServer } from "./auth.ts";
import { defaultSkillsRoot, resolveEnabledSupabaseSkills } from "./skills.ts";
import { NOT_CONNECTED_MESSAGE, createSupabaseTools } from "./tools.ts";

type Definition = {
  description: string;
  args: ToolDefinition["args"];
  execute: (input: Record<string, unknown>, context: {
    sessionID: string; messageID: string; agent: string;
  }) => Promise<string>;
};

const fromPromise = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (error) => error });
// ponytail: success entries stay for process lifetime (one per rotation per account);
// add an LRU cap only if that ever matters.
const refreshes = new Map<string, Promise<SupabaseTokenResponse>>();

export function setupV2Server(ctx: Context) {
  return Effect.gen(function* () {
    const owner = {};
    const options = ctx.options;
    const logger = createSupabaseLogger({
      write: async (entry) => {
        console[entry.level]("[opencode-supabase]", entry.message, entry.extra ?? {});
      },
    });
    yield* Effect.addFinalizer(() => Effect.promise(() => stopSupabaseAuthServer(owner)));
    const oauth = createSupabaseOAuth({
      directory: ctx.location.directory,
      worktree: ctx.location.project.directory,
    }, options, { logger, owner, persist: false });

    yield* ctx.integration.transform((editor) => {
      editor.update("supabase", (integration) => { integration.name = "Supabase"; });
      editor.method.update({
        integrationID: "supabase",
        method: { id: "supabase", type: "oauth", label: "Supabase" },
        authorize: () => Effect.gen(function* () {
          // The host closes this attempt's scope on cancel/expiry/completion.
          const authorization = yield* Effect.acquireRelease(
            fromPromise(() => oauth.authorize()),
            (authorization) => Effect.promise(authorization.cancel),
          );
          return {
            mode: "auto" as const,
            url: authorization.url,
            instructions: authorization.instructions,
            callback: fromPromise(async () => {
              const result = await authorization.callback();
              return {
                type: "oauth" as const,
                methodID: "supabase" as Credential.OAuth["methodID"],
                access: result.access, refresh: result.refresh, expires: result.expires,
              };
            }),
          };
        }),
        refresh: (credential) => fromPromise(async () => {
          const config = readSupabaseConfig(options);
          // Concurrent tools/Locations must not rotate the same refresh token twice.
          const key = `${normalizeBrokerBaseUrl(config.brokerBaseUrl)}:${credential.refresh}`;
          let pending = refreshes.get(key);
          if (!pending) {
            pending = refreshTokenThroughBroker(
              { baseUrl: config.brokerBaseUrl }, { refresh_token: credential.refresh }, undefined, logger,
            ).catch((error) => {
              // Success stays cached: the host persists the rotated credential only after
              // refresh() resolves, so late resolves with the still-stored old (single-use)
              // token must converge on the cached result instead of re-sending it.
              refreshes.delete(key);
              throw error;
            });
            refreshes.set(key, pending);
          }
          const tokens = await pending;
          return {
            ...credential,
            access: tokens.access_token,
            refresh: tokens.refresh_token,
            expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          };
        }),
      });
    });

    const resolveAuth = () => Effect.runPromise(Effect.gen(function* () {
      const connection = yield* ctx.integration.connection.active("supabase");
      if (!connection) throw new Error(NOT_CONNECTED_MESSAGE);
      const credential = yield* ctx.integration.connection.resolve(connection);
      if (credential?.type !== "oauth") throw new Error(NOT_CONNECTED_MESSAGE);
      return credential;
    }));
    const tools = createSupabaseTools({ resolveAuth }, options, { logger });
    yield* ctx.tool.transform((editor) => {
      for (const [name, toolDefinition] of Object.entries(tools)) {
        // The shared implementations use only these three context fields.
        const definition = toolDefinition as unknown as Definition;
        const input = tool.schema.object(definition.args);
        editor.add({
          name, description: definition.description, input,
          execute: (args, context) => Effect.tryPromise({
            try: async () => ({ content: await definition.execute(args, context) }),
            catch: (error) => new Tool.Error({ message: error instanceof Error ? error.message : String(error), error }),
          }),
        });
      }
    });

    yield* ctx.skill.transform((editor) => {
      for (const skill of resolveEnabledSupabaseSkills(options, { warn: logger.warn })) {
        const skillPath = path.join(defaultSkillsRoot(), skill, "SKILL.md");
        const content = fs.readFileSync(skillPath, "utf8");
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
        const meta = frontmatter ? Bun.YAML.parse(frontmatter) as Record<string, unknown> : {};
        editor.add({
          id: skill as Skill.Info["id"], name: skill as Skill.Info["name"],
          description: typeof meta.description === "string" ? meta.description : "",
          path: skillPath as Skill.Info["path"], content,
        });
      }
    });
  }).pipe(Effect.orDie);
}
