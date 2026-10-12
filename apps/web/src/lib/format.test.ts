// T007 — the D7 display helpers (FR-003): AUSD detail rows carry exactly two
// decimals with locale separators; headline rupiah/MYR render from integer
// display units, never a float. Screens format at render; nothing here stores.
// (JS regex \s spans the Unicode spaces ICU may emit — NBSP and narrow NBSP.)
import { describe, expect, it } from "bun:test";
import { formatAusdDetail, formatHeadline, formatHeadlineIntl } from "./money.js";

describe("formatAusdDetail (FR-003 detail rows)", () => {
  it("renders exactly two decimals with id/ms separators", () => {
    expect(formatAusdDetail(1_200_000_000n, "id")).toBe("1.200,00 AUSD");
    expect(formatAusdDetail(1_200_000_000n, "ms")).toBe("1.200,00 AUSD");
  });

  it("renders en separators", () => {
    expect(formatAusdDetail(1_200_000_000n, "en")).toBe("1,200.00 AUSD");
  });

  it("floors the 6 dp base units to 2 dp with integer math — never rounds by float", () => {
    // 1.234567 AUSD: the 0.000004 tail drops (floor), no drift.
    expect(formatAusdDetail(1_234_567n, "id")).toBe("1,23 AUSD");
    expect(formatAusdDetail(1_234_599n, "id")).toBe("1,23 AUSD");
    expect(formatAusdDetail(1_200_004n, "id")).toBe("1,20 AUSD");
  });

  it("groups large values; sub-unit values keep the leading zero", () => {
    expect(formatAusdDetail(1_234_567_890_123n, "en")).toBe("1,234,567.89 AUSD");
    expect(formatAusdDetail(400_000n, "id")).toBe("0,40 AUSD");
    expect(formatAusdDetail(0n, "id")).toBe("0,00 AUSD");
  });

  it("accepts the API's integral numbers and negative values symmetrically", () => {
    expect(formatAusdDetail(480_000_000, "id")).toBe("480,00 AUSD");
    expect(formatAusdDetail(-1_500_000n, "en")).toBe("-1.50 AUSD");
  });
});

describe("formatHeadline (approx headline, display-only)", () => {
  it("renders rupiah with id/ms grouping and the Rp symbol", () => {
    expect(formatHeadline(1_234_567n, "id", "IDR")).toBe("Rp 1.234.567");
    expect(formatHeadline(1_234_567n, "ms", "MYR")).toBe("RM 1.234.567");
  });

  it("renders en grouping for the judges' catalog", () => {
    expect(formatHeadline(1_234_567n, "en", "IDR")).toBe("Rp 1,234,567");
    expect(formatHeadline(7_650_000_000n, "en", "MYR")).toBe("RM 7,650,000,000");
  });

  it("zero and negative values stay exact integers (no float pass-through)", () => {
    expect(formatHeadline(0n, "id", "IDR")).toBe("Rp 0");
    expect(formatHeadline(-42n, "id", "IDR")).toBe("-Rp 42");
  });
});

describe("formatHeadlineIntl (D7 reference path)", () => {
  it("formats the bigint directly through Intl (no float conversion)", () => {
    // Locale data differences across runtimes make exact strings a snapshot;
    // pin the invariants: symbol present, digits intact, no decimals.
    const out = formatHeadlineIntl(1_234_567n, "id", "IDR");
    expect(out.replace(/[.\s]+/g, "")).toMatch(/^Rp1?234567$/);
    expect(out).not.toMatch(/,/);
  });
});
