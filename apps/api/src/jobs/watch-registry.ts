// T019 — the ISA-lifecycle observer. The draft IS the share link's whole
// subject (FR-019): a drafted ISA must reach the isas cache within seconds of
// landing or /api/p answers deals:[] and the [Dukung] CTA has nothing to
// render. Same projection rule as sync-registry (constitution IV) — the logs
// only reveal ids, channelOf()/isaOf() state the truth — driven INCREMENTALLY
// from a job_state['registry_block'] checkpoint, so the request path (/api/p,
// /api/me) never walks logs itself (the whole-chain scan is what took the
// route down once already). Drafted ISAs are cached on purpose: status 1
// through 5 all land; only status 0 (None) is not a deal row.
//
// processNewRegistryLogs() is the exported unit so boot drives a catch-up
// pass BEFORE serving (a cold Render boot must answer the share link
// correctly on its first request) and keeps polling while warm.

import { KITE_DEPLOYMENT } from "@kite/contracts";
import { type AnyDb, channels, execute, ISA_STATUS_BY_CODE, isas, jobState } from "@kite/core/db";
import { eq } from "drizzle-orm";
import type { ChainClient } from "../services/chain.js";

export const REGISTRY_BLOCK_KEY = "registry_block";
// Topic-filtered getLogs — generous chunks stay RPC-friendly (sync-registry).
const RANGE = 50_000n;

export interface RegistryPassResult {
  channels: number;
  isas: number;
  fromBlock: bigint;
  toBlock: bigint;
}

async function checkpointOf(db: AnyDb, chain: ChainClient): Promise<bigint> {
  const rows = await db
    .select()
    .from(jobState)
    .where(eq(jobState.key, REGISTRY_BLOCK_KEY))
    .limit(1);
  const row = rows[0];
  if (row) {
    return BigInt(row.value);
  }
  const seeded = await chain.blockAtOrAfter(KITE_DEPLOYMENT.deployedAt);
  await db
    .insert(jobState)
    .values({ key: REGISTRY_BLOCK_KEY, value: seeded.toString() })
    .onConflictDoNothing();
  return seeded;
}

/** One observation pass: checkpoint → head. Idempotent end to end. */
export async function processNewRegistryLogs(
  db: AnyDb,
  chain: ChainClient,
): Promise<RegistryPassResult> {
  let checkpoint = await checkpointOf(db, chain);
  const passStart = checkpoint;
  const head = await chain.blockNumber();
  let channelCount = 0;
  let isaCount = 0;

  while (checkpoint < head) {
    const end = checkpoint + RANGE > head ? head : checkpoint + RANGE;

    // Chain reads happen BEFORE the write transaction — no RPC inside a tx.
    const channelIdSet = new Set(await chain.channelRegisteredIds(checkpoint + 1n, end));
    const isaIdSet = new Set(await chain.isaEventIds(checkpoint + 1n, end));
    const channelById = new Map<number, { name: string; pubkey: string; active: boolean }>();
    for (const id of channelIdSet) {
      channelById.set(id, await chain.channelOf(id));
    }
    const isaById = new Map<number, Awaited<ReturnType<ChainClient["isaOf"]>>>();
    for (const id of isaIdSet) {
      isaById.set(id, await chain.isaOf(id));
    }

    await execute(db, async (tx) => {
      for (const [id, channel] of channelById) {
        const row = { name: channel.name, pubkey: channel.pubkey, active: channel.active };
        await tx
          .insert(channels)
          .values({ id, ...row })
          .onConflictDoUpdate({ target: channels.id, set: row });
        channelCount++;
      }
      for (const [id, isa] of isaById) {
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
        await tx
          .insert(isas)
          .values({ isaId: id, ...row })
          .onConflictDoUpdate({ target: isas.isaId, set: row });
        isaCount++;
      }
      await tx
        .insert(jobState)
        .values({ key: REGISTRY_BLOCK_KEY, value: end.toString() })
        .onConflictDoUpdate({ target: jobState.key, set: { value: end.toString() } });
    });

    checkpoint = end;
  }

  return { channels: channelCount, isas: isaCount, fromBlock: passStart, toBlock: head };
}

// Standalone poller: bun run apps/api/src/jobs/watch-registry.ts — the boot
// wiring in index.ts drives the same unit in-process.
if (import.meta.main) {
  const { apiEnv } = await import("../env.js");
  const { makeNeonDb } = await import("@kite/core/db");
  const { makeChainClient } = await import("../services/chain.js");
  const db = makeNeonDb(apiEnv().databaseUrl);
  const chain = makeChainClient();
  console.log("[watch-registry] polling ISA lifecycle — ctrl-c to stop");
  for (;;) {
    const result = await processNewRegistryLogs(db, chain);
    if (result.channels > 0 || result.isas > 0) {
      console.log(
        `[watch-registry] channels=${result.channels} isas=${result.isas} ` +
          `blocks=${result.fromBlock}-${result.toBlock}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}
