// T022 — the kind registry + the claimed-job glue. Handlers register per kind
// (T023/T024/T025); dispatchJob is the ONLY path the worker calls, and every
// handler failure lands in the same retry/terminal bookkeeping as a failed
// broadcast — no error escapes the queue's accounting.
import type { AnyDb, JobKind, RelayerJob } from "@kite/core/db";
import { confirmJob, type JobOutcome, type RelayerWallet, resendGated, type SendPlan } from "./send.js";
import { markRetryableOrTerminal } from "./send.js";

export interface RelayerContext {
  db: AnyDb;
  wallet: RelayerWallet;
  dripMonWei: bigint;
  dailyCapMonWei: bigint;
}

export type JobHandler = (ctx: RelayerContext, job: RelayerJob) => Promise<JobOutcome>;

const handlers: Partial<Record<JobKind, JobHandler>> = {};

export function registerHandler(kind: JobKind, handler: JobHandler): void {
  handlers[kind] = handler;
}

export async function dispatchJob(ctx: RelayerContext, job: RelayerJob): Promise<JobOutcome> {
  const handler = handlers[job.kind as JobKind];
  if (!handler) {
    return markRetryableOrTerminal(ctx.db, job, job.attempts + 1, `no handler registered for ${job.kind}`);
  }
  try {
    return await handler(ctx, job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return markRetryableOrTerminal(ctx.db, job, job.attempts + 1, message);
  }
}

/**
 * The claimed-job sequence for one kind's plan + read-back:
 *   sent + txHash?  → poll the receipt FIRST: success confirms; still unmined
 *                     keeps waiting (no resend against a live mempool entry);
 *                     a mined REVERT falls through to the FR-013 gate, where
 *                     only the per-kind read-back proving "not landed" allows
 *                     the re-broadcast (D7: the event, not the receipt).
 *   pending         → straight to the gated send.
 */
export async function runClaimed(
  ctx: RelayerContext,
  job: RelayerJob,
  plan: SendPlan,
  readBack: () => Promise<boolean>,
): Promise<JobOutcome> {
  if (job.status === "sent" && job.txHash) {
    const receipt = await ctx.wallet.receipt(job.txHash);
    if (receipt?.status === "success") {
      await confirmJob(ctx.db, job);
      return { status: "confirmed", txHash: job.txHash };
    }
    if (receipt === null) {
      return { status: "sent", txHash: job.txHash }; // unmined — keep waiting
    }
  }
  return resendGated(ctx.db, ctx.wallet, job, plan, readBack);
}
