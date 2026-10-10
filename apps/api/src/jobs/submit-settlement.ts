// T019 — Demo Tool (constitution VIII, research D8): the mill would submit its
// own signed income at the counter; for the demo Kite's console submits it on
// the mill's behalf from ORCHESTRATOR_KEY. The mill's EIP-712 signature was
// captured at purchase creation (§7.1) — this job only replays it, it cannot
// invent one. Broadcast goes at the PUBLISHED fixed limit (PLAN §6.1: Monad
// charges on the limit — never estimate), then the watcher pass observes
// in-process (no separate watcher). A terminal revert (deal no longer active,
// cap reached) is the FAILED leg: failed_reason + the PAID → FAILED transition.
// Exit 0 settled / 1 failed.

import { abis, KITE_DEPLOYMENT, KITE_GAS_LIMITS } from "@kite/contracts";
import { KiteError, requireEnv } from "@kite/core";
import { type AnyDb, PURCHASE_STATUS, purchases } from "@kite/core/db";
import { eq } from "drizzle-orm";
import type { Abi, Hex } from "viem";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { type ChainClient, rpcUrl } from "../services/chain.js";
import { markPurchaseFailed } from "../services/purchase-service.js";
import { processNewLogs } from "./watch-settlements.js";

const GAS_LIMIT = KITE_GAS_LIMITS.receiveIncome.fixedLimit;

export interface IncomeCall {
  isaId: number;
  purchaseRef: Hex;
  gross: number;
  salt: Hex;
  v: number;
  r: Hex;
  s: Hex;
  gasLimit: number;
}

/** The broadcast leg, injectable for tests. Returns the tx hash; THROWS on a
 *  terminal revert (viem simulates before broadcasting). */
export type IncomeSubmitter = (call: IncomeCall) => Promise<string>;

export interface SubmitOutcome {
  status: "SETTLED" | "FAILED";
  txHash?: string;
  reason?: string;
}

export interface SubmitOptions {
  submit?: IncomeSubmitter;
  /** Observation passes after the broadcast (default 3). */
  passes?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function printSubmitterBanner(): void {
  console.log("┌──────────────────────────────────────────────────────────────┐");
  console.log("│ DEMO TOOL — settlement submitter                             │");
  console.log("│ Kite submits the mill's signed income on its behalf.         │");
  console.log("└──────────────────────────────────────────────────────────────┘");
}

/** Terminal = the contract refused the settlement (inactive deal, cap …).
 *  viem names pre-broadcast simulation failures ExecutionRevertedError. */
export function isTerminalRevert(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const name = (err as { name?: unknown }).name;
  const message = String((err as { message?: unknown }).message ?? "");
  return name === "ExecutionRevertedError" || /revert/i.test(message);
}

function shortReason(err: unknown): string {
  const e = err as { shortMessage?: unknown; message?: unknown };
  return String(e.shortMessage ?? e.message ?? "unknown revert").slice(0, 300);
}

/** The real broadcast: viem wallet on ORCHESTRATOR_KEY, published fixed limit. */
export function defaultSubmitter(): IncomeSubmitter {
  const account = privateKeyToAccount(requireEnv("ORCHESTRATOR_KEY") as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(rpcUrl(), { timeout: 30_000 }),
  });
  return async (call) =>
    wallet.writeContract({
      address: KITE_DEPLOYMENT.kiteCore,
      abi: abis.kitecore as Abi,
      functionName: "receiveIncome",
      args: [
        BigInt(call.isaId),
        call.purchaseRef,
        BigInt(call.gross),
        call.salt,
        BigInt(call.v),
        call.r,
        call.s,
      ],
      gas: BigInt(call.gasLimit),
    });
}

export async function submitSettlement(
  db: AnyDb,
  chain: ChainClient,
  purchaseId: string,
  opts: SubmitOptions = {},
): Promise<SubmitOutcome> {
  printSubmitterBanner();

  const rows = await db.select().from(purchases).where(eq(purchases.id, purchaseId)).limit(1);
  const purchase = rows[0];
  if (!purchase) {
    throw new KiteError("purchase_not_found", "no such purchase");
  }
  if (purchase.status !== PURCHASE_STATUS.PAID) {
    throw new KiteError(
      "invalid_transition",
      `settlement submit expects a PAID purchase, got ${purchase.status}`,
    );
  }

  const submit = opts.submit ?? defaultSubmitter();
  const passes = opts.passes ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let txHash: string;
  try {
    txHash = await submit({
      isaId: purchase.isaId,
      purchaseRef: purchase.purchaseRef as Hex,
      gross: purchase.grossAusd,
      salt: purchase.millSig.salt as Hex,
      v: purchase.millSig.v,
      r: purchase.millSig.r as Hex,
      s: purchase.millSig.s as Hex,
      gasLimit: GAS_LIMIT,
    });
    console.log(
      `[submit-settlement] receiveIncome broadcast at fixed limit ${GAS_LIMIT}: ${txHash}`,
    );
  } catch (err) {
    if (!isTerminalRevert(err)) {
      throw err; // transient (network …) — the caller may retry
    }
    const reason = `receiveIncome reverted: ${shortReason(err)}`;
    await markPurchaseFailed(db, purchaseId, "submit-settlement", reason);
    console.log(`[submit-settlement] terminal revert — purchase FAILED: ${reason}`);
    return { status: "FAILED", reason };
  }

  for (let pass = 0; pass < passes; pass++) {
    if (pass > 0) {
      await sleep(1_500);
    }
    await processNewLogs(db, chain);
    const after = await db.select().from(purchases).where(eq(purchases.id, purchaseId)).limit(1);
    if (after[0]?.status === PURCHASE_STATUS.SETTLED) {
      return { status: "SETTLED", txHash };
    }
  }
  throw new KiteError(
    "settlement_not_observed",
    `broadcast ${txHash} not observed as settled after ${passes} passes`,
  );
}

// CLI: bun run apps/api/src/jobs/submit-settlement.ts <purchaseId>
if (import.meta.main) {
  const purchaseId = process.argv[2];
  if (!purchaseId) {
    console.error("usage: bun run apps/api/src/jobs/submit-settlement.ts <purchaseId>");
    process.exit(2);
  }
  const { apiEnv } = await import("../env.js");
  const { makeNeonDb } = await import("@kite/core/db");
  const { makeChainClient } = await import("../services/chain.js");
  try {
    const env = apiEnv();
    const outcome = await submitSettlement(
      makeNeonDb(env.databaseUrl),
      makeChainClient(),
      purchaseId,
    );
    console.log(
      `[submit-settlement] ${outcome.status}${outcome.txHash ? ` tx=${outcome.txHash}` : ""}` +
        (outcome.reason ? ` reason=${outcome.reason}` : ""),
    );
    process.exit(outcome.status === "SETTLED" ? 0 : 1);
  } catch (err) {
    console.error("[submit-settlement]", err);
    process.exit(1);
  }
}
