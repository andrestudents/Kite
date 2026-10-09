// LOCAL-EVM BASELINE — recalibrate on Monad at deploy.
//
// PLAN §6.1 publish step (T025): fixed gas limits for every state-changing
// external function, measured by `forge test --gas-report` + `forge snapshot`
// (contracts/.gas-snapshot, committed) on the local EVM with solc 0.8.36.
//
// Rule (PLAN §6.1): gas is charged on the LIMIT, not the used amount — so
// every limit below is   fixedLimit = ceil(maxObservedGas × 1.25 / 1000) × 1000
// (25 % headroom over the observed MAXIMUM, rounded up to the next thousand).
// Monad's EVM-equivalent pricing must be re-measured before mainnet limits
// are published; until then these are the source of truth for relayer txs.

/** One published gas limit: the observed maximum and the limit derived from it. */
export interface KiteGasLimit {
  /** Highest gas observed for this function across the whole test suite. */
  observedMax: number;
  /** ceil(observedMax × 1.25 / 1000) × 1000 — what relayers must send. */
  fixedLimit: number;
}

/** KiteCore (UUPS proxy) — PLAN §6.1 state-changing surface. */
export const KITE_GAS_LIMITS = {
  initialize: { observedMax: 195025, fixedLimit: 244000 },
  createISADraft: { observedMax: 211261, fixedLimit: 265000 },
  activateWithPermit: { observedMax: 207755, fixedLimit: 260000 },
  cancelDraft: { observedMax: 11863, fixedLimit: 15000 },
  receiveIncome: { observedMax: 245460, fixedLimit: 307000 },
  completeAtTerm: { observedMax: 77582, fixedLimit: 97000 },
  flagMismatch: { observedMax: 5228, fixedLimit: 7000 },
  bindIdentity: { observedMax: 76557, fixedLimit: 96000 },
  registerChannel: { observedMax: 101756, fixedLimit: 128000 },
  pause: { observedMax: 26073, fixedLimit: 33000 },
  unpause: { observedMax: 9017, fixedLimit: 12000 },
  grantRole: { observedMax: 30328, fixedLimit: 38000 },
  revokeRole: { observedMax: 13228, fixedLimit: 17000 },
  upgradeToAndCall: { observedMax: 12124, fixedLimit: 16000 },
} as const satisfies Record<string, KiteGasLimit>;

/** MockAUSD — the labeled Demo Tool money rail (PLAN §6.1). */
export const MOCK_AUSD_GAS_LIMITS = {
  approve: { observedMax: 47263, fixedLimit: 60000 },
  transfer: { observedMax: 52148, fixedLimit: 66000 },
  transferFrom: { observedMax: 53573, fixedLimit: 67000 },
  permit: { observedMax: 76859, fixedLimit: 97000 },
  transferWithAuthorization: { observedMax: 83376, fixedLimit: 105000 },
} as const satisfies Record<string, KiteGasLimit>;

/**
 * Deployment costs observed for sizing deploy transactions.
 * (Was `KITE_DEPLOYMENT` in the Feature-003 baseline; renamed — that name now
 * belongs to the live deployment record in src/addresses.ts, Feature 004.)
 */
export const KITE_DEPLOY_GAS = {
  kiteCoreImpl: 6185121,
  erc1967Proxy: 345806,
  mockAusd: 1917292,
} as const satisfies Record<string, number>;

export type KiteGasLimits = typeof KITE_GAS_LIMITS;
export type MockAusdGasLimits = typeof MOCK_AUSD_GAS_LIMITS;
