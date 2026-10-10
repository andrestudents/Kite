// T014/T015: the §7.2 registry against real Postgres semantics (PGlite) —
// the UNIQUE(channel_id, purchase_ref) lock and the append-only transition
// log must actually fire (research D4/D17).
import { beforeEach, describe, expect, it } from "bun:test";
import { KiteError, type PurchaseDto } from "@kite/core";
import { purchases } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import type { Hono } from "hono";
import { privateKeyToAccount, sign } from "viem/accounts";
import { createApp } from "../app.js";
import type { ChainClient } from "./chain.js";
import { incomeDigest } from "./income-sig.js";
import {
  createPurchase,
  getPurchase,
  markPurchasePaid,
  transitionsOf,
  validateIntent,
} from "./purchase-service.js";

const MILL_KEY = `0x${"5e".repeat(32)}` as `0x${string}`;
const STRANGER_KEY = `0x${"b4".repeat(32)}` as `0x${string}`;
const MILL = privateKeyToAccount(MILL_KEY);

const REF = `0x${"c0".repeat(32)}` as `0x${string}`;
const SALT = `0x${"dd".repeat(32)}` as `0x${string}`;

const ISA_ONCHAIN = {
  principal: 600_000_000,
  shareBps: 2000,
  capMult: 130,
  termEnd: 1_800_000_000,
  channelId: 1,
  seeker: "0xseeker",
  backer: "0xbacker",
  remaining: 480_000_000,
  activatedAt: 1_700_000_000,
  lastEventAt: 1_700_000_060,
  eventCount: 3,
  status: 2,
};

function fakeChain(overrides: Partial<ChainClient> = {}): ChainClient {
  return {
    chainId: async () => 10143,
    blockNumber: async () => 10n,
    isaOf: async () => ISA_ONCHAIN,
    offerOf: async () => 600_000_000,
    scoreOf: async () => 58,
    profileOf: async () => ({ totalIsas: 1, completed: 0, qualEvents: 3, distinctBackers: 1 }),
    channelOf: async () => ({ name: "Mill Satu", pubkey: MILL.address, active: true }),
    identityOf: async () => `0x${"00".repeat(32)}`,
    walletOfIdentity: async () => "0xwallet",
    balanceAusd: async () => 1_000_000n,
    minEventGap: async () => 60,
    blockTimestamp: async () => 1_700_000_000,
    settlementLogs: async () => [],
    ...overrides,
  } as unknown as ChainClient;
}

function intentOf(overrides: Record<string, unknown> = {}, signerKey = MILL_KEY) {
  const base = { channelId: 1, isaId: 3, purchaseRef: REF, grossAusd: 1_500_000_000, salt: SALT };
  const i = { ...base, ...overrides };
  return sign({
    hash: incomeDigest({
      channelId: i.channelId,
      isaId: i.isaId,
      purchaseRef: i.purchaseRef,
      gross: i.grossAusd,
      salt: i.salt,
    }),
    privateKey: signerKey,
  }).then((s) => ({
    channelId: i.channelId,
    isaId: i.isaId,
    purchaseRef: i.purchaseRef,
    grossAusd: i.grossAusd,
    millSig: { salt: i.salt, v: Number(s.v), r: s.r, s: s.s },
  }));
}

// A body with the right shape but arbitrary signature material — enough for
// the pure structural validator (no signing, so malformed hex stays expressible).
const RAW_OK = {
  channelId: 1,
  isaId: 3,
  purchaseRef: REF,
  grossAusd: 1_500_000_000,
  millSig: { salt: SALT, v: 27, r: `0x${"aa".repeat(32)}`, s: `0x${"bb".repeat(32)}` },
};

describe("validateIntent (422 shapes)", () => {
  it("accepts a structurally valid body", () => {
    expect(validateIntent(structuredClone(RAW_OK))).toEqual({
      channelId: 1,
      isaId: 3,
      purchaseRef: REF,
      grossAusd: 1_500_000_000,
      millSig: RAW_OK.millSig,
    });
  });

  it("rejects non-integer or negative money with the constitution-VI code", () => {
    for (const grossAusd of [1.5, -1, "100", null]) {
      try {
        validateIntent({ ...RAW_OK, grossAusd });
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(KiteError);
        expect((e as KiteError).code).toBe("money_must_be_integer");
      }
    }
  });

  it("rejects malformed refs, salts, and signature components", () => {
    for (const make of [
      () => ({ ...RAW_OK, purchaseRef: "0x1234" }),
      () => ({ ...RAW_OK, millSig: { ...RAW_OK.millSig, salt: "0xbeef" } }),
      () => ({ ...RAW_OK, millSig: { ...RAW_OK.millSig, v: 26 } }),
      () => ({ ...RAW_OK, millSig: { ...RAW_OK.millSig, r: "nothex" } }),
      () => ({ ...RAW_OK, millSig: { ...RAW_OK.millSig, s: null } }),
      () => ({ ...RAW_OK, channelId: 0 }),
      () => ({ ...RAW_OK, isaId: 1.5 }),
    ]) {
      expect(() => validateIntent(make())).toThrow(KiteError);
    }
  });
});

describe("createPurchase (§7.2 rule 1)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("creates exactly one PENDING purchase with the signature stored at creation", async () => {
    const { purchase, created } = await createPurchase(db, fakeChain(), await intentOf());
    expect(created).toBe(true);
    expect(purchase.status).toBe("PENDING");
    expect(purchase.grossAusd).toBe(1_500_000_000);

    // The DTO carries no signature echo; the row must hold it for the
    // later gasless submit (T019 reads millSig back).
    const stored = await db.select().from(purchases);
    expect(stored.length).toBe(1);
    const storedRow = stored[0];
    expect(storedRow?.millSig.salt).toBe(SALT);
    expect(storedRow?.millSig.r).toBe((await intentOf()).millSig.r);

    const log = await transitionsOf(db, purchase.id);
    expect(log.map((t) => `${t.fromStatus}->${t.toStatus}`)).toContain("CREATED->PENDING");
  });

  it("returns the SAME purchase for an identical duplicate — no second row", async () => {
    const body = await intentOf();
    const first = await createPurchase(db, fakeChain(), body);
    const second = await createPurchase(db, fakeChain(), body);
    expect(second.created).toBe(false);
    expect(second.purchase.id).toBe(first.purchase.id);
    const stored = await db.select().from(purchases);
    expect(stored.length).toBe(1);
  });

  it("rejects ref reuse with a different payload (409-shaped)", async () => {
    await createPurchase(db, fakeChain(), await intentOf());
    try {
      await createPurchase(db, fakeChain(), await intentOf({ grossAusd: 2_000_000_000 }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as KiteError).code).toBe("purchase_ref_conflict");
    }
  });

  it("rejects a signature that is not the channel signer", async () => {
    try {
      await createPurchase(db, fakeChain(), await intentOf({}, STRANGER_KEY));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as KiteError).code).toBe("invalid_signature");
    }
  });

  it("rejects unknown and inactive channels", async () => {
    for (const overrides of [
      {
        channelOf: async () => {
          throw new Error("rpc revert");
        },
      },
      { channelOf: async () => ({ name: "x", pubkey: MILL.address, active: false }) },
    ]) {
      try {
        await createPurchase(db, fakeChain(overrides), await intentOf());
        throw new Error("should have thrown");
      } catch (e) {
        expect((e as KiteError).code).toBe("unknown_channel");
      }
    }
  });

  it("rejects an isa from another channel or nonexistent", async () => {
    for (const isa of [
      { ...ISA_ONCHAIN, channelId: 9 },
      { ...ISA_ONCHAIN, status: 0 },
    ]) {
      try {
        await createPurchase(db, fakeChain({ isaOf: async () => isa }), await intentOf());
        throw new Error("should have thrown");
      } catch (e) {
        expect((e as KiteError).code).toBe("unknown_isa");
      }
    }
  });
});

describe("markPurchasePaid (§7.2 rule 2, FR-007)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("moves PENDING → PAID once, logging the transition", async () => {
    const { purchase } = await createPurchase(db, fakeChain(), await intentOf());
    const paid = await markPurchasePaid(db, purchase.id, "mita");
    expect(paid.status).toBe("PAID");
    const log = await transitionsOf(db, purchase.id);
    const pair = log.map((t) => `${t.fromStatus}->${t.toStatus}:${t.actor}`);
    expect(pair).toContain("PENDING->PAID:mita");
  });

  it("rejects a repeat and logs the rejected attempt", async () => {
    const { purchase } = await createPurchase(db, fakeChain(), await intentOf());
    await markPurchasePaid(db, purchase.id, "mita");
    try {
      await markPurchasePaid(db, purchase.id, "mita");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as KiteError).code).toBe("invalid_transition");
    }
    const log = await transitionsOf(db, purchase.id);
    expect(log.some((t) => t.actor === "rejected:mita")).toBe(true);
  });

  it("404-shapes unknown ids", async () => {
    await expect(markPurchasePaid(db, "not-a-uuid", "mita")).rejects.toMatchObject({
      code: "purchase_not_found",
    });
    await expect(getPurchase(db, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
      code: "purchase_not_found",
    });
  });
});

describe("purchase routes (http-api.md shapes)", () => {
  let db: TestDb;
  let app: Hono;
  let mitaKey: string;

  beforeEach(async () => {
    db = await makeTestDb();
    mitaKey = "mita-demo-key";
    app = createApp({ db, chain: fakeChain(), mitaKey });
  });

  const post = (path: string, body: unknown, key = mitaKey) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
      body: JSON.stringify(body),
    });

  it("401 without the key — no echo", async () => {
    const res = await post("/api/channel/purchases", await intentOf(), "");
    expect(res.status).toBe(401);
    const payload = await res.json();
    expect(JSON.stringify(payload)).not.toContain(mitaKey);
  });

  it("POST → 201; identical POST → 200 same id (route-level idempotency)", async () => {
    const body = await intentOf();
    const first = await post("/api/channel/purchases", body);
    expect(first.status).toBe(201);
    const dto = (await first.json()) as PurchaseDto;
    const second = await post("/api/channel/purchases", body);
    expect(second.status).toBe(200);
    const dto2 = (await second.json()) as PurchaseDto;
    expect(dto2.id).toBe(dto.id);
  });

  it("paid flow over HTTP + GET roundtrip", async () => {
    const body = await intentOf();
    const created = (await (await post("/api/channel/purchases", body)).json()) as PurchaseDto;
    const paid = await app.request(`/api/channel/purchases/${created.id}/paid`, {
      method: "POST",
      headers: { "x-api-key": mitaKey },
    });
    expect(paid.status).toBe(200);
    expect(((await paid.json()) as PurchaseDto).status).toBe("PAID");

    const got = await app.request(`/api/channel/purchases/${created.id}`, {
      headers: { "x-api-key": mitaKey },
    });
    expect(got.status).toBe(200);

    const missing = await app.request(
      "/api/channel/purchases/11111111-1111-1111-1111-111111111111",
      {
        headers: { "x-api-key": mitaKey },
      },
    );
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe(
      "purchase_not_found",
    );
  });
});
