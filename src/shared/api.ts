export const DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL = "https://api.supabase.com/v1/oauth/authorize";
export const DEFAULT_SUPABASE_API_BASE_URL = "https://api.supabase.com/v1";
export const DEFAULT_SUPABASE_BROKER_URL = "https://mujltteqbakexagllqjg.supabase.co/functions/v1/opencode-supabase-broker";
export const DEFAULT_SUPABASE_OAUTH_CLIENT_ID = "254ee667-f2c8-4c44-b7ad-e48232dcbd44";
export const DEFAULT_SUPABASE_OAUTH_PORT = 14589;

import type { FetchLike, SupabaseSharedConfig } from "./types.ts";

export async function supabaseManagementApiFetch(
  config: Pick<SupabaseSharedConfig, "apiBaseUrl">,
  accessToken: string,
  path: string,
  init?: RequestInit,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const url = `${config.apiBaseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

  return fetchImpl(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
}
