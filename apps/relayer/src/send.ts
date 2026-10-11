// T022/T023 — the broadcast core (D6/D7/D10/FR-013). Every send:
//   1. resyncs the nonce from eth_getTransactionCount(relayer, "pending") —
//      the CHAIN count always wins (the same key is reused by hand in
//      MANUAL-LOOP, local drift is expected, D6);
//   2. broadcasts at the PUBLISHED fixed gas limit — never an estimate
//      (Monad charges on the limit, PLAN §6.1);
//   3. marks the job `sent` with tx + nonce BEFORE polling the receipt, so a
//      crash leaves an honest in-flight record (the D5 recovery path);
//   4. confirms ONLY on the per-kind proof (D7: receipt ≠ success) — a mined
//      receipt whose proof is missing is retryable, never confirmed;
//   5. on a mined result WITHOUT the proof refuses to blind-resend: only the
//      same proof showing the effect did NOT land allows a second broadcast
//      (FR-013 — "gated on a previous-job status check").
// Retry bookkeeping: attempts++, last_error, capped backoff, terminal_at
// when MAX_ATTEMPTS is exhausted (§7.3: "failed" iff terminal_at is set).

import { abis, KITE_DEPLOYMENT } from "@kite/contracts";
import { rpcUrl } from "@kite/core";
import { type AnyDb, JOB_STATUS, type RelayerJob, relayerJobs } from "@kite/core/db";
import { eq } from "drizzle-orm";
import type { Abi, Hash } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

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
}

/** One plain native transfer (the drip). */
export interface NativeSend {
  to: `0x${string}`;
  valueWei: bigint;
}

export interface MinedReceipt {
  status: "success" | "reverted";
  logs: unknown[];
}

/**
 * The per-kind D7 proof, evaluated against the mined receipt (its logs or a
 * fresh state read). True = the effect landed. Bind/activate/drip read state;
 * transfer_with_authorization parses the AUSD Transfer event (MockAUSD has no
 * authorizationState view — the log IS the evidence, T024).
 */
export type EffectProof = (receipt: MinedReceipt) => Promise<boolean>;

/**
 * The wallet surface, injectable for tests; the real one is viem. The read
 * methods exist for the per-kind proofs (identityOf/isaStatusOf/
 * balanceOfNative) alongside receiptWithLogs.
 */
export interface RelayerWallet {
  /** eth_getTransactionCount(relayer, "pending") — the resync source (D6). */
  transactionCountPending(): Promise<bigint>;
  /** Broadcast ONE contract call at an exact nonce + fixed gas limit → tx hash. */
  writeCall(plan: SendPlan, nonce: number): Promise<Hash>;
  /** Broadcast ONE native transfer (drip) → tx hash. */
  sendNative(to: `0x${string}`, valueWei: bigint, nonce: number): Promise<Hash>;
  /** null while unmined; a mined receipt carries its status + raw logs. */
  receiptWithLogs(txHash: string): Promise<MinedReceipt | null>;
  balanceOfNative(wallet: string): Promise<bigint>;
  identityOf(wallet: string): Promise<string>;
  isaStatusOf(isaId: number): Promise<number>;
}

export function makeRelayerWallet(relayerKey: string): RelayerWallet {
  const account = privateKeyToAccount(relayerKey as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(rpcUrl(), { timeout: 30_000 }),
  });
  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(rpcUrl(), { timeout: 15_000 }),
  });
  const read = (functionName: string, args: unknown[] = []): Promise<unknown> =>
    publicClient.readContract({
      address: KITE_DEPLOYMENT.kiteCore,
      abi: abis.kitecore as Abi,
      functionName,
      args,
    });
  return {
    async transactionCountPending() {
      const count = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
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
      } as Parameters<typeof wallet.writeContract>[0]);
    },
    async sendNative(to, valueWei, nonce) {
      return wallet.sendTransaction({ to, value: valueWei, nonce });
    },
    async receiptWithLogs(txHash) {
      try {
        const r = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
        return { status: r.status === "success" ? "success" : "reverted", logs: r.logs };
      } catch {
        return null; // not mined yet
      }
    },
    async balanceOfNative(addr) {
      return publicClient.getBalance({ address: addr as `0x${string}` });
    },
    async identityOf(addr) {
      return (await read("identityOf", [addr])) as string;
    },
    async isaStatusOf(isaId) {
      const raw = (await read("isaOf", [BigInt(isaId)])) as { status: number };
      return Number(raw.status);
    },
  };
}

export type JobOutcome =
  | { status: "confirmed"; txHash: string }
  | { status: "sent"; txHash: string } // broadcast, receipt unmined — worker re-polls
  | { status: "retryable"; error: string } // attempts < MAX — re-claim later
  | { status: "terminal"; error: string }; // attempts exhausted — terminal_at set

async function markSent(
  db: AnyDb,
  job: RelayerJob,
  txHash: string,
  nonce: number,
  attempts: number,
): Promise<void> {
  await db
    .update(relayerJobs)
    .set({ status: JOB_STATUS.sent, txHash, nonce, attempts, lastError: null })
    .where(eq(relayerJobs.id, job.id));
}

/** Marks a job confirmed without a broadcast — the read-back path. */
export async function confirmJob(db: AnyDb, job: RelayerJob): Promise<void> {
  await db
    .update(relayerJobs)
    .set({ status: JOB_STATUS.confirmed })
    .where(eq(relayerJobs.id, job.id));
}

/** Bookkeeping for a failed attempt — shared by sendOnce and dispatchJob. */
export async function markRetryableOrTerminal(
  db: AnyDb,
  job: RelayerJob,
  attempts: number,
  error: string,
): Promise<JobOutcome> {
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
  /** D7: a success receipt confirms ONLY when the per-kind proof passes. */
  proof?: EffectProof;
}

/** The one broadcast skeleton: resync nonce → exec → mark sent → poll. */
async function broadcast(
  db: AnyDb,
  wallet: RelayerWallet,
  job: RelayerJob,
  attempts: number,
  exec: (nonce: number) => Promise<Hash>,
  label: string,
  opts: SendOptions = {},
): Promise<JobOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  try {
    // D6: the chain's pending count wins over anything stored locally.
    const nonce = Number(await wallet.transactionCountPending());
    const txHash = await exec(nonce);
    await markSent(db, job, txHash, nonce, attempts);

    const tries = opts.receiptTries ?? 4;
    for (let i = 0; i < tries; i++) {
      if (i > 0) {
        await sleep(1_500);
      }
      const receipt = await wallet.receiptWithLogs(txHash);
      if (receipt?.status === "success") {
        if (opts.proof && !(await opts.proof(receipt))) {
          // Mined success without the effect: never confirm, never blind-resend.
          return {
            status: "retryable",
            error: `${label} receipt succeeded but the proof is missing (${txHash})`,
          };
        }
        await confirmJob(db, job);
        return { status: "confirmed", txHash };
      }
      if (receipt?.status === "reverted") {
        // Mined revert: money was charged. Whether to resend is the HANDLER's
        // proof decision (FR-013), never this function's.
        return { status: "retryable", error: `${label} reverted onchain (${txHash})` };
      }
    }
    return { status: "sent", txHash }; // unmined — keep the in-flight record
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return markRetryableOrTerminal(db, job, attempts, message);
  }
}

/** ONE contract-call attempt for a claimed job (D6/D10 above). */
export async function sendOnce(
  db: AnyDb,
  wallet: RelayerWallet,
  job: RelayerJob,
  plan: SendPlan,
  opts: SendOptions = {},
): Promise<JobOutcome> {
  return broadcast(
    db,
    wallet,
    job,
    job.attempts + 1,
    (nonce) => wallet.writeCall(plan, nonce),
    plan.functionName,
    opts,
  );
}

/** ONE native-transfer attempt (the drip). */
export async function sendNativeOnce(
  db: AnyDb,
  wallet: RelayerWallet,
  job: RelayerJob,
  send: NativeSend,
  opts: SendOptions = {},
): Promise<JobOutcome> {
  return broadcast(
    db,
    wallet,
    job,
    job.attempts + 1,
    (nonce) => wallet.sendNative(send.to, send.valueWei, nonce),
    "native transfer",
    opts,
  );
}

/**
 * The FR-013 gate for a job that may already be in flight: a `sent` job is
 * re-broadcast ONLY after its mined receipt + the proof show the effect did
 * NOT land (unmined keeps waiting — never a competing resend against a live
 * mempool entry). A proven effect confirms the job instead (D7). A `pending`
 * job (crash before broadcast) may always send; `confirmed` is finished
 * history. The SAME proof guards the fresh send's receipt (option 4 above).
 */
async function gatedSend(
  db: AnyDb,
  wallet: RelayerWallet,
  job: RelayerJob,
  proof: EffectProof,
  attempt: () => Promise<JobOutcome>,
): Promise<JobOutcome> {
  if (job.status === JOB_STATUS.confirmed) {
    return { status: "confirmed", txHash: job.txHash ?? "" };
  }
  if (job.status === JOB_STATUS.sent && job.txHash) {
    const receipt = await wallet.receiptWithLogs(job.txHash);
    if (!receipt) {
      return { status: "sent", txHash: job.txHash }; // unmined — keep waiting
    }
    if (await proof(receipt)) {
      await confirmJob(db, job);
      return { status: "confirmed", txHash: job.txHash };
    }
    // Mined but the effect did not land — the resend is now PROVEN safe.
  }
  return attempt();
}

/** The gate for contract-call kinds (bind/activate/transfer). */
export async function resendGated(
  db: AnyDb,
  wallet: RelayerWallet,
  job: RelayerJob,
  plan: SendPlan,
  proof: EffectProof,
  opts: Omit<SendOptions, "proof"> = {},
): Promise<JobOutcome> {
  return gatedSend(db, wallet, job, proof, () =>
    sendOnce(db, wallet, job, plan, { ...opts, proof }),
  );
}

/** The gate for the drip (native transfer). */
export async function resendNativeGated(
  db: AnyDb,
  wallet: RelayerWallet,
  job: RelayerJob,
  send: NativeSend,
  proof: EffectProof,
  opts: Omit<SendOptions, "proof"> = {},
): Promise<JobOutcome> {
  return gatedSend(db, wallet, job, proof, () =>
    sendNativeOnce(db, wallet, job, send, { ...opts, proof }),
  );
}
