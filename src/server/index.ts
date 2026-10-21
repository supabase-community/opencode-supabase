import type { Plugin } from "@opencode-ai/plugin";

import { createServerLogWriter, createSupabaseLogger } from "../shared/log.ts";
import { createSupabaseAuth } from "./auth.ts";
import { registerSupabaseSkillPaths } from "./skills.ts";
import { createSupabaseTools } from "./tools.ts";
import { setupV2Server } from "./v2.ts";

const server: Plugin = async (input, options) => {
  const logger = createSupabaseLogger({
    write: createServerLogWriter(input.client),
  });

  return {
    config: async (config) => {
      registerSupabaseSkillPaths(config, options, {
        warn: logger.warn,
      });
    },
    auth: createSupabaseAuth(input, options, { logger }),
    tool: createSupabaseTools(input, options, { logger }),
  };
};

// Both hosts resolve ./server. Each consumes only its own registration hook.
export default { id: "supabase", server, effect: setupV2Server };
