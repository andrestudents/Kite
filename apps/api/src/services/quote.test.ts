// T028: the 60 s quote lock — same row inside the TTL, fresh lock past it,
// unknown pairs refused, USD_MYR carries scale 3 (D13).
import { beforeEach, describe, expect, it } from "bun:test";
import { type AnyDb, fxQuotes } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { fakeChain } from "./fake-chain.js";
import { getQuote } from "./quote-service.js";

async function quoteRows(db: AnyDb, pair: string) {
  return db.select().from(fxQuotes).where(eq(fxQuotes.pair, pair));
}

describe("quote lock (T028)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("writes a lock on first ask and returns the SAME row inside the TTL", async () => {
    const first = await getQuote(db, "USD_IDR");
    expect(first.pair).toBe("USD_IDR");
    expect(first.rate).toBe(16_000);
    expect(first.scale).toBe(0);
    expect(first.source).toBe("demo-fixed");
    expect(new Date(first.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await quoteRows(db, "USD_IDR")).length).toBe(1);

    const second = await getQuote(db, "USD_IDR");
    expect(second.expiresAt).toBe(first.expiresAt); // the same locked row
    expect((await quoteRows(db, "USD_IDR")).length).toBe(1);
  });

  it("an expired lock is replaced with a fresh one (history kept)", async () => {
    await getQuote(db, "USD_IDR");
    await db
      .update(fxQuotes)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(fxQuotes.pair, "USD_IDR"));

    const fresh = await getQuote(db, "USD_IDR");
    expect(new Date(fresh.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await quoteRows(db, "USD_IDR")).length).toBe(2); // append, not overwrite
  });

  it("USD_MYR carries its own rate and scale", async () => {
    const myr = await getQuote(db, "USD_MYR");
    expect(myr.rate).toBe(4_150);
    expect(myr.scale).toBe(3);
  });
});

describe("GET /api/quote (http shapes)", () => {
  it("unknown pair → 400 unknown_pair; default is USD_IDR", async () => {
    const db = await makeTestDb();
    const app = createApp({ db, chain: fakeChain(), mitaKey: "k" });

    const bad = await app.request("/api/quote?pair=USD_EUR");
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { error: { code: string } };
    expect(badBody.error.code).toBe("unknown_pair");

    const ok = await app.request("/api/quote");
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { pair: string };
    expect(okBody.pair).toBe("USD_IDR");
  });
});
