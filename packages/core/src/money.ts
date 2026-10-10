// Constitution VI: money is integers in AUSD base units (6 dp) everywhere —
// contracts, DB, API. No float exists anywhere in this module. Demo magnitudes
// (≤ ~10^9 base units) keep every product below 2^53, so plain numbers with
// integer truncation are exact.
import { KiteError } from "./errors.js";

/** Rejects anything that is not a non-negative integer (AUSD base units). */
export function assertMoneyInteger(value: unknown, label = "amount"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new KiteError(
      "money_must_be_integer",
      `${label} must be a non-negative integer in AUSD base units`,
    );
  }
  return value;
}

/** Deal cap: principal × capMult ÷ 100, truncated integer (PLAN §6.2 bounds). */
export function capOf(principal: number, capMult: number): number {
  assertMoneyInteger(principal, "principal");
  if (typeof capMult !== "number" || !Number.isInteger(capMult) || capMult <= 0) {
    throw new KiteError("money_must_be_integer", "capMult must be a positive integer");
  }
  return Math.trunc((principal * capMult) / 100);
}

/**
 * Deal progress in basis points: (cap − remaining) × 10000 ÷ cap, truncated.
 * remaining must sit inside [0, cap] — the contract guarantees it; we refuse
 * to compute a negative or over-10000 progress rather than emit one.
 */
export function progressBps(remaining: number, cap: number): number {
  assertMoneyInteger(remaining, "remaining");
  assertMoneyInteger(cap, "cap");
  if (cap === 0) {
    throw new KiteError("cap_must_be_positive", "cap must be > 0 to compute progress");
  }
  if (remaining > cap) {
    throw new KiteError("remaining_exceeds_cap", "remaining must be ≤ cap");
  }
  return Math.trunc(((cap - remaining) * 10000) / cap);
}
