// @kite/api boot env — Feature-004 guard pattern: abort by NAME, never a value.
import { optionalEnv, requireEnv } from "@kite/core";

export interface ApiEnv {
  databaseUrl: string;
  mitaKey: string;
  /** 006: the API→relayer hop — /jobs base URL + the INTERNAL key it wants. */
  relayerUrl: string;
  internalKey: string;
  apiPort: number;
}

export function apiEnv(): ApiEnv {
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    mitaKey: requireEnv("MITA_API_KEY"),
    relayerUrl: requireEnv("RELAYER_URL"),
    internalKey: requireEnv("INTERNAL_API_KEY"),
    apiPort: Number(optionalEnv("API_PORT") ?? 3000),
  };
}
