// T022 — the claim/send loop, SAME process as the HTTP queue (D5: one
// process, at most one transaction in flight per key). Pacing: idle ticks
// wait 1s; a retryable outcome waits the job's capped backoff before the
// next claim, so attempts breathe instead of hammering.

import { dispatchJob, type RelayerContext } from "./dispatch.js";
import { claimJob } from "./queue.js";
import { backoffMs } from "./send.js";

export interface WorkerHandle {
  stop(): void;
  /** Resolves when the loop notices the stop flag. */
  done(): Promise<void>;
}

export function startWorker(ctx: RelayerContext): WorkerHandle {
  let running = true;
  let wake: (() => void) | undefined;
  const loop = (async () => {
    while (running) {
      let waitMs = 1_000;
      try {
        const job = await claimJob(ctx.db);
        if (job) {
          console.log(`[relayer-worker] job=${job.id} kind=${job.kind} status=${job.status}`);
          const outcome = await dispatchJob(ctx, job);
          console.log(`[relayer-worker] job=${job.id} → ${outcome.status}`);
          if (outcome.status === "retryable") {
            waitMs = backoffMs(job.attempts);
          }
        }
      } catch (err) {
        console.error("[relayer-worker]", err);
        waitMs = backoffMs(2);
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, waitMs);
      });
    }
  })();
  return {
    stop() {
      running = false;
      wake?.();
    },
    done: () => loop,
  };
}
