// T032 (US4, FR-019..021, D16): the daily reconciliation — a READ-ONLY job.
// It never writes to purchases, the ledger, or the chain; its only output is
// ONE recon_daily row (day PK) plus an exit code. Backend side: Σ gross over
// purchases SETTLED with settled_at inside the UTC day. Chain side: Σ gross
// over IncomeSettled logs whose BLOCK timestamp falls inside the same day AND
// at/after job_state['recon_baseline_ts'] (research D15 — Feature-004's
// pre-backend seed settlements stay out of every verdict).
//
//   exit 0 → ok (totals equal, row written)
//   exit 1 → mismatch (row written, nothing repaired)
//   exit 2 → infra failure (NO row — never a verdict without evidence)

import { KiteError } from "@kite/core";
import {
  type AnyDb,
  execute,
  jobState,
  PURCHASE_STATUS,
  purchases,
  reconDaily,
} from "@kite/core/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { ChainClient } from "../services/chain.js";

export const BASELINE_KEY = "recon_baseline_ts";
export const RECON_EXIT = { ok: 0, mismatch: 1, infra: 2 } as const;
export type ReconStatus = "ok" | "mismatch";

export interface ReconResult {
  day: string;
  backendTotal: number;
  chainTotal: number;
  status: ReconStatus;
}

/** `--day YYYY-MM-DD` override; default is yesterday UTC. */
export function parseDayArg(raw?: string): string {
  if (raw === undefined) {
    return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new KiteError("bad_request", `--day must be YYYY-MM-DD, got "${raw}"`);
  }
  return raw;
}

/** Half-open UTC day [startSec, endSec) for a YYYY-MM-DD calendar day. */
export function dayBounds(day: string): { startSec: number; endSec: number } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const startSec = Date.UTC(y, m - 1, d) / 1000;
  return { startSec, endSec: startSec + 86_400 };
}

async function baselineSec(db: AnyDb): Promise<number> {
  const rows = await db.select().from(jobState).where(eq(jobState.key, BASELINE_KEY)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new KiteError("internal", `${BASELINE_KEY} is not stamped — run db:push first`);
  }
  const sec = Date.parse(row.value) / 1000;
  if (!Number.isFinite(sec)) {
    throw new KiteError("internal", `${BASELINE_KEY} is not a timestamp: "${row.value}"`);
  }
  return sec;
}

async function backendSettledTotal(db: AnyDb, startSec: number, endSec: number): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${purchases.grossAusd}), 0)` })
    .from(purchases)
    .where(
      and(
        eq(purchases.status, PURCHASE_STATUS.SETTLED),
        gte(purchases.settledAt, new Date(startSec * 1000)),
        lt(purchases.settledAt, new Date(endSec * 1000)),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

async function chainSettledTotal(
  chain: ChainClient,
  baseline: number,
  startSec: number,
  endSec: number,
): Promise<number> {
  const fromBlock = await chain.blockAtOrAfter(startSec);
  const toExclusive = await chain.blockAtOrAfter(endSec);
  // blockAtOrAfter returns head when the head predates the target — clamp so
  // the getLogs span never inverts.
  const endInclusive = toExclusive > fromBlock ? toExclusive - 1n : fromBlock;
  const logs = await chain.settlementLogs(fromBlock, endInclusive);

  // The block range only brackets the day — the exact per-block timestamps
  // decide membership (a log in a fetched block can still sit outside the day).
  const blockTime = new Map<number, number>();
  let total = 0;
  for (const log of logs) {
    const block = Number(log.blockNumber);
    let sec = blockTime.get(block);
    if (sec === undefined) {
      sec = await chain.blockTimestamp(log.blockNumber);
      blockTime.set(block, sec);
    }
    if (sec >= baseline && sec >= startSec && sec < endSec) {
      total += log.gross;
    }
  }
  return total;
}

/** One verdict for one UTC day. Throws on infra failure — the caller maps
 *  that to exit 2 WITHOUT writing a row (no verdict without evidence). */
export async function runRecon(db: AnyDb, chain: ChainClient, day: string): Promise<ReconResult> {
  const { startSec, endSec } = dayBounds(day);
  const baseline = await baselineSec(db);
  const backendTotal = await backendSettledTotal(db, startSec, endSec);
  const chainTotal = await chainSettledTotal(chain, baseline, startSec, endSec);
  const status: ReconStatus = backendTotal === chainTotal ? "ok" : "mismatch";

  await execute(db, async (tx) => {
    const row = { day, backendTotal, chainTotal, status };
    await tx
      .insert(reconDaily)
      .values(row)
      .onConflictDoUpdate({ target: reconDaily.day, set: row });
  });

  return { day, backendTotal, chainTotal, status };
}

// Standalone: bun run apps/api/src/jobs/recon.ts [--day YYYY-MM-DD]
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const day = parseDayArg(argv[0] === "--day" ? argv[1] : undefined);
  try {
    const { apiEnv } = await import("../env.js");
    const { makeNeonDb } = await import("@kite/core/db");
    const { makeChainClient } = await import("../services/chain.js");
    const result = await runRecon(makeNeonDb(apiEnv().databaseUrl), makeChainClient(), day);
    console.log(
      `[recon] ${result.day} backend=${result.backendTotal} chain=${result.chainTotal} → ${result.status}`,
    );
    process.exit(result.status === "ok" ? RECON_EXIT.ok : RECON_EXIT.mismatch);
  } catch (err) {
    console.error(
      `[recon] infra failure — no verdict row:`,
      err instanceof Error ? err.message : err,
    );
    process.exit(RECON_EXIT.infra);
  }
}
