// T022/T023 — the kind registry + the claimed-job glue. Handlers register per
// kind (jobs/bind-identity, drip, transfer-with-authorization,
// activate-with-permit); dispatchJob is the ONLY path the worker calls, and
// every failure lands in the same retry/terminal bookkeeping as a failed
// broadcast — no error escapes the queue's accounting. Retries are bounded:
// a third retryable outcome terminals the job, and a malformed payload (a
// bad_request from the handler's parser) can never succeed, so it terminals
// immediately.
import { KiteError } from "@kite/core";
import type { AnyDb, JobKind, RelayerJob } from "@kite/core/db";
import {
  type JobOutcome,
  MAX_ATTEMPTS,
  markRetryableOrTerminal,
  type RelayerWallet,
} from "./send.js";

export interface RelayerContext {
  db: AnyDb;
  wallet: RelayerWallet;
  dripMonWei: bigint;
  dailyCapMonWei: bigint;
}

export type JobHandler = (ctx: RelayerContext, job: RelayerJob) => Promise<JobOutcome>;
/** Payload guard run at the ENQUEUE edge — a malformed payload is refused with
 *  bad_request before any row exists; the handler-side parse remains as
 *  defense in depth. */
export type PayloadValidator = (payload: unknown) => void;

const handlers: Partial<Record<JobKind, JobHandler>> = {};
const validators: Partial<Record<JobKind, PayloadValidator>> = {};

export function registerHandler(
  kind: JobKind,
  handler: JobHandler,
  validate?: PayloadValidator,
): void {
  handlers[kind] = handler;
  if (validate) {
    validators[kind] = validate;
  }
}

/** The HTTP edge: refuse a payload the handler could never execute. */
export function validateJobPayload(kind: string, payload: unknown): void {
  const validator = validators[kind as JobKind];
  if (!validator) {
    return; // unknown kinds are rejected by enqueue's kind check
  }
  validator(payload);
}

export async function dispatchJob(ctx: RelayerContext, job: RelayerJob): Promise<JobOutcome> {
  const handler = handlers[job.kind as JobKind];
  if (!handler) {
    // All four kinds register at boot; this is a build/registration bug —
    // terminal, retrying cannot fix it.
    return markRetryableOrTerminal(
      ctx.db,
      job,
      MAX_ATTEMPTS,
      `no handler registered for ${job.kind}`,
    );
  }
  try {
    const outcome = await handler(ctx, job);
    if (outcome.status === "retryable" && job.attempts + 1 >= MAX_ATTEMPTS) {
      return markRetryableOrTerminal(ctx.db, job, job.attempts + 1, outcome.error);
    }
    return outcome;
  } catch (err) {
    // KiteErrors keep their machine code in the stored error (visible failure, D5).
    const message =
      err instanceof KiteError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    if (err instanceof KiteError && err.code === "bad_request") {
      return markRetryableOrTerminal(ctx.db, job, MAX_ATTEMPTS, message);
    }
    return markRetryableOrTerminal(ctx.db, job, job.attempts + 1, message);
  }
}
