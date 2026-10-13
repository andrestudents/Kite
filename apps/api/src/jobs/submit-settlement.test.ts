// T019: the Demo-Tool submitter — happy settle, TERMINAL revert → FAILED
// (US1-AC4), wrong-state refusals, transient errors rethrown. The broadcast
// leg is injected; observation runs the real processNewLogs over a fake chain.
import { beforeEach, describe, expect, it } from "bun:test";
import type { KiteError } from "@kite/core";
import { purchases, purchaseTransitions } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import type { ChainClient, SettlementLog } from "../services/chain.js";
import { type IncomeCall, isTerminalRevert, submitSettlement } from "./submit-settlement.js";

const REF = `0x${"c0".repeat(32)}`;

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

const LOG: SettlementLog = {
  isaId: 3,
  channelId: 1,
  purchaseRef: REF,
  gross: 1_500_000_000,
  toBacker: 300_000_000,
  toSeeker: 1_200_000_000,
  remaining: 450_000_000,
  qualifying: true,
  blockNumber: 50n,
  logIndex: 2,
  txHash: "0xsettled",
};

function fakeChain(logs: SettlementLog[]): ChainClient {
  return {
    chainId: async () => 10143,
    blockNumber: async () => 100n,
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
  } as unknown as ChainClient;
}

const okSubmit: (call: IncomeCall) => Promise<string> = async () => "0xsuccess";

describe("isTerminalRevert", () => {
  it("classifies viem reverts as terminal, network errors as transient", () => {
    const reverted = Object.assign(new Error("cap reached"), { name: "ExecutionRevertedError" });
    expect(isTerminalRevert(reverted)).toBe(true);
    expect(isTerminalRevert(new Error("HTTP request failed: socket hang up"))).toBe(false);
    expect(isTerminalRevert(undefined)).toBe(false);
  });
});

describe("submitSettlement (T019)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  async function seedPaid(): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(purchases).values({
      id,
      channelId: 1,
      isaId: 3,
      purchaseRef: REF,
      grossAusd: 1_500_000_000,
      status: "PAID",
      millSig: {
        salt: `0x${"dd".repeat(32)}`,
        v: 28,
        r: `0x${"aa".repeat(32)}`,
        s: `0x${"bb".repeat(32)}`,
      },
    });
    return id;
  }

  it("broadcasts the STORED signature and settles via the in-process watcher pass", async () => {
    const id = await seedPaid();
    let seen: IncomeCall | undefined;
    const outcome = await submitSettlement(db, fakeChain([LOG]), id, {
      submit: async (call) => {
        seen = call;
        return "0xsuccess";
      },
      passes: 1,
    });

    expect(outcome.status).toBe("SETTLED");
    expect(outcome.txHash).toBe("0xsuccess");
    // the stored §7.1 record is what goes on the call — nothing is re-signed
    expect(seen?.isaId).toBe(3);
    expect(seen?.purchaseRef).toBe(REF as `0x${string}`);
    expect(seen?.gross).toBe(1_500_000_000);
    expect(seen?.salt).toBe(`0x${"dd".repeat(32)}`);
    expect(seen?.v).toBe(28);
    expect(seen?.gasLimit).toBe(502_000); // the published fixed limit, never an estimate

    const rows = await db.select().from(purchases);
    expect(rows[0]?.status).toBe("SETTLED");
    expect(rows[0]?.txHash).toBe("0xsettled"); // the SETTLEMENT tx, from the log
  });

  it("marks FAILED with failed_reason + transition on a terminal revert (US1-AC4)", async () => {
    const id = await seedPaid();
    const terminal = Object.assign(new Error("cap reached"), { name: "ExecutionRevertedError" });
    const outcome = await submitSettlement(db, fakeChain([]), id, {
      submit: async () => {
        throw terminal;
      },
      passes: 1,
    });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.reason).toContain("cap reached");

    const rows = await db.select().from(purchases);
    expect(rows[0]?.status).toBe("FAILED");
    expect(rows[0]?.failedReason).toContain("cap reached");
    const transitions = await db.select().from(purchaseTransitions);
    expect(transitions.map((t) => `${t.fromStatus}->${t.toStatus}:${t.actor}`)).toContain(
      "PAID->FAILED:submit-settlement",
    );
  });

  it("refuses a purchase that is not PAID", async () => {
    const id = crypto.randomUUID();
    await db.insert(purchases).values({
      id,
      channelId: 1,
      isaId: 3,
      purchaseRef: REF,
      grossAusd: 1,
      status: "PENDING",
      millSig: {
        salt: `0x${"dd".repeat(32)}`,
        v: 28,
        r: `0x${"aa".repeat(32)}`,
        s: `0x${"bb".repeat(32)}`,
      },
    });
    try {
      await submitSettlement(db, fakeChain([]), id, { submit: okSubmit, passes: 1 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as KiteError).code).toBe("invalid_transition");
    }
  });

  it("rethrows transient broadcast errors untouched", async () => {
    const id = await seedPaid();
    try {
      await submitSettlement(db, fakeChain([]), id, {
        submit: async () => {
          throw new Error("HTTP request failed: socket hang up");
        },
        passes: 1,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("socket hang up");
    }
    expect((await db.select().from(purchases))[0]?.status).toBe("PAID");
  });

  it("throws settlement_not_observed when passes run out without a settlement", async () => {
    const id = await seedPaid();
    try {
      await submitSettlement(db, fakeChain([]), id, {
        submit: okSubmit,
        passes: 2,
        sleep: async () => {},
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as KiteError).code).toBe("settlement_not_observed");
    }
    expect((await db.select().from(purchases))[0]?.status).toBe("PAID");
  });

  it("a crashing observation pass loses NOTHING — the tx evidence stays on the row", async () => {
    // The SC-002 crash shape: the broadcast lands, the watcher pass throws
    // mid-walk (throttle on a 315k-block backlog), and the row used to sit
    // PAID with no tx recorded. The evidence must survive every pass.
    const id = await seedPaid();
    const crashing = {
      ...fakeChain([]),
      settlementLogs: async () => {
        throw new Error("429 — slow down");
      },
    } as ChainClient;
    try {
      await submitSettlement(db, crashing, id, {
        submit: okSubmit,
        passes: 2,
        sleep: async () => {},
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as KiteError).code).toBe("settlement_not_observed");
      expect((e as Error).message).toContain("429");
    }
    const rows = await db.select().from(purchases);
    expect(rows[0]?.status).toBe("PAID");
    expect(rows[0]?.txHash).toBe("0xsuccess"); // the broadcast, preserved
  });

  it("a recovered pass after a crashing one still settles from the event", async () => {
    const id = await seedPaid();
    let calls = 0;
    const flaky = {
      ...fakeChain([LOG]),
      settlementLogs: async () => {
        calls += 1;
        if (calls === 1) throw new Error("429 — slow down");
        return [LOG];
      },
    } as ChainClient;
    const outcome = await submitSettlement(db, flaky, id, {
      submit: okSubmit,
      passes: 2,
      sleep: async () => {},
    });
    expect(outcome.status).toBe("SETTLED");
    const rows = await db.select().from(purchases);
    expect(rows[0]?.status).toBe("SETTLED");
    expect(rows[0]?.txHash).toBe("0xsettled"); // the SETTLEMENT tx, from the log
  });
});
