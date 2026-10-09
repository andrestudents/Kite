# Contract: KiteScoring library API

**Feature**: 002-kite-scoring-math · **Artifact**: `contracts/src/KiteScoring.sol`
**Authority**: PLAN §6.1–§6.3 (frozen); spec FR-001..FR-008 · **Decisions**: research.md D1–D10

This is the interface the library exposes to its only future consumer group (the
KiteCore modules) and to the test suite. Every function is `internal pure` — inlined
at compile time, never deployed, reads/writes nothing (spec FR-005).

## Signatures

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library KiteScoring {
    struct Profile {
        uint64 totalISAs;       // PLAN §6.2
        uint64 completed;
        uint64 qualEvents;
        uint64 distinctBackers;
    }

    uint256 internal constant BASE_MAX_P    = 600e6;     // 600 AUSD, 6 dp (§6.2)
    uint256 internal constant MIN_EVENT_GAP = 60 days;   // 5_184_000 s (§6.2)
    uint256 internal constant MIN_EVENT_BPS = 1000;      // ≥ 10% of principal (§6.2)

    function score(Profile memory p) internal pure returns (uint8);
    function offerOf(uint8 score_) internal pure returns (uint256 maxP);
    function divert(uint256 gross, uint256 shareBps, uint256 remaining)
        internal pure returns (uint256 toBacker, uint256 toSeeker);
    function isQualifyingEvent(uint256 lastEventAt, uint256 now, uint256 gross, uint256 principal)
        internal pure returns (bool);
}
```

Units: money = AUSD **base units (6 decimals)**; `shareBps` = basis points (2000 = 20%);
timestamps = whole seconds. `now` is a legal identifier in Solidity 0.8.x.

## Behavioral contract per function

### `score(Profile) → uint8` — PLAN §6.3

- History = `⌊40 × completed × min(totalISAs,3) ÷ (totalISAs × 3)⌋`, **0 when `totalISAs == 0`**, then capped at **13 if `distinctBackers < 2`**.
- Consistency = `⌊20 × min(qualEvents,12) ÷ 12⌋`; Volume = `⌊40 × min(qualEvents,6) ÷ 6⌋`.
- Returns the sum; ∈ [0,100] for ledger-valid inputs (research.md D7 — no defensive clamp).
- Never reverts for ledger-valid inputs.

### `offerOf(uint8) → uint256` — PLAN §6.3

- `maxP = BASE_MAX_P × (100 + 2 × score) ÷ 100` — exact integer division (BASE_MAX_P divisible by 100 → always exact).
- Monotonic non-decreasing in score; range [600e6, 1800e6].

### `divert(gross, shareBps, remaining) → (toBacker, toSeeker)` — PLAN §6.2/§6.3

- `toBacker = min(⌊gross × shareBps ÷ 10000⌋, remaining)`; `toSeeker = gross − toBacker`.
- Invariants (PLAN §6.4 #1): `toBacker ≤ remaining`, `toBacker + toSeeker == gross` — for **all** inputs including 0s.
- Never reverts (subtraction cannot underflow: `toBacker ≤ gross` always holds since both min-branches are ≤ gross·shareBps/10000 ≤ gross).

### `isQualifyingEvent(lastEventAt, now, gross, principal) → bool` — PLAN §6.3/§6.2

- True iff `lastEventAt == 0 || lastEventAt + MIN_EVENT_GAP ≤ now` **AND** `gross × 10000 ≥ principal × MIN_EVENT_BPS`.
- Additive gap check: clock inversion (`lastEventAt > now`) → **false, never a revert** (D6).
- Both boundaries inclusive: exactly 60 days qualifies; exactly 10% of principal qualifies.

## Literal acceptance vectors (constitution IX — must match exactly)

| # | Call | Expected |
|---|---|---|
| L1 | `score({0,0,0,0})` / `offerOf(0)` | `0` / `600e6` |
| L2 | `score({2,2,4,2})` (+components) / `offerOf(58)` | `58` (H 26 · C 6 · V 26) / `1296e6` |
| L3 | `score({3,3,7,3})` (+components) / `offerOf(91)` | `91` (H 40 · C 11 · V 40) / `1692e6` |
| L4 | `score({3,3,7,1})` | `64` (History capped at 13) |
| L5 | `divert(1500e6, 2000, 780e6)` | `(300e6, 1200e6)` |
| L6 | `divert(1500e6, 2000, 180e6)` | `(180e6, 1320e6)` — cap reached |

Profile literals are `{totalISAs, completed, qualEvents, distinctBackers}`.

## Test-name contract (`contracts/test/KiteScoring.t.sol`)

The quickstart references these exact names; the implementation MUST use them.

**Literal tier** (`--match-test testLiteral`):

| Test | Asserts |
|---|---|
| `testLiteral_Score_NewAccount_0_Offer600` | L1 |
| `testLiteral_Score_BudiPrepared_58_Offer1296` | L2 incl. components 26/6/26 |
| `testLiteral_Score_AfterDemo_91_Offer1692` | L3 incl. components 40/11/40 |
| `testLiteral_Score_SingleBacker_HistoryCap13_Score64` | L4 |
| `testLiteral_Divert_Panen1_300_1200` | L5 |
| `testLiteral_Divert_Panen3_CapReached_180_1320` | L6 |

**Boundary tier** (`--match-test testBoundary`):

| Test | Asserts |
|---|---|
| `testBoundary_Divert_CapReachedExactly` | `divert(1500e6, 2000, 300e6) == (300e6, 1200e6)` — slice == remaining |
| `testBoundary_Qualifying_Gap59Days_False` | 59 days → false |
| `testBoundary_Qualifying_Gap60Days_True` | exactly 60 days + ≥10% → true |
| `testBoundary_Qualifying_GrossBelow10Pct_False` | 9.99% of principal → false |
| `testBoundary_Qualifying_GrossExactly10Pct_True` | exactly 10% → true |
| `testBoundary_Qualifying_FirstEvent_Qualifies` | `lastEventAt = 0` → gap bar passes |
| `testBoundary_Qualifying_ClockInversion_False` | `lastEventAt > now` → false, no revert |
| `testBoundary_Divert_ZeroGross_0_0` | `(0, 0)` |
| `testBoundary_Divert_ZeroRemaining_AllToSeeker` | `(0, gross)` |
| `testBoundary_Score_Saturation_Consistency12_Volume6` | qualEvents ≥ 12 → C 20, V 40 (History unaffected) |
| `testBoundary_Offer_Score100_1800` | `offerOf(100) == 1800e6` |

**Fuzz tier** (`--match-test testFuzz`):

| Test | Property |
|---|---|
| `testFuzz_Score_WithinBounds_ValidProfile` | valid random profile → score ∈ [0,100], each component ≤ its max |
| `testFuzz_Divert_Conservation` | random gross/shareBps/remaining → `toBacker ≤ remaining` ∧ sum == gross |
| `testFuzz_Offer_Monotonic` | s₁ ≤ s₂ → `offerOf(s₁) ≤ offerOf(s₂)` |

## Source obligations

- NatSpec `/// @notice` on the library and all four functions, each citing its PLAN
  section, with units in `@param` (D10 — user requirement).
- No imports in `KiteScoring.sol` (D1); test file imports forge-std `Test` only.
- `Counter.sol` / `Counter.t.sol` are deleted in the same feature (D9).
