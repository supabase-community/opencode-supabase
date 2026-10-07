import type { PluginOptions } from "./plugin-compat.ts";

export type SupabaseEnv = Record<string, string | undefined>;

export type SupabaseConfigSource = PluginOptions | undefined;

export type SupabaseSharedConfig = {
  clientId: string;
  oauthPort: number;
  authorizeUrl: string;
  brokerBaseUrl: string;
  apiBaseUrl: string;
};

export type PkceCodes = {
  verifier: string;
  challenge: string;
};

export type SupabaseTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  id_token?: string;
  scope?: string;
};

export type TokenExchangeInput = {
  code: string;
  redirectUri: string;
  codeVerifier: string;
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
