// T022 — the daily native-spend ceiling (§7.2 rule 5, FR-017). The drips
// table IS the day's ledger of native sends: one row per one-time drip, so
// today's committed spend is dripCount × DRIP_MON_WEI. A drip is admitted
// only if (committed + amountWei) stays within RELAYER_DAILY_CAP_MON_WEI.
// Demo scale: one worker, so the check-then-send race window is theoretical;
// the drips PK still guarantees exactly one drip per wallet regardless.
import { eq, gte } from "drizzle-orm";
import { KiteError } from "@kite/core";
import { type AnyDb, drips } from "@kite/core/db";

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function nativeSpendTodayWei(db: AnyDb, amountPerDripWei: bigint): Promise<bigint> {
  const rows = await db
    .select()
    .from(drips)
    .where(gte(drips.createdAt, startOfTodayUtc()));
  return BigInt(rows.length) * amountPerDripWei;
}

/** Throws daily_cap_exceeded when admitting one more drip would pass the cap. */
export async function assertDripWithinDailyCap(
  db: AnyDb,
  dripMonWei: bigint,
  dailyCapMonWei: bigint,
): Promise<bigint> {
  const committed = await nativeSpendTodayWei(db, dripMonWei);
  const projected = committed + dripMonWei;
  if (projected > dailyCapMonWei) {
    throw new KiteError(
      "daily_cap_exceeded",
      `drip ${dripMonWei} would put today's native spend at ${projected} > cap ${dailyCapMonWei}`,
    );
  }
  return projected;
}

/** True when the wallet already dripped — the PK guarantees at most one row. */
export async function hasDripped(db: AnyDb, wallet: string): Promise<boolean> {
  const rows = await db.select().from(drips).where(eq(drips.wallet, wallet)).limit(1);
  return rows.length > 0;
}
