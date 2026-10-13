// T018: the settlement observer (research D9). Polls IncomeSettled in bounded
// ranges from the job_state['settlements_block'] checkpoint (first seed =
// the deployment block, resolved from KITE_DEPLOYMENT.deployedAt). Every log
// is CLAIMED via webhook_events["10143:<block>:<logIndex>"] — UNIQUE, so a
// replayed/double-delivered log is a no-op by construction. A claim matching
// a PAID purchase moves it PAID → SETTLED (tx hash + block-timestamp
// settled_at), writes the §7.2 ledger split, and refreshes the isas cache
// from isaOf() — the FR-009 read-back: the DB is corrected FROM chain, never
// the reverse. Events with no PAID match bump the unmatched counter.
//
// processNewLogs() is the exported unit so submit-settlement and the gates
// drive observation IN-PROCESS (SC-002 needs no separately-running watcher).

import { KITE_DEPLOYMENT } from "@kite/contracts";
import { KiteError } from "@kite/core";
import {
  type AnyDb,
  execute,
  ISA_STATUS_BY_CODE,
  isas,
  jobState,
  PURCHASE_STATUS,
  purchases,
  purchaseTransitions,
  webhookEvents,
} from "@kite/core/db";
import { and, eq } from "drizzle-orm";
import {
  type ChainClient,
  getLogsChunk,
  type IsaOnchain,
  type SettlementLog,
} from "../services/chain.js";
import { writeSettlement } from "../services/ledger.js";

export const SETTLEMENTS_BLOCK_KEY = "settlements_block";
export const UNMATCHED_KEY = "unmatched_settlement_events";
const CHAIN_ID = KITE_DEPLOYMENT.chainId;

export interface ProcessResult {
  settled: number;
  unmatched: number;
  fromBlock: bigint;
  toBlock: bigint;
}

async function checkpointOf(db: AnyDb, chain: ChainClient): Promise<bigint> {
  const rows = await db
    .select()
    .from(jobState)
    .where(eq(jobState.key, SETTLEMENTS_BLOCK_KEY))
    .limit(1);
  const row = rows[0];
  if (row) {
    return BigInt(row.value);
  }
  const seeded = await chain.blockAtOrAfter(KITE_DEPLOYMENT.deployedAt);
  await db
    .insert(jobState)
    .values({ key: SETTLEMENTS_BLOCK_KEY, value: seeded.toString() })
    .onConflictDoNothing();
  return seeded;
}

function upsertIsaRow(isaId: number, isa: IsaOnchain) {
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
  return { isaId, ...row };
}

/** One observation pass: checkpoint → head. Idempotent end to end. An
 *  optional `deadlineMs` bounds the walk (submit-settlement's observation
 *  uses it): a checkpoint far behind head on a small-chunk RPC is thousands
 *  of serial getLogs — a pass that cannot finish within its budget stops and
 *  the committed checkpoint says where the next pass resumes. */
export async function processNewLogs(
  db: AnyDb,
  chain: ChainClient,
  opts: { deadlineMs?: number } = {},
): Promise<ProcessResult> {
  let checkpoint = await checkpointOf(db, chain);
  const passStart = checkpoint;
  const head = await chain.blockNumber();
  // The pass range reads KITE_GETLOGS_CHUNK like every getLogs caller (the
  // public RPC caps calls at 100 blocks; settlementLogs re-chunks inside, so
  // a range above the cap degrades to more calls — not to a failure — but
  // sizing it honestly keeps the claim txs to one per span).
  const range = getLogsChunk();
  let settled = 0;
  let unmatched = 0;

  while (checkpoint < head) {
    if (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) {
      break; // out of budget — resume from the committed checkpoint next pass
    }
    const end = checkpoint + range > head ? head : checkpoint + range;

    // Chain reads happen BEFORE the write transaction — no RPC inside a tx.
    const logs: SettlementLog[] = await chain.settlementLogs(checkpoint + 1n, end);
    const isaById = new Map<number, IsaOnchain>();
    const blockTime = new Map<number, number>();
    for (const log of logs) {
      if (!isaById.has(log.isaId)) {
        isaById.set(log.isaId, await chain.isaOf(log.isaId));
      }
      const block = Number(log.blockNumber);
      if (!blockTime.has(block)) {
        blockTime.set(block, await chain.blockTimestamp(log.blockNumber));
      }
    }

    await execute(db, async (tx) => {
      for (const log of logs) {
        const eventId = `${CHAIN_ID}:${log.blockNumber}:${log.logIndex}`;
        const claimed = await tx
          .insert(webhookEvents)
          .values({ providerEventId: eventId })
          .onConflictDoNothing()
          .returning();
        if (claimed.length === 0) {
          continue; // replayed / double-delivered log — a no-op by claim
        }

        const matches = await tx
          .select()
          .from(purchases)
          .where(
            and(
              eq(purchases.channelId, log.channelId),
              eq(purchases.purchaseRef, log.purchaseRef.toLowerCase()),
              eq(purchases.status, PURCHASE_STATUS.PAID),
            ),
          )
          .limit(1);
        const purchase = matches[0];
        const isa = isaById.get(log.isaId);
        if (!purchase || !isa) {
          unmatched++;
          continue;
        }

        const blockSec = blockTime.get(Number(log.blockNumber));
        if (blockSec === undefined) {
          throw new KiteError("internal", `no block time cached for block ${log.blockNumber}`);
        }
        await tx
          .update(purchases)
          .set({
            status: PURCHASE_STATUS.SETTLED,
            txHash: log.txHash,
            settledAt: new Date(blockSec * 1000),
          })
          .where(and(eq(purchases.id, purchase.id), eq(purchases.status, PURCHASE_STATUS.PAID)));
        await tx.insert(purchaseTransitions).values({
          purchaseId: purchase.id,
          fromStatus: PURCHASE_STATUS.PAID,
          toStatus: PURCHASE_STATUS.SETTLED,
          actor: "watcher",
        });
        await writeSettlement(tx, purchase, {
          gross: log.gross,
          toBacker: log.toBacker,
          toSeeker: log.toSeeker,
          backer: isa.backer,
          seeker: isa.seeker,
        });
        settled++;
      }

      // FR-009 read-back: every isa touched by this range re-projects from chain.
      for (const [isaId, isa] of isaById) {
        const row = upsertIsaRow(isaId, isa);
        await tx.insert(isas).values(row).onConflictDoUpdate({ target: isas.isaId, set: row });
      }

      await tx
        .insert(jobState)
        .values({ key: SETTLEMENTS_BLOCK_KEY, value: end.toString() })
        .onConflictDoUpdate({ target: jobState.key, set: { value: end.toString() } });
    });

    checkpoint = end;
  }

  if (unmatched > 0) {
    await bumpUnmatched(db, unmatched);
  }
  return { settled, unmatched, fromBlock: passStart, toBlock: head };
}

async function bumpUnmatched(db: AnyDb, by: number): Promise<void> {
  const rows = await db.select().from(jobState).where(eq(jobState.key, UNMATCHED_KEY)).limit(1);
  const current = rows[0] ? Number(rows[0].value) : 0;
  await db
    .insert(jobState)
    .values({ key: UNMATCHED_KEY, value: String(current + by) })
    .onConflictDoUpdate({ target: jobState.key, set: { value: String(current + by) } });
}

// Standalone poller: bun run apps/api/src/jobs/watch-settlements.ts — for
// observation only; the gates and submit-settlement never depend on it.
if (import.meta.main) {
  const { apiEnv } = await import("../env.js");
  const { makeNeonDb } = await import("@kite/core/db");
  const { makeChainClient } = await import("../services/chain.js");
  const db = makeNeonDb(apiEnv().databaseUrl);
  const chain = makeChainClient();
  console.log("[watch-settlements] polling IncomeSettled — ctrl-c to stop");
  for (;;) {
    const result = await processNewLogs(db, chain);
    if (result.settled > 0 || result.unmatched > 0) {
      console.log(
        `[watch-settlements] settled=${result.settled} unmatched=${result.unmatched} ` +
          `blocks=${result.fromBlock}-${result.toBlock}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
}
