// One-time registry backfill — bun run registry:backfill [--wallet 0x…]
//
// Projects the isas cache from LIVE isaOf() reads with NO getLogs at all, so
// a checkpoint stuck behind an RPC block-range cap cannot hold the share
// link hostage (T019 device gate). Ids are sequential from 1 and isaOf on an
// unassigned id returns status None (never reverts), so the sweep walks
// upward and stops after a run of consecutive empty ids.
//
// Why not activeISA(wallet)? The contract sets activeISA only at ACTIVATION
// (ISA.sol:200) — a Drafted deal is invisible to it, and the draft is the
// whole point (FR-019). A --wallet argument only NARROWS the report; every
// found ISA is upserted either way — the cache is a projection, and more
// chain truth in it is strictly better. The historical getLogs scan
// (watch-registry) remains the ongoing mechanism; this is the unjam tool.

import { type AnyDb, isas } from "@kite/core/db";
import { isAddress } from "viem";
import type { ChainClient } from "../services/chain.js";
import { isaCacheRow } from "./watch-registry.js";

export const SWEEP_GAP = 100n; // consecutive None ids that mean "past the end"
export const SWEEP_CAP = 5_000n; // hard stop — demo-scale ids never approach this

export interface BackfillResult {
  scannedIds: bigint;
  cached: number;
  matches: Array<{ isaId: number; status: string; seeker: string; backer: string }>;
}

export async function backfillRegistry(
  db: AnyDb,
  chain: ChainClient,
  opts: { wallet?: string; gap?: bigint; cap?: bigint } = {},
): Promise<BackfillResult> {
  const gap = opts.gap ?? SWEEP_GAP;
  const cap = opts.cap ?? SWEEP_CAP;
  const lowered = opts.wallet?.toLowerCase();
  const matches: BackfillResult["matches"] = [];
  let cached = 0;
  let emptyRun = 0n;
  let scanned = 0n;

  for (let id = 1n; id <= cap && emptyRun < gap; id += 1n) {
    scanned += 1n;
    const isa = await chain.isaOf(Number(id));
    if (isa.status === 0) {
      emptyRun += 1n;
      continue;
    }
    emptyRun = 0n;
    const row = isaCacheRow(isa);
    await db
      .insert(isas)
      .values({ isaId: Number(id), ...row })
      .onConflictDoUpdate({ target: isas.isaId, set: row });
    cached++;
    if (lowered && (isa.seeker.toLowerCase() === lowered || isa.backer.toLowerCase() === lowered)) {
      matches.push({
        isaId: Number(id),
        status: row.status,
        seeker: isa.seeker,
        backer: isa.backer,
      });
    }
  }

  return { scannedIds: scanned, cached, matches };
}

function walletArg(argv: readonly string[]): string | undefined {
  const flag = argv.indexOf("--wallet");
  const raw = flag >= 0 ? argv[flag + 1] : undefined;
  if (raw === undefined) {
    return undefined;
  }
  if (!isAddress(raw)) {
    throw new Error(`--wallet must be an address, got ${raw}`);
  }
  return raw;
}

if (import.meta.main) {
  // The unjam tool needs exactly ONE env var — the database. apiEnv() would
  // demand the server's full surface (RELAYER_URL et al.), which a recovery
  // script has no business requiring.
  const { requireEnv } = await import("@kite/core");
  const { makeNeonDb } = await import("@kite/core/db");
  const { makeChainClient } = await import("../services/chain.js");
  const wallet = walletArg(process.argv.slice(2));
  const result = await backfillRegistry(makeNeonDb(requireEnv("DATABASE_URL")), makeChainClient(), {
    wallet,
  });
  console.log(
    `[registry-backfill] scanned≈${result.scannedIds} ids, upserted=${result.cached} ISA rows`,
  );
  if (wallet) {
    if (result.matches.length === 0) {
      console.log(`[registry-backfill] no ISA found for ${wallet}`);
    }
    for (const m of result.matches) {
      console.log(`[registry-backfill] isaId=${m.isaId} status=${m.status} seeker=${m.seeker}`);
    }
  }
}
