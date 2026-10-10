// T022 — the broadcast core (D6/D10/FR-013). Every send:
//   1. resyncs the nonce from eth_getTransactionCount(relayer, "pending") —
//      the CHAIN count always wins (the same key is reused by hand in
//      MANUAL-LOOP, local drift is expected, D6);
//   2. broadcasts at the PUBLISHED fixed gas limit — never an estimate
//      (Monad charges on the limit, PLAN §6.1);
//   3. marks the job `sent` with tx + nonce BEFORE polling the receipt, so a
//      crash leaves an honest in-flight record (the D5 recovery path);
//   4. on a mined REVERT refuses to blind-resend: the caller supplies the
//      per-kind read-back, and only proof the effect did NOT land allows a
//      second broadcast (FR-013 — "gated on a previous-job status check").
// Retry bookkeeping: attempts++, last_error, capped backoff, terminal_at
// when MAX_ATTEMPTS is exhausted (§7.3: "failed" iff terminal_at is set).
import { eq } from "drizzle-orm";
import type { Abi, Hash } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { KiteError } from "@kite/core";
import { rpcUrl } from "@kite/core";
import {
  JOB_STATUS,
  type AnyDb,
  type RelayerJob,
  relayerJobs,
} from "@kite/core/db";

export const MAX_ATTEMPTS = 3;

/** Capped exponential backoff between attempts: 500ms × 2^(n-1), ≤ 8s. */
export function backoffMs(attempts: number): number {
  return Math.min(500 * 2 ** Math.max(0, attempts - 1), 8_000);
}

/** One contract call, fully specified — the plan is built per job kind. */
export interface SendPlan {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args: unknown[];
  /** The published fixedLimit — sent verbatim as gas (D10). */
  gasFixedLimit: number;
  valueWei?: bigint;
}

/** The wallet surface, injectable for tests; the real one is viem. */
export interface RelayerWallet {
  /** eth_getTransactionCount(relayer, "pending") — the resync source (D6). */
  transactionCountPending(): Promise<bigint>;
  /** Broadcast ONE call at an exact nonce + fixed gas limit → tx hash. */
  writeCall(plan: SendPlan, nonce: number): Promise<Hash>;
  /** null while unmined; a mined receipt carries its status. */
  receipt(txHash: string): Promise<{ status: "success" | "reverted" } | null>;
}

export function makeRelayerWallet(relayerKey: string): RelayerWallet {
  const account = privateKeyToAccount(relayerKey as `0x${string}`);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpcUrl(), { timeout: 30_000 }) });
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl(), { timeout: 15_000 }) });
  return {
    async transactionCountPending() {
      const count = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
      return BigInt(count);
    },
    async writeCall(plan, nonce) {
      return wallet.writeContract({
        address: plan.address,
        abi: plan.abi,
        functionName: plan.functionName,
        args: plan.args as never[],
        gas: BigInt(plan.gasFixedLimit),
        nonce,
        ...(plan.valueWei !== undefined ? { value: plan.valueWei } : {}),
      } as Parameters<typeof wallet.writeContract>[0]);
    },
    async receipt(txHash) {
      try {
        const r = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
        return { status: r.status === "success" ? "success" : "reverted" };
      } catch {
        return null; // not mined yet
      }
    },
  };
}

export type JobOutcome =
  | { status: "confirmed"; txHash: string }
  | { status: "sent"; txHash: string } // broadcast, receipt unmined — worker re-polls
  | { status: "retryable"; error: string } // attempts < MAX — re-claim later
  | { status: "terminal"; error: string }; // attempts exhausted — terminal_at set

async function markSent(db: AnyDb, job: RelayerJob, txHash: string, nonce: number, attempts: number): Promise<void> {
  await db
    .update(relayerJobs)
    .set({ status: JOB_STATUS.sent, txHash, nonce, attempts, lastError: null })
    .where(eq(relayerJobs.id, job.id));
}

/** Marks a job confirmed without a broadcast — the read-back/receipt path. */
export async function confirmJob(db: AnyDb, job: RelayerJob): Promise<void> {
  await db.update(relayerJobs).set({ status: JOB_STATUS.confirmed }).where(eq(relayerJobs.id, job.id));
}

/** Bookkeeping for a failed attempt — shared by sendOnce and dispatchJob. */
export async function markRetryableOrTerminal(db: AnyDb, job: RelayerJob, attempts: number, error: string): Promise<JobOutcome> {
  if (attempts >= MAX_ATTEMPTS) {
    await db
      .update(relayerJobs)
      .set({ attempts, lastError: error.slice(0, 500), terminalAt: new Date() })
      .where(eq(relayerJobs.id, job.id));
    return { status: "terminal", error };
  }
  await db
    .update(relayerJobs)
    .set({ attempts, lastError: error.slice(0, 500) })
    .where(eq(relayerJobs.id, job.id));
  return { status: "retryable", error };
}

export interface SendOptions {
  /** Receipt polls after the broadcast (default 4; the worker re-polls later too). */
  receiptTries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * ONE send attempt for a claimed job: resync nonce → broadcast at the fixed
 * limit → mark sent → poll the receipt. Never call this on a `sent` job
 * without going through resendGated — that is the FR-013 rule.
 */
export async function sendOnce(db: AnyDb, wallet: RelayerWallet, job: RelayerJob, plan: SendPlan, opts: SendOptions = {}): Promise<JobOutcome> {
  const attempts = job.attempts + 1;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  try {
    // D6: the chain's pending count wins over anything stored locally.
    const nonce = Number(await wallet.transactionCountPending());
    const txHash = await wallet.writeCall(plan, nonce);
    await markSent(db, job, txHash, nonce, attempts);

    const tries = opts.receiptTries ?? 4;
    for (let i = 0; i < tries; i++) {
      if (i > 0) {
        await sleep(1_500);
      }
      const receipt = await wallet.receipt(txHash);
      if (receipt?.status === "success") {
        await confirmJob(db, job);
        return { status: "confirmed", txHash };
      }
      if (receipt?.status === "reverted") {
        // Mined revert: money was charged. Whether to resend is the HANDLER's
        // read-back decision (FR-013), never this function's.
        return { status: "retryable", error: `${plan.functionName} reverted onchain (${txHash})` };
      }
    }
    return { status: "sent", txHash }; // unmined — keep the in-flight record
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return markRetryableOrTerminal(db, job, attempts, message);
  }
}

/**
 * The FR-013 gate for a job that may already be in flight: a `sent` job is
 * re-broadcast ONLY after readBack() proves the effect did NOT land. A
 * landed effect confirms the job instead (D7: receipt ≠ success — the
 * read-back is the truth). A `pending` job (crash before broadcast) may
 * always send; `confirmed` is finished history.
 */
export async function resendGated(
  db: AnyDb,
  wallet: RelayerWallet,
  job: RelayerJob,
  plan: SendPlan,
  readBack: () => Promise<boolean>,
  opts: SendOptions = {},
): Promise<JobOutcome> {
  if (job.status === JOB_STATUS.confirmed) {
    return { status: "confirmed", txHash: job.txHash ?? "" };
  }
  if (job.status === JOB_STATUS.sent) {
    if (await readBack()) {
      await confirmJob(db, job);
      return { status: "confirmed", txHash: job.txHash ?? "" };
    }
    // Not landed — resend is now PROVEN safe (the previous attempt died
    // without effect). Continue to a fresh send below.
  }
  return sendOnce(db, wallet, job, plan, opts);
}
