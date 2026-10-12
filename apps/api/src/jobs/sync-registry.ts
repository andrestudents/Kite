// T017: the projection-correctness bootstrap (constitution IV). Enumerates
// ChannelRegistered + isa lifecycle logs from the deployment block to head in
// bounded ranges, then upserts channels + isas STRICTLY from channelOf() /
// isaOf() — the logs only reveal ids, the contract states the truth. The
// watcher, /api/me and /api/p/:id all read this cache; chain is corrected
// INTO the DB here, never the reverse.
import { KITE_DEPLOYMENT } from "@kite/contracts";
import { type AnyDb, channels, isas } from "@kite/core/db";
import { type ChainClient, getLogsChunk } from "../services/chain.js";
import { isaCacheRow } from "./watch-registry.js";

export interface SyncResult {
  channels: number;
  isas: number;
  fromBlock: bigint;
  toBlock: bigint;
}

export async function syncRegistry(db: AnyDb, chain: ChainClient): Promise<SyncResult> {
  const fromBlock = await chain.blockAtOrAfter(KITE_DEPLOYMENT.deployedAt);
  const toBlock = await chain.blockNumber();
  // Bounded getLogs ranges sized from KITE_GETLOGS_CHUNK — the public Monad
  // RPC caps one call at 100 blocks; a 50k literal here is what made the
  // bootstrap unrunnable there (see watch-registry).
  const range = getLogsChunk();

  const channelIds = new Set<number>();
  const isaIds = new Set<number>();
  for (let start = fromBlock; start <= toBlock; start += range) {
    const end = start + range - 1n > toBlock ? toBlock : start + range - 1n;
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
    const row = isaCacheRow(isa);
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
