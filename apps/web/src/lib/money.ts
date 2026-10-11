// T013 — display-only money (constitution VI). Integer base units are the
// ONLY stored/wire form; the IDR/MYR rendering multiplies by the locked
// quote's `rate / 10^scale` — here as pure BigInt integer math, floored for
// display, never stored, never sent anywhere. (005 fx.ts: USD_IDR 16000 ×1,
// USD_MYR 4150 ×10⁻³; AUSD base units are 10⁻⁶.)

export interface QuoteLock {
  rate: number;
  scale: number;
}

const AUSD_BASE = 1_000_000n; // 10^6 base units per AUSD

/** base units → display units of the quote's currency (integer, floored). */
export function toDisplayUnits(baseAusd: number, quote: QuoteLock): bigint {
  const rate = BigInt(quote.rate);
  const divisor = AUSD_BASE * 10n ** BigInt(quote.scale);
  return (BigInt(baseAusd) * rate) / divisor;
}

/** Group a non-negative integer with dot separators (id/ms convention). */
export function formatGrouped(value: bigint): string {
  const digits = value.toString();
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) {
      out += ".";
    }
    out += digits[i];
  }
  return out;
}

/** AUSD base units → grouped whole-AUSD display ("600.000.000 → "600"). */
export function formatAusd(baseAusd: number): string {
  return formatGrouped(BigInt(baseAusd) / AUSD_BASE);
}
