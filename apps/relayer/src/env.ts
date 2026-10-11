// @kite/relayer boot env — Feature-004 guard pattern: abort by NAME, never a
// value. RELAYER_KEY holds RELAYER_ROLE and lives only here + secret storage.
import { optionalEnv, requireEnv } from "@kite/core";

export interface RelayerEnv {
  databaseUrl: string;
  internalKey: string;
  relayerKey: string;
  relayerPort: number;
  dripMonWei: bigint;
  dailyCapMonWei: bigint;
}

export function relayerEnv(): RelayerEnv {
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    internalKey: requireEnv("INTERNAL_API_KEY"),
    relayerKey: requireEnv("RELAYER_KEY"),
    // RELAYER_PORT wins for local overrides; Render assigns PORT (never set both).
    relayerPort: Number(optionalEnv("RELAYER_PORT") ?? optionalEnv("PORT") ?? 3001),
    dripMonWei: BigInt(optionalEnv("DRIP_MON_WEI") ?? "50000000000000000"),
    dailyCapMonWei: BigInt(optionalEnv("RELAYER_DAILY_CAP_MON_WEI") ?? "2000000000000000000"),
  };
}
