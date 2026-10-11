// Display-only FX (PLAN §7.4, constitution VI/VIII): integer rate + per-pair
// scale, fixed demo constants, labeled "demo-fixed". No float anywhere —
// display conversion is `amountAusd × rate / 10^scale`, computed in the UI,
// never stored, never derived money from.
import { KiteError } from "./errors.js";

/** The quote lock window (§7.4): a quoted amount stays quoted for 60 s. */
export const QUOTE_TTL_MS = 60_000;

/** Demo source label — honesty boundary (constitution VIII). */
export const FX_SOURCE = "demo-fixed";

/** Demo pairs: IDR 16,000 ×1 (scale 0); MYR 4.150 ×10⁻³ (scale 3). */
export const FX_PAIRS = {
  USD_IDR: { rate: 16_000, scale: 0 },
  USD_MYR: { rate: 4_150, scale: 3 },
} as const;

export type FxPairName = keyof typeof FX_PAIRS;

export interface LockedQuote {
  pair: FxPairName;
  rate: number;
  scale: number;
  /** Epoch ms when the lock expires (now + QUOTE_TTL_MS). */
  expiresAt: number;
}

export function isFxPair(pair: string): pair is FxPairName {
  return pair === "USD_IDR" || pair === "USD_MYR";
}

/** Lock a quote: fixed rate + scale with an expiry `now + QUOTE_TTL_MS`. */
export function lockQuote(pair: FxPairName, now: number): LockedQuote {
  const defined = FX_PAIRS[pair];
  if (!defined) {
    throw new KiteError("unknown_pair", `unknown FX pair: ${pair}`);
  }
  return { pair, rate: defined.rate, scale: defined.scale, expiresAt: now + QUOTE_TTL_MS };
}
