// T013 — display-only money math stays integer (constitution VI).
import { describe, expect, it } from "bun:test";
import { formatAusd, formatGrouped, toDisplayUnits } from "./money.js";

describe("toDisplayUnits — base units × rate / 10^scale, in integers", () => {
  it("USD_IDR: 1 AUSD = 16.000", () => {
    expect(toDisplayUnits(1_000_000, { rate: 16_000, scale: 0 })).toBe(16_000n);
  });
  it("USD_MYR: 1 AUSD = 4.15 → floored 4 for display", () => {
    expect(toDisplayUnits(1_000_000, { rate: 4_150, scale: 3 })).toBe(4n);
    expect(toDisplayUnits(2_000_000, { rate: 4_150, scale: 3 })).toBe(8n);
  });
  it("sub-cent amounts floor to zero — never a float, never negative", () => {
    expect(toDisplayUnits(1, { rate: 16_000, scale: 0 })).toBe(0n);
  });
  it("large balances stay exact (no Number precision loss)", () => {
    expect(toDisplayUnits(600_000_000_000_000, { rate: 16_000, scale: 0 })).toBe(
      9_600_000_000_000n,
    );
  });
});

describe("formatGrouped / formatAusd", () => {
  it("groups with dot separators", () => {
    expect(formatGrouped(16_000n)).toBe("16.000");
    expect(formatGrouped(0n)).toBe("0");
    expect(formatGrouped(1_234_567_890n)).toBe("1.234.567.890");
  });
  it("formats base units as whole AUSD", () => {
    expect(formatAusd(600_000_000)).toBe("600");
    expect(formatAusd(480_000_000)).toBe("480");
    expect(formatAusd(1_500_000)).toBe("1");
  });
});
