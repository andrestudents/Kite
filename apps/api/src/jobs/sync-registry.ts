// T017: the projection-correctness bootstrap (constitution IV). Enumerates
// ChannelRegistered + isa lifecycle logs from the deployment block to head in
// bounded ranges, then upserts channels + isas STRICTLY from channelOf() /
// isaOf() — the logs only reveal ids, the contract states the truth. The
// watcher, /api/me and /api/p/:id all read this cache; chain is corrected
// INTO the DB here, never the reverse.
import { KITE_DEPLOYMENT } from "@kite/contracts";
import { ISA_STATUS_BY_CODE, type AnyDb, channels, isas } from "@kite/core/db";
import { type ChainClient } from "../services/chain.js";

// Bounded getLogs ranges — topic-filtered, so generous chunks stay RPC-friendly.
const RANGE = 50_000n;

export interface SyncResult {
  channels: number;
  isas: number;
  fromBlock: bigint;
  toBlock: bigint;
}

export async function syncRegistry(db: AnyDb, chain: ChainClient): Promise<SyncResult> {
  const fromBlock = await chain.blockAtOrAfter(KITE_DEPLOYMENT.deployedAt);
  const toBlock = await chain.blockNumber();

  const channelIds = new Set<number>();
  const isaIds = new Set<number>();
  for (let start = fromBlock; start <= toBlock; start += RANGE) {
    const end = start + RANGE - 1n > toBlock ? toBlock : start + RANGE - 1n;
    for (const id of await chain.channelRegisteredIds(start, end)) {
      channelIds.add(id);
    }
    for (const id of await chain.isaEventIds(start, end)) {
      isaIds.add(id);
    }
  }

  for (const id of channelIds) {
    const channel = await chain.channelOf(id);
    await db
      .insert(channels)
      .values({ id, name: channel.name, pubkey: channel.pubkey, active: channel.active })
      .onConflictDoUpdate({
        target: channels.id,
        set: { name: channel.name, pubkey: channel.pubkey, active: channel.active },
      });
  }

  let isaCount = 0;
  for (const id of isaIds) {
    const isa = await chain.isaOf(id);
    if (isa.status === 0) {
      continue; // status None — not a real deal row
    }
    const row = {
      seeker: isa.seeker,
      backer: isa.backer,
      principal: isa.principal,
      shareBps: isa.shareBps,
      capMult: isa.capMult,
      remaining: isa.remaining,
      status: ISA_STATUS_BY_CODE[isa.status] ?? `unknown:${isa.status}`,
      termEnd: isa.termEnd,
    };
    await db
      .insert(isas)
      .values({ isaId: id, ...row })
      .onConflictDoUpdate({ target: isas.isaId, set: row });
    isaCount++;
  }

  return { channels: channelIds.size, isas: isaCount, fromBlock, toBlock };
}

// Runnable bootstrap: bun run apps/api/src/jobs/sync-registry.ts
if (import.meta.main) {
  const { apiEnv } = await import("../env.js");
  const { makeNeonDb } = await import("@kite/core/db");
  const { makeChainClient } = await import("../services/chain.js");
  const env = apiEnv();
  const result = await syncRegistry(makeNeonDb(env.databaseUrl), makeChainClient());
  console.log(
    `[sync-registry] channels=${result.channels} isas=${result.isas} ` +
      `blocks=${result.fromBlock}-${result.toBlock}`,
  );
}
