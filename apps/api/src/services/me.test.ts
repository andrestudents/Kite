// T029: the ONE merged /api/me response — chain values win over the cache,
// empty state is a valid 200, the header is enforced.
import { beforeEach, describe, expect, it } from "bun:test";
import { isas, purchases } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { createApp } from "../app.js";
import { fakeChain } from "./fake-chain.js";
import { getMe } from "./me-service.js";

const W = `0x${"a1".repeat(20)}` as `0x${string}`;
const BACKER = `0x${"b2".repeat(20)}` as `0x${string}`;
const HASH = `0x${"c3".repeat(32)}` as `0x${string}`;
const REF1 = `0x${"11".repeat(32)}` as `0x${string}`;
const REF2 = `0x${"22".repeat(32)}` as `0x${string}`;

const ACTIVE_ISA = {
  principal: 600_000_000,
  shareBps: 2_000,
  capMult: 130,
  termEnd: 1_794_270_000,
  channelId: 1,
  seeker: W,
  backer: BACKER,
  remaining: 480_000_000,
  activatedAt: 1_791_580_100,
  lastEventAt: 1_791_580_800,
  eventCount: 1,
  status: 2,
};

const richChain = () =>
  fakeChain({
    identityOf: async () => HASH,
    balanceAusd: async () => 1_200_000_000n,
    scoreOf: async () => 58,
    offerOf: async () => 1_296_000_000,
    profileOf: async () => ({ totalIsas: 2, completed: 2, qualEvents: 4, distinctBackers: 2 }),
    isaOf: async (isaId: number) => {
      if (isaId !== 3) {
        throw new Error(`unexpected isa ${isaId}`);
      }
      return ACTIVE_ISA;
    },
  });

async function seedHistory(db: TestDb): Promise<void> {
  await db.insert(isas).values({
    isaId: 3,
    seeker: W,
    backer: BACKER,
    principal: ACTIVE_ISA.principal,
    shareBps: ACTIVE_ISA.shareBps,
    capMult: ACTIVE_ISA.capMult,
    remaining: 999, // deliberately STALE — the proxy read must win
    status: "active",
    termEnd: ACTIVE_ISA.termEnd,
  });
  await db.insert(purchases).values([
    {
      channelId: 1,
      isaId: 3,
      purchaseRef: REF1,
      grossAusd: 1_500_000_000,
      status: "SETTLED",
      millSig: { salt: HASH, v: 27, r: HASH, s: HASH },
      txHash: "0xtx1",
      settledAt: new Date("2026-10-10T08:59:11Z"),
      createdAt: new Date(Date.now() - 1_000),
    },
    {
      channelId: 1,
      isaId: 3,
      purchaseRef: REF2,
      grossAusd: 500_000_000,
      status: "PAID",
      millSig: { salt: HASH, v: 27, r: HASH, s: HASH },
      createdAt: new Date(),
    },
  ]);
}

describe("getMe (T029)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("merges identity, balance, profile, the active deal, and history in one response", async () => {
    await seedHistory(db);
    const me = await getMe(db, richChain(), W);

    expect(me.wallet).toBe(W);
    expect(me.balanceAusd).toBe(1_200_000_000);
    expect(me.identityBound).toBe(true);
    expect(me.profile).toEqual({
      score: 58,
      maxSupportAusd: 1_296_000_000,
      totalIsas: 2,
      completed: 2,
      qualEvents: 4,
      distinctBackers: 2,
    });
    expect(me.activeIsa).toEqual({
      isaId: 3,
      backer: BACKER,
      principalAusd: 600_000_000,
      shareBps: 2_000,
      capMult: 130,
      capAusd: 780_000_000,
      remainingAusd: 480_000_000,
      progressBps: 3846,
      termEnd: 1_794_270_000,
      channelId: 1,
    });
    expect(me.recentPurchases.length).toBe(2);
    expect(me.recentPurchases[0]?.status).toBe("PAID"); // newest first
    expect(me.recentPurchases[1]).toMatchObject({ status: "SETTLED", txHash: "0xtx1" });
    expect(me.recentPurchases[1]?.settledAt).toBe("2026-10-10T08:59:11.000Z");
  });

  it("chain values win over a stale cache row (constitution IV)", async () => {
    await seedHistory(db);
    const me = await getMe(db, richChain(), W);
    expect(me.activeIsa?.remainingAusd).toBe(480_000_000); // isaOf, not the cached 999
  });

  it("empty state is a valid 200 — zeros, null deal, no error", async () => {
    const fresh = `0x${"e4".repeat(20)}` as `0x${string}`;
    const me = await getMe(db, fakeChain(), fresh);
    expect(me).toMatchObject({
      wallet: fresh,
      balanceAusd: 0,
      identityBound: false,
      profile: { score: 0, maxSupportAusd: 600_000_000 },
      activeIsa: null,
      recentPurchases: [],
    });
  });
});

describe("GET /api/me (http shapes)", () => {
  it("missing or invalid header → 400; valid → the merged body", async () => {
    const db = await makeTestDb();
    const app = createApp({ db, chain: richChain(), mitaKey: "k" });

    const missing = await app.request("/api/me");
    expect(missing.status).toBe(400);

    const garbage = await app.request("/api/me", {
      headers: { "x-kite-wallet": "not-an-address" },
    });
    expect(garbage.status).toBe(400);

    const ok = await app.request("/api/me", { headers: { "x-kite-wallet": W } });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { wallet: string };
    expect(body.wallet).toBe(W);
  });
});
