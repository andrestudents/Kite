import { describe, expect, it } from "bun:test";
import { KiteError } from "./errors.js";
import { assertMoneyInteger, capOf, progressBps } from "./money.js";

describe("assertMoneyInteger (constitution VI)", () => {
  it("accepts non-negative integers incl. 0", () => {
    expect(assertMoneyInteger(0)).toBe(0);
    expect(assertMoneyInteger(600_000_000)).toBe(600_000_000);
    expect(assertMoneyInteger(1_500_000_000, "gross")).toBe(1_500_000_000);
  });

  it("rejects fractions, negatives, and non-numbers with the money code", () => {
    for (const bad of [1.5, -1, NaN, Infinity, "100", null, undefined, {}]) {
      expect(() => assertMoneyInteger(bad)).toThrow(KiteError);
      try {
        assertMoneyInteger(bad);
      } catch (e) {
        expect((e as KiteError).code).toBe("money_must_be_integer");
      }
    }
  });
});

describe("capOf", () => {
  it("computes principal × capMult ÷ 100 exactly at demo magnitudes", () => {
    expect(capOf(600_000_000, 130)).toBe(780_000_000);
    expect(capOf(300_000_000, 120)).toBe(360_000_000);
    expect(capOf(2_000_000_000, 150)).toBe(3_000_000_000);
  });

  it("truncates non-exact divisions (integer math only)", () => {
    expect(capOf(99, 133)).toBe(131); // 131.67 → 131
    expect(capOf(1, 101)).toBe(1); // 1.01 → 1
  });

  it("rejects non-integer or non-positive capMult", () => {
    expect(() => capOf(100, 1.5)).toThrow(KiteError);
    expect(() => capOf(100, 0)).toThrow(KiteError);
  });
});

describe("progressBps", () => {
  it("matches the live demo deal: remaining 480e6 of cap 780e6 → 3846", () => {
    expect(progressBps(480_000_000, 780_000_000)).toBe(3846);
  });

  it("spans 0..10000 and truncates", () => {
    expect(progressBps(780_000_000, 780_000_000)).toBe(0);
    expect(progressBps(0, 780_000_000)).toBe(10_000);
    expect(progressBps(1, 3)).toBe(6666); // 2/3 of 10000 = 6666.67
  });

  it("refuses remaining > cap and cap 0", () => {
    expect(() => progressBps(781, 780)).toThrow(KiteError);
    expect(() => progressBps(0, 0)).toThrow(KiteError);
  });
});
