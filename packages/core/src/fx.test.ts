import { describe, expect, it } from "bun:test";
import { FX_PAIRS, FX_SOURCE, isFxPair, lockQuote, QUOTE_TTL_MS } from "./fx.js";

describe("fx pairs (PLAN §7.4, D13)", () => {
  it("carries the fixed demo constants with their scales", () => {
    expect(FX_PAIRS.USD_IDR).toEqual({ rate: 16_000, scale: 0 });
    expect(FX_PAIRS.USD_MYR).toEqual({ rate: 4_150, scale: 3 });
    expect(FX_SOURCE).toBe("demo-fixed");
    expect(QUOTE_TTL_MS).toBe(60_000);
  });

  it("recognizes exactly the two pairs", () => {
    expect(isFxPair("USD_IDR")).toBe(true);
    expect(isFxPair("USD_MYR")).toBe(true);
    expect(isFxPair("USD_EUR")).toBe(false);
    expect(isFxPair("")).toBe(false);
  });
});

describe("lockQuote", () => {
  it("locks rate + scale with expiry now + 60 s", () => {
    const q = lockQuote("USD_IDR", 1_000_000);
    expect(q).toEqual({ pair: "USD_IDR", rate: 16_000, scale: 0, expiresAt: 1_060_000 });
    const m = lockQuote("USD_MYR", 1_000_000);
    expect(m).toEqual({ pair: "USD_MYR", rate: 4_150, scale: 3, expiresAt: 1_060_000 });
  });

  it("throws the unknown_pair code for anything else", () => {
    expect(() => lockQuote("USD_EUR" as never, 0)).toThrow(/unknown FX pair/);
  });

  it("holds the same lock inside the TTL and renews only after expiry (injected clock)", () => {
    // The TTL semantics quote-service implements against fx_quotes, proven on
    // the pure shape first: a cache keyed by pair that re-locks only when the
    // stored lock's expiry has passed.
    let now = 1_000_000;
    const clock = () => now;
    let stored: ReturnType<typeof lockQuote> | null = null;
    const cachedLock = (pair: Parameters<typeof lockQuote>[0]) => {
      if (!stored || clock() >= stored.expiresAt) stored = lockQuote(pair, clock());
      return stored;
    };

    const first = cachedLock("USD_IDR");
    now += QUOTE_TTL_MS - 1; // one ms inside the TTL
    expect(cachedLock("USD_IDR")).toBe(first); // SAME lock object

    now += 1; // expiry boundary reached
    const renewed = cachedLock("USD_IDR");
    expect(renewed).not.toBe(first);
    expect(renewed.expiresAt).toBe(now + QUOTE_TTL_MS);
  });
});
