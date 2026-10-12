// T030: the public profile — id resolves by identityHash or wallet, events
// come from the DB projection (purchases SETTLED + ledger split; the request
// path NEVER scans chain logs — the deployment→head walk is what took the
// route down at 500/502 as the chain grew), unknown ids share one identical
// 404, and the shape structurally carries no personal data (D18).
import { beforeEach, describe, expect, it } from "bun:test";
import type { KiteError } from "@kite/core";
import { isas, ledgerEntries, PURCHASE_STATUS, purchases } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { createApp } from "../app.js";
import { fakeChain, ZERO_BYTES32 } from "./fake-chain.js";
import { EXPLORER_BASE_URL, getProfile } from "./profile-service.js";

const W = `0x${"a1".repeat(20)}` as `0x${string}`;
const BACKER = `0x${"b2".repeat(20)}` as `0x${string}`;
const HASH = `0x${"c3".repeat(32)}` as `0x${string}`;
const UNBOUND_HASH = `0x${"d4".repeat(32)}` as `0x${string}`; // well-formed, resolves to zero

// Contract math (Stream.sol _settleFact: remaining -= toBacker): cap 780,
// two settlements of 180 to the backer → live remaining 420; the profile
// reconstructs per-event remaining backward from that live value.
const T0 = Date.UTC(2026, 9, 10, 8, 0, 0); // 2026-10-10T08:00:00Z
const T1 = T0 + 3_600_000;

const isaOnchain = (status: number) => ({
  principal: 600_000_000,
  shareBps: 2_000,
  capMult: 130,
  termEnd: 1_794_270_000,
  channelId: 1,
  seeker: W,
  backer: BACKER,
  remaining: 420_000_000,
  activatedAt: 1_791_580_100,
  lastEventAt: 1_791_580_800,
  eventCount: 2,
  status,
});

// A DRAFTED deal (T019): no activations, no settlements — remaining 0, and
// the cap is the only ceiling the public surface can state.
const draftIsaOnchain = {
  principal: 500_000_000,
  shareBps: 2_000,
  capMult: 130,
  termEnd: 1_794_270_000,
  channelId: 1,
  seeker: W,
  backer: BACKER,
  remaining: 0,
  activatedAt: 0,
  lastEventAt: 0,
  eventCount: 0,
  status: 1,
};

/** The chain read surface the route may use — the log scan MUST NOT run. */
const chainWithHistory = () => {
  const mustNotScan = async (): Promise<never> => {
    throw new Error("getProfile must not scan settlement logs");
  };
  return fakeChain({
    walletOfIdentity: async (id) => (id.toLowerCase() === HASH ? W : ZERO_BYTES32),
    identityOf: async (w) => (w.toLowerCase() === W.toLowerCase() ? HASH : ZERO_BYTES32),
    scoreOf: async (w) => (w.toLowerCase() === W.toLowerCase() ? 91 : 0),
    profileOf: async (w) =>
      w.toLowerCase() === W.toLowerCase()
        ? { totalIsas: 3, completed: 3, qualEvents: 7, distinctBackers: 2 }
        : { totalIsas: 0, completed: 0, qualEvents: 0, distinctBackers: 0 },
    isaOf: async (isaId: number) => {
      if (isaId === 4) {
        return draftIsaOnchain; // the open request (T019)
      }
      if (isaId !== 3) {
        throw new Error(`unexpected isa ${isaId}`);
      }
      return isaOnchain(3); // completed_capped
    },
    settlementLogs: mustNotScan,
    blockAtOrAfter: mustNotScan,
    blockTimestamp: mustNotScan,
  });
};

async function seedDeal(db: TestDb): Promise<void> {
  await db.insert(isas).values({
    isaId: 3,
    seeker: W,
    backer: BACKER,
    principal: 600_000_000,
    shareBps: 2_000,
    capMult: 130,
    remaining: 420_000_000,
    status: "completed_capped",
    termEnd: 1_794_270_000,
  });
}

const MILL_SIG = {
  salt: `0x${"01".repeat(32)}`,
  v: 27,
  r: `0x${"02".repeat(32)}`,
  s: `0x${"03".repeat(32)}`,
};

/** A SETTLED purchase + its §7.2 ledger split (what the watcher writes). */
async function seedSettlement(
  db: TestDb,
  refHex: string,
  settledAt: Date,
  split: { gross: number; toBacker: number; toSeeker: number },
): Promise<string> {
  const rows = await db
    .insert(purchases)
    .values({
      channelId: 1,
      isaId: 3,
      purchaseRef: refHex,
      grossAusd: split.gross,
      status: PURCHASE_STATUS.SETTLED,
      millSig: MILL_SIG,
      txHash: `0xtx${refHex.slice(2, 6)}`,
      settledAt,
    })
    .returning({ id: purchases.id });
  const id = rows[0]?.id;
  if (!id) throw new Error("seed purchase");
  await db.insert(ledgerEntries).values([
    { purchaseId: id, account: "channel:1", side: "in", amountAusd: split.gross },
    { purchaseId: id, account: `backer:${BACKER}`, side: "out", amountAusd: split.toBacker },
    { purchaseId: id, account: `seeker:${W}`, side: "out", amountAusd: split.toSeeker },
  ]);
  return id;
}

describe("getProfile (T030 — DB projection events)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("resolves an identityHash to the wallet and merges reputation, deals, and settled purchases", async () => {
    await seedDeal(db);
    await seedSettlement(db, `0x${"11".repeat(32)}`, new Date(T0), {
      gross: 1_500_000_000,
      toBacker: 180_000_000,
      toSeeker: 1_320_000_000,
    });
    await seedSettlement(db, `0x${"22".repeat(32)}`, new Date(T1), {
      gross: 1_500_000_000,
      toBacker: 180_000_000,
      toSeeker: 1_320_000_000,
    });
    const p = await getProfile(db, chainWithHistory(), HASH);

    expect(p.id).toBe(HASH);
    expect(p.wallet).toBe(W);
    expect(p.reputation).toEqual({ score: 91, completedDeals: 3, qualEvents: 7 });
    expect(p.deals.length).toBe(1);
    const deal = p.deals[0];
    expect(deal).toMatchObject({
      isaId: 3,
      principalAusd: 600_000_000,
      shareBps: 2_000,
      capAusd: 780_000_000,
      totalDivertedAusd: 2_640_000_000,
      status: "completed_capped",
    });
    expect(deal?.events.length).toBe(2);
    expect(deal?.events[0]).toMatchObject({
      grossAusd: 1_500_000_000,
      toBackerAusd: 180_000_000,
      remainingAusd: 600_000_000, // 420 live + 180 of later decrement
      txHash: "0xtx1111",
      blockTime: new Date(T0).toISOString(),
    });
    expect(deal?.events[1]).toMatchObject({
      remainingAusd: 420_000_000, // the live onchain remaining — exact by the chain
      txHash: "0xtx2222",
      blockTime: new Date(T1).toISOString(),
    });
    expect(p.explorerBaseUrl).toBe(EXPLORER_BASE_URL);
  });

  it("resolves a wallet address directly (D12)", async () => {
    await seedDeal(db);
    const p = await getProfile(db, chainWithHistory(), W);
    expect(p.wallet).toBe(W);
    expect(p.id).toBe(W);
  });

  it("REGRESSION: a DRAFTED ISA is the open request — deals[] includes it (T019, the 0x5c920 share link)", async () => {
    // What watch-registry caches when createISADraft lands: a full cache row
    // at status drafted. The profile must carry it — the open request is the
    // share link's entire purpose (FR-019), not something to filter out.
    await db.insert(isas).values({
      isaId: 4,
      seeker: W,
      backer: BACKER,
      principal: 500_000_000,
      shareBps: 2_000,
      capMult: 130,
      remaining: 0,
      status: "drafted",
      termEnd: 1_794_270_000,
    });
    const p = await getProfile(db, chainWithHistory(), W);

    const drafted = p.deals.find((d) => d.isaId === 4);
    expect(drafted).toBeTruthy();
    expect(drafted?.status).toBe("drafted");
    expect(drafted?.principalAusd).toBe(500_000_000);
    expect(drafted?.capAusd).toBe(650_000_000); // 500M × 130%
    expect(drafted?.totalDivertedAusd).toBe(0);
    expect(drafted?.events).toEqual([]); // nothing settled — no invented rows
  });

  it("REGRESSION: a bound wallet with no deals is a VALID empty 200, never an error (the 0xe494 device case)", async () => {
    const p = await getProfile(db, chainWithHistory(), W);
    expect(p.wallet).toBe(W);
    expect(p.deals).toEqual([]);
    expect(p.reputation).toEqual({ score: 91, completedDeals: 3, qualEvents: 7 });
  });

  it("a settled purchase missing its ledger split is skipped, not guessed", async () => {
    await seedDeal(db);
    const partial = await db
      .insert(purchases)
      .values({
        channelId: 1,
        isaId: 3,
        purchaseRef: `0x${"33".repeat(32)}`,
        grossAusd: 900_000_000,
        status: PURCHASE_STATUS.SETTLED,
        millSig: MILL_SIG,
        txHash: "0xtx3",
        settledAt: new Date(T1),
      })
      .returning({ id: purchases.id });
    expect(partial[0]?.id).toBeTruthy();
    await seedSettlement(db, `0x${"44".repeat(32)}`, new Date(T0), {
      gross: 1_500_000_000,
      toBacker: 180_000_000,
      toSeeker: 1_320_000_000,
    });
    const p = await getProfile(db, chainWithHistory(), HASH);
    expect(p.deals[0]?.events).toHaveLength(1); // the splitless row is absent
    expect(p.deals[0]?.events[0]?.txHash).toBe("0xtx4444");
  });

  it("unknown ids → the same 404 for a never-bound hash and an empty wallet", async () => {
    for (const id of [UNBOUND_HASH, `0x${"e4".repeat(20)}` as `0x${string}`]) {
      try {
        await getProfile(db, chainWithHistory(), id);
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as KiteError).code).toBe("profile_not_found");
      }
    }
  });

  it("the response shape structurally carries NO personal-data fields (D18)", async () => {
    await seedDeal(db);
    await seedSettlement(db, `0x${"55".repeat(32)}`, new Date(T0), {
      gross: 1_500_000_000,
      toBacker: 180_000_000,
      toSeeker: 1_320_000_000,
    });
    const p = await getProfile(db, chainWithHistory(), HASH);
    const keys: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
      } else if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          keys.push(key);
          walk(value);
        }
      }
    };
    walk(p);
    const banned = ["name", "phone", "email", "document", "documents", "kyc"];
    expect(keys.filter((k) => banned.includes(k))).toEqual([]);
  });
});

describe("GET /api/p/:id (http shapes)", () => {
  it("REGRESSION: bound wallet → 200; unknown/unbound → 404 — never a 500", async () => {
    const db = await makeTestDb();
    const app = createApp({ db, chain: chainWithHistory(), mitaKey: "k" });

    const bound = await app.request(`/api/p/${W}`);
    expect(bound.status).toBe(200);
    const body = (await bound.json()) as { deals: unknown[]; wallet: string };
    expect(body.wallet).toBe(W);
    expect(Array.isArray(body.deals)).toBe(true);

    const byHash = await app.request(`/api/p/${UNBOUND_HASH}`);
    const byWallet = await app.request(`/api/p/${`0x${"e4".repeat(20)}`}`);
    expect(byHash.status).toBe(404);
    expect(byWallet.status).toBe(404);
    const hashBody = await byHash.json();
    const walletBody = await byWallet.json();
    expect(hashBody).toEqual(walletBody); // identical shape — no existence leak
  });
});
