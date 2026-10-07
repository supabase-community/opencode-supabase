// V2 plugin entrypoint for opencode-supabase.
//
// Ports the V1 server plugin (src/server/index.ts) to the V2 plugin API:
// - `config` hook        -> `ctx.skill.transform()` (skills are first-class in V2)
// - `auth` hook          -> `ctx.integration.transform()` OAuth method registration
// - `tool` map           -> `ctx.tool.transform()` with JSON Schema tool definitions
// - plugin input/options -> `ctx.location` and `ctx.options`
//
// OAuth, token refresh, the local callback server, and the Supabase Management
// API tools are preserved from the V1 implementation; only the host
// integration points changed.

import fs from "node:fs";
import path from "node:path";

import { Plugin } from "@opencode/plugin";
import type { Credential } from "@opencode/schema/credential";
import type { Skill } from "@opencode/schema/skill";

import { createSupabaseAuth, stopSupabaseAuthServer } from "./server/auth.ts";
import {
  defaultSkillsRoot,
  resolveEnabledSupabaseSkills,
} from "./server/skills.ts";
import { createSupabaseTools, ensureSupabaseToolAuth } from "./server/tools.ts";
import { createSupabaseLogger } from "./shared/log.ts";
import { type PluginOptions, type ToolDefinition, toJsonSchemaInput } from "./shared/plugin-compat.ts";

type V1AuthMethod = {
  label: string;
  authorize(inputs?: Record<string, string>): Promise<{
    url: string;
    instructions: string;
    method: "auto";
    callback: () => Promise<
      | { type: "success"; access: string; refresh: string; expires: number }
      | { type: "failed" }
    >;
  }>;
};

function parseSkillFrontmatter(content: string, fallbackId: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  const meta: Record<string, string> = {};
  if (match?.[1]) {
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator > 0) {
        meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
      }
    }
  }
  return {
    name: meta.name || fallbackId,
    description: meta.description || "",
  };
}

export default Plugin.define({
  id: "supabase",
  async setup(ctx) {
    const options = (ctx.options ?? undefined) as PluginOptions;
    const directory = ctx.location.directory as string;
    const projectDirectory = ctx.location.project.directory as string;
    const worktree = projectDirectory !== directory ? projectDirectory : undefined;

    // Logging goes through the host when the context exposes the app domain;
    // otherwise entries are dropped (log.ts still surfaces writer failures).
    const appDomain = (ctx as unknown as {
      app?: { log?: (input: { body: unknown }) => Promise<unknown> };
    }).app;
    const logger = createSupabaseLogger({
      write: (entry) =>
        appDomain?.log ? appDomain.log({ body: entry }) : Promise.resolve(undefined),
    });

    // V2 keeps durable state in plugin storage instead of the V1 host auth
    // endpoints (`PUT/DELETE /auth/supabase`). The tool layer talks to this
    // writer through the same narrow interface the V1 client exposed.
    const client = {
      auth: {
        set: async (input: {
          body: { type: string; access: string; refresh: string; expires: number };
        }) => {
          await ctx.storage.set("auth/supabase", input.body);
        },
      },
    };
    const clearHostAuth = () => ctx.storage.remove("auth/supabase");

    const toolInput = { client, directory, worktree: worktree ?? directory, clearHostAuth };

    // Skills: register the bundled skill directories through the skill
    // transform instead of mutating a global config object.
    const enabledSkills = resolveEnabledSupabaseSkills(options, {
      warn: (message, data) => void logger.warn(message, data),
    });
    const skillsRoot = defaultSkillsRoot();

    await ctx.skill.transform((editor) => {
      for (const skill of enabledSkills) {
        const skillPath = path.join(skillsRoot, skill, "SKILL.md");
        if (!fs.existsSync(skillPath)) {
          void logger.warn("bundled Supabase skill directory not found", {
            skill,
            path: skillPath,
          });
          continue;
        }
        const content = fs.readFileSync(skillPath, "utf8");
        const meta = parseSkillFrontmatter(content, skill);
        editor.add({
          id: skill as Skill.Info["id"],
          name: meta.name as Skill.Info["name"],
          description: meta.description,
          path: skillPath as Skill.Info["path"],
          content,
        });
      }
    });

    // Tools: the V1 definitions are reused; only the registration mechanism
    // and the argument encoding (JSON Schema) changed.
    const tools = createSupabaseTools(toolInput, options, { logger });
    await ctx.tool.transform((editor) => {
      for (const [name, definition] of Object.entries(tools)) {
        const def = definition as ToolDefinition;
        editor.add({
          name,
          description: def.description,
          input: toJsonSchemaInput(def.args),
          async execute(input, context) {
            const result = await def.execute(input, context);
            return {
              content:
                typeof result === "string" ? result : JSON.stringify(result, null, 2),
            };
          },
        });
      }
    });

    // OAuth: register the Supabase integration with an auto (browser) OAuth
    // method backed by the existing local callback server and PKCE flow, plus
    // a refresh handler that reuses the tool-layer token refresh.
    const { methods } = createSupabaseAuth({ directory, worktree }, options, {
      logger,
      toolInput,
    });
    const loginMethod = methods.find((method) => method.label === "Supabase") as
      | V1AuthMethod
      | undefined;
    if (!loginMethod) {
      throw new Error("Supabase OAuth method was not produced by the auth module");
    }

    await ctx.integration.transform((editor) => {
      editor.update("supabase", (integration) => {
        integration.name ??= "Supabase";
      });
      editor.method.update({
        integrationID: "supabase",
        method: { id: "supabase", type: "oauth", label: "Supabase" },
        authorize: async () => {
          // Starts the local callback server and browser authorization; the
          // pending authorization resolves through the OAuth redirect.
          const authorization = await loginMethod.authorize();
          return {
            mode: "auto" as const,
            url: authorization.url,
            instructions: authorization.instructions,
            callback: authorization.callback().then((result) => {
              if (result.type !== "success") {
                throw new Error("Supabase authorization failed");
              }
              return {
                type: "oauth" as const,
                methodID: "supabase" as Credential.OAuth["methodID"],
                access: result.access,
                refresh: result.refresh,
                expires: result.expires,
              };
            }),
          };
        },
        refresh: async (credential) => {
          const auth = await ensureSupabaseToolAuth(toolInput, options, { logger });
          return { ...credential, access: auth.access, refresh: auth.refresh, expires: auth.expires };
        },
      });
    });

    return () => {
      void stopSupabaseAuthServer();
    };
  },
});
