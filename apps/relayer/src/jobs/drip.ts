// T023 — the drip handler (FR-017, §7.2 rule 5). ONE native transfer of
// DRIP_MON_WEI per wallet, ever: the drips PK is the once-lock (a wallet with
// a row confirms duplicates with no send; the insert collapses concurrent
// rows), the day's ceiling is checked BEFORE any broadcast, and the D7 proof
// is the wallet's native balance reaching at least the drip amount.
import { drips } from "@kite/core/db";
import { assertDripWithinDailyCap, hasDripped } from "../caps.js";
import { registerHandler } from "../dispatch.js";
import { confirmJob, resendNativeGated } from "../send.js";
import { asPayload, requireAddress } from "./parse.js";

/** One parser for BOTH edges: the enqueue validator and the handler itself.
 *  (The daily cap is context, not payload — it is checked at dispatch.) */
function parseDrip(raw: unknown) {
  return { wallet: requireAddress(asPayload(raw), "wallet") };
}

registerHandler(
  "drip",
  async (ctx, job) => {
    const { wallet } = parseDrip(job.payloadJson);

    // FR-017 once-lock: the row means the wallet got its one drip already.
    if (await hasDripped(ctx.db, wallet)) {
      await confirmJob(ctx.db, job);
      return { status: "confirmed", txHash: job.txHash ?? "" };
    }

    // §7.2 rule 5: admit against the day's ceiling before touching the chain.
    await assertDripWithinDailyCap(ctx.db, ctx.dripMonWei, ctx.dailyCapMonWei);

    // D7 proof: the (fresh) wallet's native balance rose to the drip amount.
    const proof = async () => (await ctx.wallet.balanceOfNative(wallet)) >= ctx.dripMonWei;
    const outcome = await resendNativeGated(
      ctx.db,
      ctx.wallet,
      job,
      { to: wallet, valueWei: ctx.dripMonWei },
      proof,
    );

    if (outcome.status === "confirmed" && outcome.txHash) {
      // The PK insert IS the once-lock; a racing duplicate lands here as a no-op.
      await ctx.db.insert(drips).values({ wallet, txHash: outcome.txHash }).onConflictDoNothing();
    }
    return outcome;
  },
  parseDrip,
);
