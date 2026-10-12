// T030 — GET /api/p/:id (FR-004, D12): the PUBLIC profile. `:id` is a 0x
// bytes32 identityHash (resolved once through walletOfIdentity) or a wallet
// address. Reputation and deal terms read from the proxy; per-event history
// comes from the DB projection the settlement watcher maintains (purchases
// SETTLED + the §7.2 ledger split — the same source /api/me reads), NOT from
// a per-request log scan: the deployment→head eth_getLogs walk grew with the
// chain until it outran every provider cap and took the route down with it
// (500/502 for any FOUND profile). The watcher owns incremental log
// observation; this route only projects. The shape structurally carries NO
// personal data (D18); an unknown id is the same 404 whether it never
// existed or is simply empty.

import { KiteError } from "@kite/core";
import { type AnyDb, ISA_STATUS_BY_CODE, isas, ledgerEntries, purchases } from "@kite/core/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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

  // Deals: cache as index, proxy as truth; events from the DB projection
  // (purchases SETTLED + ledger split, written by the settlement watcher).
  const cached = await db
    .select({ isaId: isas.isaId })
    .from(isas)
    .where(sql`lower(${isas.seeker}) = ${lowered}`);

  const settled = await db
    .select({
      id: purchases.id,
      isaId: purchases.isaId,
      grossAusd: purchases.grossAusd,
      txHash: purchases.txHash,
      settledAt: purchases.settledAt,
    })
    .from(purchases)
    .innerJoin(isas, eq(purchases.isaId, isas.isaId))
    .where(and(sql`lower(${isas.seeker}) = ${lowered}`, eq(purchases.status, "SETTLED")))
    .orderBy(asc(purchases.settledAt));

  // The split lives in the append-only ledger (nothing else writes it):
  // out rows on backer:/seeker: accounts per purchase.
  const splitByPurchase = new Map<string, { toBacker: number; toSeeker: number }>();
  if (settled.length > 0) {
    const entries = await db
      .select({
        purchaseId: ledgerEntries.purchaseId,
        account: ledgerEntries.account,
        amountAusd: ledgerEntries.amountAusd,
      })
      .from(ledgerEntries)
      .where(
        inArray(
          ledgerEntries.purchaseId,
          settled.map((p) => p.id),
        ),
      );
    for (const e of entries) {
      if (!e.account.startsWith("backer:") && !e.account.startsWith("seeker:")) continue;
      const acc = splitByPurchase.get(e.purchaseId) ?? { toBacker: 0, toSeeker: 0 };
      if (e.account.startsWith("backer:")) acc.toBacker += e.amountAusd;
      else acc.toSeeker += e.amountAusd;
      splitByPurchase.set(e.purchaseId, acc);
    }
  }

  const deals: ProfileDto["deals"] = [];
  for (const row of cached) {
    const isaId = Number(row.isaId);
    const onchain = await chain.isaOf(isaId);

    // Contract truth (Stream.sol _settleFact): remaining -= toBacker per
    // settlement — per-event remainingAfter reconstructs by walking BACKWARD
    // from the live onchain remaining, so the newest row is exact by the
    // chain itself and older rows stay consistent with it.
    let remainingAfter = onchain.remaining;
    const rows = settled
      .filter((p) => Number(p.isaId) === isaId)
      .map((p) => ({ p, split: splitByPurchase.get(p.id) ?? null }))
      .reverse();
    const events: ProfileDto["deals"][number]["events"] = [];
    for (const { p, split } of rows) {
      // A settled purchase without its ledger split is an incomplete
      // projection — skip the event rather than show wrong money.
      if (split === null || !p.txHash || !p.settledAt) continue;
      events.push({
        grossAusd: p.grossAusd,
        toBackerAusd: split.toBacker,
        toSeekerAusd: split.toSeeker,
        remainingAusd: remainingAfter,
        txHash: p.txHash,
        blockTime: p.settledAt.toISOString(),
      });
      remainingAfter += split.toBacker;
    }
    events.reverse(); // oldest → newest, as the log scan produced

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
