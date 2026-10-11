// T021 — the §7.2 queue (research D5): idempotent enqueue by clientRef, FIFO
// claim over FOR UPDATE SKIP LOCKED, and the D5 invariant "one transaction in
// flight per key, always" — a job found in `sent` (its worker died after
// broadcast) is claimed BEFORE any pending job, so the recovery path resolves
// it (confirm by read-back or gated resend, FR-013) instead of starting a
// second transaction. SKIP LOCKED keeps concurrent claimers on different rows;
// the read-back gate keeps a racing pair from ever double-sending.

import { KiteError } from "@kite/core";
import {
  type AnyDb,
  execute,
  JOB_KINDS,
  JOB_STATUS,
  type RelayerJob,
  relayerJobs,
} from "@kite/core/db";
import { and, asc, eq, isNull } from "drizzle-orm";

export interface EnqueueInput {
  kind: string;
  payload: unknown;
  clientRef?: string;
}

/** The GET /jobs/:id shape (http-api contract, T021). */
export function toJobDto(job: RelayerJob) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    txHash: job.txHash,
    lastError: job.lastError,
    terminalAt: job.terminalAt ? job.terminalAt.toISOString() : null,
  };
}

function mustJob(rows: RelayerJob[], what: string): RelayerJob {
  const job = rows[0];
  if (!job) {
    throw new KiteError("internal", `expected ${what} row missing`);
  }
  return job;
}

/** Enqueue or return the job an earlier call with the same clientRef created. */
export async function enqueue(
  db: AnyDb,
  input: EnqueueInput,
): Promise<{ job: RelayerJob; created: boolean }> {
  if (!(JOB_KINDS as readonly string[]).includes(input.kind)) {
    throw new KiteError("unknown_kind", `unknown job kind: ${input.kind}`);
  }
  if (input.clientRef) {
    const existing = await db
      .select()
      .from(relayerJobs)
      .where(eq(relayerJobs.clientRef, input.clientRef))
      .limit(1);
    const row = existing[0];
    if (row) {
      return { job: row, created: false };
    }
  }
  const inserted = await db
    .insert(relayerJobs)
    .values({
      kind: input.kind,
      payloadJson: input.payload as Record<string, unknown>,
      clientRef: input.clientRef ?? null,
      status: JOB_STATUS.pending,
    })
    .returning();
  return { job: mustJob(inserted, "inserted job"), created: true };
}

export async function getJob(db: AnyDb, id: number): Promise<RelayerJob> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new KiteError("job_not_found", "no such job");
  }
  const rows = await db.select().from(relayerJobs).where(eq(relayerJobs.id, id)).limit(1);
  const job = rows[0];
  if (!job) {
    throw new KiteError("job_not_found", "no such job");
  }
  return job;
}

/**
 * The one claim (D5). Prefers an in-flight `sent` job — crash recovery comes
 * before new work, and its resolution is never a blind resend: the handler
 * proves state with the per-kind read-back first (FR-013 / D7).
 */
export async function claimJob(db: AnyDb): Promise<RelayerJob | undefined> {
  return execute(db, async (tx) => {
    const inFlight = await tx
      .select()
      .from(relayerJobs)
      .where(and(eq(relayerJobs.status, JOB_STATUS.sent), isNull(relayerJobs.terminalAt)))
      .orderBy(asc(relayerJobs.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (inFlight[0]) {
      return inFlight[0];
    }
    const queued = await tx
      .select()
      .from(relayerJobs)
      .where(and(eq(relayerJobs.status, JOB_STATUS.pending), isNull(relayerJobs.terminalAt)))
      .orderBy(asc(relayerJobs.id))
      .limit(1)
      .for("update", { skipLocked: true });
    return queued[0];
  });
}

/** Direct status writer for tests and the worker bookkeeping (T022). */
export async function setJobStatus(db: AnyDb, id: number, status: string): Promise<void> {
  await db.update(relayerJobs).set({ status }).where(eq(relayerJobs.id, id));
}
