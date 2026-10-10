// T029 — GET /api/me (FR-003): ONE merged response for the demo identity
// header. Chain-authoritative fields (balance, profile, active deal) are read
// from the proxy in this feature (constitution IV) — the isas cache is only
// the INDEX that finds candidate deals; every value shown is re-read onchain.
// History comes from the DB projection. Empty state is a valid 200, never an
// error.

import { KiteError } from "@kite/core";
import { type AnyDb, isas, purchases } from "@kite/core/db";
import { desc, eq, sql } from "drizzle-orm";
import { isAddress } from "viem";
import type { ChainClient } from "./chain.js";
import { ZERO_BYTES32 } from "./fake-chain.js";

export interface MeDto {
  wallet: string;
  balanceAusd: number;
  identityBound: boolean;
  profile: {
    score: number;
    maxSupportAusd: number;
    totalIsas: number;
    completed: number;
    qualEvents: number;
    distinctBackers: number;
  };
  activeIsa: {
    isaId: number;
    backer: string;
    principalAusd: number;
    shareBps: number;
    capMult: number;
    capAusd: number;
    remainingAusd: number;
    progressBps: number;
    termEnd: number;
    channelId: number;
  } | null;
  recentPurchases: Array<{
    purchaseRef: string;
    grossAusd: number;
    status: string;
    txHash: string | null;
    settledAt: string | null;
  }>;
}

export async function getMe(
  db: AnyDb,
  chain: ChainClient,
  walletHeader: string | undefined,
): Promise<MeDto> {
  if (!walletHeader || !isAddress(walletHeader)) {
    throw new KiteError("invalid_wallet", "x-kite-wallet must be a valid address");
  }
  const wallet = walletHeader as `0x${string}`;
  const lowered = wallet.toLowerCase();

  const [identityHash, balanceRaw, score, maxSupportAusd, profile] = await Promise.all([
    chain.identityOf(wallet),
    chain.balanceAusd(wallet),
    chain.scoreOf(wallet),
    chain.offerOf(wallet),
    chain.profileOf(wallet),
  ]);

  // Active deal: the cache finds candidates; the PROXY states the truth.
  let activeIsa: MeDto["activeIsa"] = null;
  const cached = await db
    .select({ isaId: isas.isaId })
    .from(isas)
    .where(sql`lower(${isas.seeker}) = ${lowered}`);
  for (const row of cached) {
    const onchain = await chain.isaOf(Number(row.isaId));
    if (onchain.status === 2 && onchain.seeker.toLowerCase() === lowered) {
      const cap = Math.floor((onchain.principal * onchain.capMult) / 100);
      activeIsa = {
        isaId: Number(row.isaId),
        backer: onchain.backer,
        principalAusd: onchain.principal,
        shareBps: onchain.shareBps,
        capMult: onchain.capMult,
        capAusd: cap,
        remainingAusd: onchain.remaining,
        progressBps: cap > 0 ? Math.floor(((cap - onchain.remaining) * 10_000) / cap) : 0,
        termEnd: onchain.termEnd,
        channelId: onchain.channelId,
      };
      break;
    }
  }

  // History is the DB projection (http-api: recentPurchases from DB).
  const recent = await db
    .select({
      purchaseRef: purchases.purchaseRef,
      grossAusd: purchases.grossAusd,
      status: purchases.status,
      txHash: purchases.txHash,
      settledAt: purchases.settledAt,
    })
    .from(purchases)
    .innerJoin(isas, eq(purchases.isaId, isas.isaId))
    .where(sql`lower(${isas.seeker}) = ${lowered}`)
    .orderBy(desc(purchases.createdAt))
    .limit(5);

  return {
    wallet,
    balanceAusd: Number(balanceRaw),
    identityBound: identityHash.toLowerCase() !== ZERO_BYTES32,
    profile: {
      score,
      maxSupportAusd,
      totalIsas: profile.totalIsas,
      completed: profile.completed,
      qualEvents: profile.qualEvents,
      distinctBackers: profile.distinctBackers,
    },
    activeIsa,
    recentPurchases: recent.map((p) => ({
      purchaseRef: p.purchaseRef,
      grossAusd: p.grossAusd,
      status: p.status,
      txHash: p.txHash,
      settledAt: p.settledAt ? p.settledAt.toISOString() : null,
    })),
  };
}
