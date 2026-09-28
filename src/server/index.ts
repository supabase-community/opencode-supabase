// Legacy V1 server entrypoint. Kept for OpenCode 1 compatibility; the V2
// implementation lives in src/index.v2.ts. Note that tool argument schemas now
// use the shared compat encoding (converted to JSON Schema by the V2
// entrypoint), so V1 hosts should consume a V1-era release of this package.
import type { PluginInput } from "@opencode-ai/plugin";

import { createServerLogWriter, createSupabaseLogger } from "../shared/log.ts";
import { createSupabaseAuth } from "./auth.ts";
import { registerSupabaseSkillPaths } from "./skills.ts";
import { type SupabaseToolInput, createSupabaseTools } from "./tools.ts";

const server = async (input: PluginInput, options?: Record<string, unknown>) => {
  const logger = createSupabaseLogger({
    write: createServerLogWriter(input.client),
  });

  const toolInput: SupabaseToolInput = {
    client: input.client as SupabaseToolInput["client"],
    directory: input.directory,
    worktree: input.worktree ?? input.directory,
    clearHostAuth: async () => {
      const url = new URL(
        `/auth/supabase?directory=${encodeURIComponent(input.directory)}`,
        input.serverUrl,
      );
      const response = await fetch(url.toString(), { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Failed to clear host auth: ${response.status}`);
      }
    },
  };

  return {
    config: async (config: object) => {
      registerSupabaseSkillPaths(config, options, {
        warn: logger.warn,
      });
    },
    auth: createSupabaseAuth(
      { directory: input.directory, worktree: input.worktree },
      options,
      { logger, toolInput },
    ),
    tool: createSupabaseTools(toolInput, options, { logger }),
  };
};

export default { id: "supabase", server };
