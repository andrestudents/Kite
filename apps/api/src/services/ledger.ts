// The §7.2 rule 3 double entry: per purchase, one `in` row on the channel
// account and `out` rows on the backer/seeker accounts, with
// Σ in == Σ out == gross asserted by the WRITER — an unbalanced settlement
// never touches the table. Append-only: this module has no update or delete
// path, and nothing else writes ledger_entries.

import { assertMoneyInteger, KiteError } from "@kite/core";
import { type AnyDb, execute, ledgerEntries, type Purchase } from "@kite/core/db";
import { eq } from "drizzle-orm";

export interface SettlementSplit {
  /** Total settled, AUSD base units — equals the IncomeSettled gross. */
  gross: number;
  /** Portion that went to the backer, AUSD base units. */
  toBacker: number;
  /** Portion that went to the seeker, AUSD base units. */
  toSeeker: number;
  /** Backer address — the ledger account label. */
  backer: string;
  /** Seeker address — the ledger account label. */
  seeker: string;
}

export async function writeSettlement(
  db: AnyDb,
  purchase: Purchase,
  split: SettlementSplit,
): Promise<void> {
  const gross = assertMoneyInteger(split.gross, "gross");
  const toBacker = assertMoneyInteger(split.toBacker, "toBacker");
  const toSeeker = assertMoneyInteger(split.toSeeker, "toSeeker");
  if (toBacker + toSeeker !== gross) {
    throw new KiteError(
      "ledger_unbalanced",
      `split ${toBacker} + ${toSeeker} does not sum to gross ${gross}`,
    );
  }

  const rows = [
    { account: `channel:${purchase.channelId}`, side: "in", amountAusd: gross },
    { account: `backer:${split.backer}`, side: "out", amountAusd: toBacker },
    { account: `seeker:${split.seeker}`, side: "out", amountAusd: toSeeker },
  ];
  await execute(db, async (tx) => {
    for (const row of rows) {
      await tx.insert(ledgerEntries).values({ purchaseId: purchase.id, ...row });
    }
  });
}

/** Reader for tests and the T020 gate's Σ in == Σ out assertion. */
export async function entriesFor(db: AnyDb, purchaseId: string) {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.purchaseId, purchaseId));
}
