// T018: settle path, double-delivery no-op, out-of-order checkpoint resume,
// unmatched counter — the observer is the only writer of SETTLED, so every
// guarantee here is a money guarantee.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  isas,
  jobState,
  ledgerEntries,
  purchases,
  purchaseTransitions,
  webhookEvents,
} from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import type { ChainClient, SettlementLog } from "../services/chain.js";
import { processNewLogs, SETTLEMENTS_BLOCK_KEY, UNMATCHED_KEY } from "./watch-settlements.js";

const REF = `0x${"c0".repeat(32)}`;
const OTHER_REF = `0x${"e1".repeat(32)}`;

const ISA_ONCHAIN = {
  principal: 600_000_000,
  shareBps: 2000,
  capMult: 130,
  termEnd: 1_800_000_000,
  channelId: 1,
  seeker: "0xseeker",
  backer: "0xbacker",
  remaining: 450_000_000,
  activatedAt: 1_700_000_000,
  lastEventAt: 1_700_000_060,
  eventCount: 4,
  status: 2,
};

function logAt(block: number, logIndex: number, ref: string = REF): SettlementLog {
  return {
    isaId: 3,
    channelId: 1,
    purchaseRef: ref,
    gross: 1_500_000_000,
    toBacker: 300_000_000,
    toSeeker: 1_200_000_000,
    remaining: 450_000_000,
    qualifying: true,
    blockNumber: BigInt(block),
    logIndex,
    txHash: `0xtx${block}${logIndex}`,
  };
}

function fakeChain(
  logs: SettlementLog[],
  head: bigint,
  overrides: Partial<ChainClient> = {},
): ChainClient {
  return {
    chainId: async () => 10143,
    blockNumber: async () => head,
    isaOf: async () => ISA_ONCHAIN,
    offerOf: async () => 600_000_000,
    scoreOf: async () => 58,
    profileOf: async () => ({ totalIsas: 1, completed: 0, qualEvents: 4, distinctBackers: 1 }),
    channelOf: async () => ({ name: "Mill Satu", pubkey: "0xmill", active: true }),
    identityOf: async () => `0x${"00".repeat(32)}`,
    walletOfIdentity: async () => "0xwallet",
    balanceAusd: async () => 1_000_000n,
    minEventGap: async () => 60,
    blockTimestamp: async (n: bigint) => 1_700_000_000 + Number(n),
    blockAtOrAfter: async () => 10n,
    channelRegisteredIds: async () => [],
    isaEventIds: async () => [],
    settlementLogs: async (from: bigint, to: bigint) =>
      logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to),
    ...overrides,
  } as unknown as ChainClient;
}

async function seedPaidPurchase(db: TestDb, ref: string): Promise<string> {
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
  return id;
}

async function checkpointOf(db: TestDb): Promise<string | undefined> {
  const rows = await db.select().from(jobState);
  return rows.find((r) => r.key === SETTLEMENTS_BLOCK_KEY)?.value;
}

describe("processNewLogs (T018)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("settles a PAID purchase: tx hash, block timestamp, ledger split, isa read-back, checkpoint", async () => {
    await seedPaidPurchase(db, REF);
    const result = await processNewLogs(db, fakeChain([logAt(50, 2)], 100n));

    expect(result.settled).toBe(1);
    expect(result.unmatched).toBe(0);

    const rows = await db.select().from(purchases);
    const row = rows[0];
    expect(row?.status).toBe("SETTLED");
    expect(row?.txHash).toBe("0xtx502");
    expect(row?.settledAt?.toISOString()).toBe(new Date((1_700_000_000 + 50) * 1000).toISOString());

    const transitions = await db.select().from(purchaseTransitions);
    expect(transitions.map((t) => `${t.fromStatus}->${t.toStatus}:${t.actor}`)).toContain(
      "PAID->SETTLED:watcher",
    );

    const entries = await db.select().from(ledgerEntries);
    expect(entries.length).toBe(3);
    const inSum = entries.filter((e) => e.side === "in").reduce((a, e) => a + e.amountAusd, 0);
    const outSum = entries.filter((e) => e.side === "out").reduce((a, e) => a + e.amountAusd, 0);
    expect(inSum).toBe(1_500_000_000);
    expect(outSum).toBe(1_500_000_000);

    // FR-009 read-back: the isas cache now mirrors isaOf()
    const isaRows = await db.select().from(isas);
    expect(isaRows.length).toBe(1);
    expect(isaRows[0]?.isaId).toBe(3);
    expect(isaRows[0]?.remaining).toBe(450_000_000);
    expect(isaRows[0]?.status).toBe("active");

    expect(await checkpointOf(db)).toBe("100");
    const claims = await db.select().from(webhookEvents);
    expect(claims.map((c) => c.providerEventId)).toContain("10143:50:2");
  });

  it("is a no-op on double delivery — same log twice, or a full replay pass", async () => {
    await seedPaidPurchase(db, REF);
    const chain = fakeChain([logAt(50, 2), logAt(50, 2)], 100n); // same event id twice
    await processNewLogs(db, chain);
    await processNewLogs(db, chain); // replay pass — checkpoint already at head

    const rows = await db.select().from(purchases);
    expect(rows[0]?.status).toBe("SETTLED");
    expect((await db.select().from(ledgerEntries)).length).toBe(3);
    const transitions = await db.select().from(purchaseTransitions);
    expect(transitions.filter((t) => t.toStatus === "SETTLED").length).toBe(1);
    const claims = await db.select().from(webhookEvents);
    expect(claims.filter((c) => c.providerEventId === "10143:50:2").length).toBe(1);
  });

  it("resumes from the checkpoint — logs below it are never re-scanned", async () => {
    const belowId = await seedPaidPurchase(db, REF);
    const aheadId = await seedPaidPurchase(db, OTHER_REF);
    await db.insert(jobState).values({ key: SETTLEMENTS_BLOCK_KEY, value: "90" });
    const result = await processNewLogs(
      db,
      fakeChain([logAt(50, 2, REF), logAt(95, 0, OTHER_REF)], 100n),
    );

    expect(result.settled).toBe(1); // only block 95 was in range
    const rows = await db.select().from(purchases);
    expect(rows.find((r) => r.id === belowId)?.status).toBe("PAID"); // block 50 below checkpoint
    expect(rows.find((r) => r.id === aheadId)?.status).toBe("SETTLED");
    expect(await checkpointOf(db)).toBe("100");
  });

  it("counts unmatched events and leaves purchases untouched", async () => {
    await seedPaidPurchase(db, REF); // matches REF, not OTHER_REF
    const result = await processNewLogs(db, fakeChain([logAt(60, 1, OTHER_REF)], 100n));

    expect(result.settled).toBe(0);
    expect(result.unmatched).toBe(1);
    const rows = await db.select().from(jobState);
    expect(rows.find((r) => r.key === UNMATCHED_KEY)?.value).toBe("1");
    expect((await db.select().from(purchases))[0]?.status).toBe("PAID");
  });

  it("an expired deadline walks NOTHING — a bounded pass must not grind a backlog", async () => {
    await seedPaidPurchase(db, REF);
    let calls = 0;
    const chain = fakeChain([logAt(50, 2)], 100n, {
      settlementLogs: async () => {
        calls += 1;
        return [];
      },
    });
    const result = await processNewLogs(db, chain, { deadlineMs: Date.now() - 1 });

    expect(result.settled).toBe(0);
    expect(calls).toBe(0); // the budget was spent before the first range
    expect(await checkpointOf(db)).toBe("10"); // the seed — the next pass resumes from it
    expect((await db.select().from(purchases))[0]?.status).toBe("PAID");
  });
});
