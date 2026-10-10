// T030: the public profile — id resolves by identityHash or wallet, events
// come from the settlement logs, unknown ids share one identical 404, and the
// shape structurally carries no personal data (D18).
import { beforeEach, describe, expect, it } from "bun:test";
import type { KiteError } from "@kite/core";
import { isas } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { createApp } from "../app.js";
import { fakeChain, ZERO_BYTES32 } from "./fake-chain.js";
import { EXPLORER_BASE_URL, getProfile } from "./profile-service.js";

const W = `0x${"a1".repeat(20)}` as `0x${string}`;
const BACKER = `0x${"b2".repeat(20)}` as `0x${string}`;
const HASH = `0x${"c3".repeat(32)}` as `0x${string}`;
const UNBOUND_HASH = `0x${"d4".repeat(32)}` as `0x${string}`; // well-formed, resolves to zero
const BLOCK_TIME = "2026-10-10T08:59:11.000Z";

const isaOnchain = (status: number) => ({
  principal: 600_000_000,
  shareBps: 2_000,
  capMult: 130,
  termEnd: 1_794_270_000,
  channelId: 1,
  seeker: W,
  backer: BACKER,
  remaining: status === 3 ? 0 : 480_000_000,
  activatedAt: 1_791_580_100,
  lastEventAt: 1_791_580_800,
  eventCount: 2,
  status,
});

const chainWithHistory = () =>
  fakeChain({
    walletOfIdentity: async (id) => (id.toLowerCase() === HASH ? W : ZERO_BYTES32),
    identityOf: async (w) => (w.toLowerCase() === W.toLowerCase() ? HASH : ZERO_BYTES32),
    scoreOf: async (w) => (w.toLowerCase() === W.toLowerCase() ? 91 : 0),
    profileOf: async (w) =>
      w.toLowerCase() === W.toLowerCase()
        ? { totalIsas: 3, completed: 3, qualEvents: 7, distinctBackers: 2 }
        : { totalIsas: 0, completed: 0, qualEvents: 0, distinctBackers: 0 },
    isaOf: async (isaId: number) => {
      if (isaId !== 3) {
        throw new Error(`unexpected isa ${isaId}`);
      }
      return isaOnchain(3); // completed_capped
    },
    settlementLogs: async () => [
      {
        isaId: 3,
        channelId: 1,
        purchaseRef: `0x${"11".repeat(32)}`,
        gross: 1_500_000_000,
        toBacker: 180_000_000,
        toSeeker: 1_320_000_000,
        remaining: 480_000_000,
        qualifying: true,
        blockNumber: 50n,
        logIndex: 0,
        txHash: "0xtx1",
      },
      {
        isaId: 3,
        channelId: 1,
        purchaseRef: `0x${"22".repeat(32)}`,
        gross: 1_500_000_000,
        toBacker: 180_000_000,
        toSeeker: 1_320_000_000,
        remaining: 0,
        qualifying: true,
        blockNumber: 60n,
        logIndex: 0,
        txHash: "0xtx2",
      },
    ],
    blockTimestamp: async () => 1_791_622_751, // → BLOCK_TIME
  });

async function seedDeal(db: TestDb): Promise<void> {
  await db.insert(isas).values({
    isaId: 3,
    seeker: W,
    backer: BACKER,
    principal: 600_000_000,
    shareBps: 2_000,
    capMult: 130,
    remaining: 0,
    status: "completed_capped",
    termEnd: 1_794_270_000,
  });
}

describe("getProfile (T030)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("resolves an identityHash to the wallet and merges reputation, deals, and log events", async () => {
    await seedDeal(db);
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
    expect(deal?.events[1]).toMatchObject({
      remainingAusd: 0,
      txHash: "0xtx2",
      blockTime: BLOCK_TIME,
    });
    expect(p.explorerBaseUrl).toBe(EXPLORER_BASE_URL);
  });

  it("resolves a wallet address directly (D12)", async () => {
    await seedDeal(db);
    const p = await getProfile(db, chainWithHistory(), W);
    expect(p.wallet).toBe(W);
    expect(p.id).toBe(W);
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
  it("404 profile_not_found with the identical body for any unknown id", async () => {
    const db = await makeTestDb();
    const app = createApp({ db, chain: chainWithHistory(), mitaKey: "k" });

    const byHash = await app.request(`/api/p/${UNBOUND_HASH}`);
    const byWallet = await app.request(`/api/p/${`0x${"e4".repeat(20)}`}`);
    expect(byHash.status).toBe(404);
    expect(byWallet.status).toBe(404);
    const hashBody = await byHash.json();
    const walletBody = await byWallet.json();
    expect(hashBody).toEqual(walletBody); // identical shape — no existence leak
  });
});
