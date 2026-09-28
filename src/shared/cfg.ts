import type { PluginOptions } from "./plugin-compat.ts";

import {
  DEFAULT_SUPABASE_API_BASE_URL,
  DEFAULT_SUPABASE_BROKER_URL,
  DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL,
  DEFAULT_SUPABASE_OAUTH_CLIENT_ID,
  DEFAULT_SUPABASE_OAUTH_PORT,
} from "./api.ts";
import type { SupabaseEnv, SupabaseSharedConfig } from "./types.ts";

function readStringOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readEnvString(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readSupabaseConfig(
  options: PluginOptions | undefined,
  env: SupabaseEnv = process.env,
): SupabaseSharedConfig {
  const clientId =
    readStringOption(options, "clientId") ??
    readEnvString(env.OPENCODE_SUPABASE_OAUTH_CLIENT_ID) ??
    DEFAULT_SUPABASE_OAUTH_CLIENT_ID;
  const brokerBaseUrl =
    readStringOption(options, "brokerBaseUrl") ??
    readEnvString(env.OPENCODE_SUPABASE_BROKER_URL) ??
    DEFAULT_SUPABASE_BROKER_URL;

  return {
    clientId,
    oauthPort: DEFAULT_SUPABASE_OAUTH_PORT,
    authorizeUrl:
      readStringOption(options, "authorizeUrl") ??
      env.SUPABASE_OAUTH_AUTHORIZE_URL ??
      DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL,
    brokerBaseUrl,
    apiBaseUrl:
      readStringOption(options, "apiBaseUrl") ?? env.SUPABASE_API_BASE_URL ?? DEFAULT_SUPABASE_API_BASE_URL,
  };
}
