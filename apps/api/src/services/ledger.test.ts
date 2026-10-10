// T016: the §7.2 rule 3 double entry — writer-asserted balance, append-only.
import { beforeEach, describe, expect, it } from "bun:test";
import { KiteError } from "@kite/core";
import { ledgerEntries, type Purchase, purchases } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { entriesFor, writeSettlement } from "./ledger.js";

const SPLIT = {
  gross: 1_500_000_000,
  toBacker: 300_000_000,
  toSeeker: 1_200_000_000,
  backer: "0xbacker",
  seeker: "0xseeker",
};

async function seedPurchase(db: TestDb, ref: `0x${string}`): Promise<Purchase> {
  const id = crypto.randomUUID();
  await db.insert(purchases).values({
    id,
    channelId: 1,
    isaId: 3,
    purchaseRef: ref,
    grossAusd: 1_500_000_000,
    status: "PAID",
    millSig: {
      salt: `0x${"11".repeat(32)}`,
      v: 27,
      r: `0x${"22".repeat(32)}`,
      s: `0x${"33".repeat(32)}`,
    },
  });
  const rows = await db.select().from(purchases);
  return rows[0] as Purchase;
}

function sum(entries: { side: string; amountAusd: number }[], side: string): number {
  return entries.filter((e) => e.side === side).reduce((acc, e) => acc + e.amountAusd, 0);
}

describe("writeSettlement (§7.2 rule 3)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("writes one in row and two out rows that balance to gross", async () => {
    const purchase = await seedPurchase(db, `0x${"a1".repeat(32)}`);
    await writeSettlement(db, purchase, SPLIT);
    const entries = await entriesFor(db, purchase.id);
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.account).sort()).toEqual([
      "backer:0xbacker",
      "channel:1",
      "seeker:0xseeker",
    ]);
    expect(sum(entries, "in")).toBe(SPLIT.gross);
    expect(sum(entries, "out")).toBe(SPLIT.gross);
    const channelRow = entries.find((e) => e.side === "in");
    expect(channelRow?.amountAusd).toBe(SPLIT.gross);
    expect(channelRow?.account).toBe("channel:1");
  });

  it("refuses an unbalanced split and writes NOTHING (atomic)", async () => {
    const purchase = await seedPurchase(db, `0x${"a2".repeat(32)}`);
    try {
      await writeSettlement(db, purchase, { ...SPLIT, toBacker: 1 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(KiteError);
      expect((e as KiteError).code).toBe("ledger_unbalanced");
    }
    expect((await entriesFor(db, purchase.id)).length).toBe(0);
  });

  it("refuses non-integer or negative money before any insert", async () => {
    const purchase = await seedPurchase(db, `0x${"a3".repeat(32)}`);
    for (const bad of [
      { ...SPLIT, gross: 1.5 },
      { ...SPLIT, toSeeker: -1 },
    ]) {
      try {
        await writeSettlement(db, purchase, bad);
        throw new Error("should have thrown");
      } catch (e) {
        expect((e as KiteError).code).toBe("money_must_be_integer");
      }
    }
    expect((await entriesFor(db, purchase.id)).length).toBe(0);
  });

  it("is append-only: two settlements accumulate, nothing is overwritten", async () => {
    const first = await seedPurchase(db, `0x${"a4".repeat(32)}`);
    const second = await seedPurchase(db, `0x${"a5".repeat(32)}`);
    await writeSettlement(db, first, SPLIT);
    await writeSettlement(db, second, SPLIT);
    const all = await db.select().from(ledgerEntries);
    expect(all.length).toBe(6);
    expect(sum(all, "in")).toBe(SPLIT.gross * 2);
  });
});
