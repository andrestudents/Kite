// MONAD TESTNET MEASURED (chain 10143, 2026-10-10).
//
// PLAN §6.1 publish step: fixed gas limits for every state-changing external
// function. Monad charges on the LIMIT, not the used gas — so every limit is
//   fixedLimit = ceil(observedMax × 1.25 / 1000) × 1000
// (25 % headroom over the observed MAXIMUM, rounded up to the next thousand).
//
// "observedMax" here is the gas the live deployment's own broadcasts executed
// with (forge/cast eth_estimateGas values, harvested from the Feature-004
// broadcast records — receipts on Monad report the CHARGED limit, not usage).
// COLD-state caveat (manual loop, 2026-10-10): Monad's cold-state pricing runs
// far above a warm path (bindIdentity 125,713 live vs 76,013 on a local fork;
// activateWithPermit 276,644 cold vs ~178,838 warm) — a cold broadcast at the
// warm-derived limit reverts with EMPTY data (= out of gas; a mined revert pays
// the full limit). Warm numbers only ever under-publish: prefer cold estimates.
// Functions not yet exercised on Monad are marked below: their limit derives
// from the local-EVM maximum × 1.5 (the largest cold-pricing inflation
// observed live, bindIdentity 125,713 vs local 76,557) before the same × 1.25
// headroom rule. Re-measure before mainnet limits are published.

/** One published gas limit: the observed maximum and the limit derived from it. */
export interface KiteGasLimit {
  /** Highest gas observed for this function (Monad, unless marked below). */
  observedMax: number;
  /** ceil(observedMax × 1.25 / 1000) × 1000 — what relayers must send. */
  fixedLimit: number;
}

/** KiteCore (UUPS proxy) — PLAN §6.1 state-changing surface. */
export const KITE_GAS_LIMITS = {
  // not exercised on Monad: 195025 local × 1.5 × 1.25
  initialize: { observedMax: 195025, fixedLimit: 366000 },
  createISADraft: { observedMax: 275655, fixedLimit: 345000 },
  // COLD-state live estimate (fresh wallets, manual loop 2026-10-10): the seed's
  // warm-state path estimated ~178k but a cold broadcast at 256k OOG'd on Monad
  // (charged on the limit; empty revert data). 276644 x 1.25 -> 346000.
  activateWithPermit: { observedMax: 276644, fixedLimit: 346000 },
  // not exercised on Monad: 11863 local × 1.5 × 1.25
  cancelDraft: { observedMax: 11863, fixedLimit: 23000 },
  // Warm-state live estimate 194009 (seed); the manual loop's COLD broadcast
  // passed at 502000, which bounds the cold need from above — so the limit
  // deliberately stays 502000 (ceil(obs x 1.25) = 243000 is proven too tight
  // to claim for a cold relayer; keep the measured-pass bound instead).
  receiveIncome: { observedMax: 194009, fixedLimit: 502000 },
  // not exercised on Monad: 77582 local × 1.5 × 1.25
  completeAtTerm: { observedMax: 77582, fixedLimit: 146000 },
  // not exercised on Monad: 5228 local × 1.5 × 1.25
  flagMismatch: { observedMax: 5228, fixedLimit: 10000 },
  bindIdentity: { observedMax: 125713, fixedLimit: 158000 },
  registerChannel: { observedMax: 101756, fixedLimit: 128000 },
  // not exercised on Monad: 26073 local × 1.5 × 1.25
  pause: { observedMax: 26073, fixedLimit: 49000 },
  // not exercised on Monad: 9017 local × 1.5 × 1.25
  unpause: { observedMax: 9017, fixedLimit: 17000 },
  // not exercised on Monad: 30328 local × 1.5 × 1.25
  grantRole: { observedMax: 30328, fixedLimit: 57000 },
  // not exercised on Monad: 13228 local × 1.5 × 1.25
  revokeRole: { observedMax: 13228, fixedLimit: 25000 },
  // not exercised on Monad: 12124 local × 1.5 × 1.25
  upgradeToAndCall: { observedMax: 12124, fixedLimit: 23000 },
} as const satisfies Record<string, KiteGasLimit>;

/** MockAUSD — the labeled Demo Tool money rail (PLAN §6.1). */
export const MOCK_AUSD_GAS_LIMITS = {
  approve: { observedMax: 60826, fixedLimit: 77000 },
  transfer: { observedMax: 73628, fixedLimit: 93000 },
  // not exercised on Monad: 53573 local × 1.5 × 1.25
  transferFrom: { observedMax: 53573, fixedLimit: 101000 },
  // not exercised on Monad: 76859 local × 1.5 × 1.25
  permit: { observedMax: 76859, fixedLimit: 145000 },
  // not exercised on Monad: 83376 local × 1.5 × 1.25
  transferWithAuthorization: { observedMax: 83376, fixedLimit: 157000 },
} as const satisfies Record<string, KiteGasLimit>;

/**
 * Deployment costs observed on Monad (chain 10143) for sizing deploy txs.
 * (Was `KITE_DEPLOYMENT` in the Feature-003 baseline; renamed — that name now
 * belongs to the live deployment record in src/addresses.ts, Feature 004.
 * Local-EVM baseline was 6185121 / 345806 / 1917292 — deploys came out
 * CHEAPER on Monad, state-heavy calls more expensive.)
 */
export const KITE_DEPLOY_GAS = {
  kiteCoreImpl: 4075639,
  erc1967Proxy: 382799,
  mockAusd: 1044461,
} as const satisfies Record<string, number>;

export type KiteGasLimits = typeof KITE_GAS_LIMITS;
export type MockAusdGasLimits = typeof MOCK_AUSD_GAS_LIMITS;
