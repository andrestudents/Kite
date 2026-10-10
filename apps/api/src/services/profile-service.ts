// T030 — GET /api/p/:id (FR-004, D12): the PUBLIC profile. `:id` is a 0x
// bytes32 identityHash (resolved once through walletOfIdentity) or a wallet
// address. Reputation and deal terms read from the proxy; per-event history
// comes from the observed settlement LOGS (chain truth), located via the isas
// cache index. The shape structurally carries NO personal data (D18); an
// unknown id is the same 404 whether it never existed or is simply empty.

import { KITE_DEPLOYMENT } from "@kite/contracts";
import { KiteError } from "@kite/core";
import { type AnyDb, ISA_STATUS_BY_CODE, isas } from "@kite/core/db";
import { sql } from "drizzle-orm";
import { isAddress } from "viem";
import type { ChainClient } from "./chain.js";
import { ZERO_BYTES32 } from "./fake-chain.js";

export const EXPLORER_BASE_URL = "https://testnet.monadscan.com";

export interface ProfileDto {
  id: string;
  wallet: string;
  reputation: { score: number; completedDeals: number; qualEvents: number };
  deals: Array<{
    isaId: number;
    principalAusd: number;
    shareBps: number;
    capAusd: number;
    totalDivertedAusd: number;
    status: string;
    events: Array<{
      grossAusd: number;
      toBackerAusd: number;
      toSeekerAusd: number;
      remainingAusd: number;
      txHash: string;
      blockTime: string;
    }>;
  }>;
  explorerBaseUrl: string;
}

export async function getProfile(
  db: AnyDb,
  chain: ChainClient,
  id: string | undefined,
): Promise<ProfileDto> {
  let wallet: string | null = null;
  if (id && /^0x[0-9a-fA-F]{64}$/.test(id)) {
    const resolved = await chain.walletOfIdentity(id);
    if (resolved.toLowerCase() !== ZERO_BYTES32) {
      wallet = resolved;
    }
  } else if (id && isAddress(id)) {
    wallet = id;
  }
  if (!wallet || !id) {
    throw new KiteError("profile_not_found", "no such profile");
  }
  const lowered = wallet.toLowerCase();

  // A wallet with no identity and no deals at all is unknown to the public surface.
  const [profile, identityHash] = [await chain.profileOf(wallet), await chain.identityOf(wallet)];
  if (profile.totalIsas === 0 && identityHash.toLowerCase() === ZERO_BYTES32) {
    throw new KiteError("profile_not_found", "no such profile");
  }
  const score = await chain.scoreOf(wallet);

  // Deals: cache as index, proxy as truth; events from the settlement logs.
  const cached = await db
    .select({ isaId: isas.isaId })
    .from(isas)
    .where(sql`lower(${isas.seeker}) = ${lowered}`);

  const from = await chain.blockAtOrAfter(KITE_DEPLOYMENT.deployedAt);
  const head = await chain.blockNumber();
  const logs = (await chain.settlementLogs(from, head)).filter((l) => l.isaId !== undefined);
  const blockTimes = new Map<number, string>();
  const blockTimeOf = async (blockNumber: bigint): Promise<string> => {
    const key = Number(blockNumber);
    const cachedIso = blockTimes.get(key);
    if (cachedIso) {
      return cachedIso;
    }
    const iso = new Date((await chain.blockTimestamp(blockNumber)) * 1000).toISOString();
    blockTimes.set(key, iso);
    return iso;
  };

  const deals: ProfileDto["deals"] = [];
  for (const row of cached) {
    const isaId = Number(row.isaId);
    const onchain = await chain.isaOf(isaId);
    const dealLogs = logs.filter((l) => l.isaId === isaId);
    const events = [];
    for (const log of dealLogs) {
      events.push({
        grossAusd: log.gross,
        toBackerAusd: log.toBacker,
        toSeekerAusd: log.toSeeker,
        remainingAusd: log.remaining,
        txHash: log.txHash,
        blockTime: await blockTimeOf(log.blockNumber),
      });
    }
    deals.push({
      isaId,
      principalAusd: onchain.principal,
      shareBps: onchain.shareBps,
      capAusd: Math.floor((onchain.principal * onchain.capMult) / 100),
      totalDivertedAusd: events.reduce((acc, e) => acc + e.toSeekerAusd, 0),
      status: ISA_STATUS_BY_CODE[onchain.status] ?? `unknown:${onchain.status}`,
      events,
    });
  }

  return {
    id,
    wallet,
    reputation: {
      score,
      completedDeals: profile.completed,
      qualEvents: profile.qualEvents,
    },
    deals,
    explorerBaseUrl: EXPLORER_BASE_URL,
  };
}
