// T031 (D18, constitution I): every human-readable string VALUE rendered by
// /api/me, /api/p/:id, /api/quote is free of the banned words. JSON keys and
// uppercase machine states (SETTLED, USD_IDR) are data, not copy — exempt;
// so are hex identities and ISO timestamps.
import { beforeEach, describe, expect, it } from "bun:test";
import { isas, purchases } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { fakeChain } from "./services/fake-chain.js";
import { getMe } from "./services/me-service.js";
import { getProfile } from "./services/profile-service.js";
import { getQuote } from "./services/quote-service.js";

const W = `0x${"a1".repeat(20)}` as `0x${string}`;
const BACKER = `0x${"b2".repeat(20)}` as `0x${string}`;
const HASH = `0x${"c3".repeat(32)}`;
const REF = `0x${"11".repeat(32)}`;
const BANNED_WORDS = /\b(wallet|gas|chain|token|seed|pending)\b|onchain transaction/i;

/** Yields every string VALUE with its path; keys are never scanned. */
function* stringValues(node: unknown, path = "$"): Generator<string> {
  if (typeof node === "string") {
    yield node;
  } else if (Array.isArray(node)) {
    for (const item of node) {
      yield* stringValues(item, `${path}[]`);
    }
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      yield* stringValues(value, `${path}.${key}`);
    }
  }
}

/** Data, not copy: hex identities, ISO timestamps, UPPERCASE machine states. */
function isData(value: string): boolean {
  return (
    /^0x[0-9a-f]+$/i.test(value) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:/.test(value) ||
    /^[A-Z0-9_]+$/.test(value)
  );
}

async function seedRichFixture(db: TestDb): Promise<void> {
  await db.insert(isas).values({
    isaId: 3,
    seeker: W,
    backer: BACKER,
    principal: 600_000_000,
    shareBps: 2_000,
    capMult: 130,
    remaining: 300_000_000,
    status: "active",
    termEnd: 1_794_270_000,
  });
  await db.insert(purchases).values({
    channelId: 1,
    isaId: 3,
    purchaseRef: REF,
    grossAusd: 1_500_000_000,
    status: "PENDING", // uppercase machine state — present AND exempt
    millSig: { salt: HASH, v: 27, r: HASH, s: HASH },
  });
}

const fixtureChain = () =>
  fakeChain({
    identityOf: async () => HASH,
    balanceAusd: async () => 1_200_000_000n,
    scoreOf: async () => 58,
    offerOf: async () => 1_296_000_000,
    profileOf: async () => ({ totalIsas: 2, completed: 2, qualEvents: 4, distinctBackers: 2 }),
    isaOf: async () => ({
      principal: 600_000_000,
      shareBps: 2_000,
      capMult: 130,
      termEnd: 1_794_270_000,
      channelId: 1,
      seeker: W,
      backer: BACKER,
      remaining: 300_000_000,
      activatedAt: 1_791_580_100,
      lastEventAt: 1_791_580_800,
      eventCount: 1,
      status: 2,
    }),
    walletOfIdentity: async () => W,
    settlementLogs: async () => [
      {
        isaId: 3,
        channelId: 1,
        purchaseRef: REF,
        gross: 1_500_000_000,
        toBacker: 180_000_000,
        toSeeker: 1_320_000_000,
        remaining: 300_000_000,
        qualifying: true,
        blockNumber: 50n,
        logIndex: 0,
        txHash: "0xtx1",
      },
    ],
  });

describe("banned words (T031)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("/api/me carries no banned word in any human-readable value", async () => {
    await seedRichFixture(db);
    const me = await getMe(db, fixtureChain(), W);
    const violations = [...stringValues(me)]
      .map((value, i) => ({ value, i }))
      .filter(({ value }) => !isData(value) && BANNED_WORDS.test(value));
    expect(violations).toEqual([]);
  });

  it("/api/p/:id carries no banned word in any human-readable value", async () => {
    await seedRichFixture(db);
    const profile = await getProfile(db, fixtureChain(), HASH);
    const violations = [...stringValues(profile)].filter(
      (value) => !isData(value) && BANNED_WORDS.test(value),
    );
    expect(violations).toEqual([]);
  });

  it("/api/quote carries no banned word in any human-readable value", async () => {
    for (const pair of ["USD_IDR", "USD_MYR"]) {
      const quote = await getQuote(db, pair);
      const violations = [...stringValues(quote)].filter(
        (value) => !isData(value) && BANNED_WORDS.test(value),
      );
      expect(violations).toEqual([]);
    }
  });

  it("the scanner itself catches lowercase copy (a guard against a vacuous test)", () => {
    const sample = { note: "your tokens are in the wallet, gas is covered" };
    const violations = [...stringValues(sample)].filter(
      (value) => !isData(value) && BANNED_WORDS.test(value),
    );
    expect(violations.length).toBe(1);
  });
});
