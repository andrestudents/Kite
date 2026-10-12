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

// ── 007 T007 (research D7) — the copy-rule display helpers (FR-003) ────────
// Headline: rupiah/MYR with "≈" (the caller supplies the prefix), rendered
// per locale at render time and NEVER stored. Detail row: exactly two
// decimals + locale separators ("1.200,00 AUSD"). Every path stays integer:
// Intl.NumberFormat formats the bigint directly (NumberFormat v3), so no
// value ever passes through a float.

/** The UI locale tag each catalog maps to (FR-002: id default, ms, en). */
export type MoneyLocale = "id" | "ms" | "en";

const LOCALE_TAGS: Record<MoneyLocale, string> = {
  id: "id-ID",
  ms: "ms-MY",
  en: "en-US",
};

const CURRENCY_SYMBOLS: Record<"IDR" | "MYR", string> = { IDR: "Rp", MYR: "RM" };

const GROUP_SEPS: Record<MoneyLocale, string> = { id: ".", ms: ".", en: "," };
const DEC_SEPS: Record<MoneyLocale, string> = { id: ",", ms: ",", en: "." };

function groupDigits(digits: string, sep: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) {
      out += sep;
    }
    out += digits[i];
  }
  return out;
}

/** AUSD base units → the detail-row string, exactly 2 decimals (integer
 *  floor from 6 dp — truncation, never rounding by float). */
export function formatAusdDetail(baseAusd: bigint | number, locale: MoneyLocale): string {
  const base = BigInt(baseAusd);
  const sign = base < 0n ? "-" : "";
  const abs = base < 0n ? -base : base;
  const whole = abs / AUSD_BASE;
  const cents = (abs % AUSD_BASE) / 10_000n; // 6 dp → 2 dp, floor
  return `${sign}${groupDigits(whole.toString(), GROUP_SEPS[locale])}${DEC_SEPS[locale]}${cents
    .toString()
    .padStart(2, "0")} AUSD`;
}

/** The locked quote's display units (bigint, floored) → the headline currency
 *  string ("Rp 1.200.000" / "RM 312.000"). Intl formats the bigint directly —
 *  no float ever touches the value; NBSPs are normalized for stable widths. */
export function formatHeadline(
  displayUnits: bigint,
  locale: MoneyLocale,
  currency: "IDR" | "MYR",
): string {
  const sign = displayUnits < 0n ? "-" : "";
  const abs = displayUnits < 0n ? -displayUnits : displayUnits;
  const grouped = groupDigits(abs.toString(), GROUP_SEPS[locale]);
  return `${sign}${CURRENCY_SYMBOLS[currency]} ${grouped}`;
}

/** Keep the Intl path beside the integer one for locale-correct rendering
 *  where a runtime's ICU differs (tests pin the integer path; this helper is
 *  the D7 reference implementation). */
export function formatHeadlineIntl(
  displayUnits: bigint,
  locale: MoneyLocale,
  currency: "IDR" | "MYR",
): string {
  const formatted = new Intl.NumberFormat(LOCALE_TAGS[locale], {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(displayUnits);
  return formatted.replace(new RegExp(`[${String.fromCharCode(160, 8239)}]`, "g"), " ");
}
