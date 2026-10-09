// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title KiteScoring
/// @notice Pure integer maths for Kite: reputation score, support offer,
///         atomic income split, and the qualifying-event gate.
///         PLAN §6.1: "Score + offer, pure and hand-checkable" — no storage,
///         no proxy, no external calls; every PLAN §6.3 demo number is a
///         literal acceptance test (constitution IX).
///         Money is integers in AUSD base units (6 decimals) everywhere;
///         floats never appear (constitution VI).
/// @dev Internal pure library — inlined at compile time into the future
///      KiteCore modules (research.md D2). Formulas are quoted verbatim from
///      PLAN §6.3; the PLAN is frozen, so any "nicer" rounding is a deviation
///      (CLAUDE.md: never deviate silently).
library KiteScoring {
    /// @notice Seeker reputation counters, field-for-field from PLAN §6.2.
    /// @custom:invariant completed ≤ totalISAs holds upstream in the ledger
    ///                   layer; this library trusts it and does not re-validate
    ///                   (spec assumption).
    struct Profile {
        uint64 totalISAs; // PLAN §6.2 — deals ever activated for this seeker
        uint64 completed; // PLAN §6.2 — deals finished (capped or term-forgiven)
        uint64 qualEvents; // PLAN §6.2 — lifetime qualifying income events (§6.3)
        uint64 distinctBackers; // PLAN §6.2 — backers with ≥ 1 completed deal
    }

    /// @notice Base maximum support at score 0: 600 AUSD.
    ///         PLAN §6.2 testnet parameter BASE_MAX_P (AUSD base units, 6 dp).
    uint256 internal constant BASE_MAX_P = 600e6;

    /// @notice Minimum gap between qualifying events: 60 days = 5,184,000 s.
    ///         PLAN §6.2 testnet parameter MIN_EVENT_GAP.
    uint256 internal constant MIN_EVENT_GAP = 60 days;

    /// @notice Minimum event size vs principal, in basis points: 1000 = 10%.
    ///         PLAN §6.2 testnet parameter MIN_EVENT_BPS.
    uint256 internal constant MIN_EVENT_BPS = 1000;

    /// @notice Reputation score 0–100 = History (40) + Consistency (20) + Volume (40),
    ///         integer floor per component (PLAN §6.3).
    /// @param p Seeker counters (§6.2); the ledger layer guarantees
    ///          completed ≤ totalISAs — out-of-contract inputs yield
    ///          out-of-contract results by design (no defensive clamp).
    /// @return Score in [0,100] for ledger-valid inputs; changes only on completion.
    /// @dev History = 40 × completed × min(totalISAs,3) / (totalISAs × 3), defined
    ///      as 0 when totalISAs = 0, then capped at 13 when distinctBackers < 2
    ///      — one backer can never fund a full record (§6.3, kills self-dealing).
    ///      Consistency = 20 × min(qualEvents,12) / 12.
    ///      Volume = 40 × min(qualEvents,6) / 6.
    function score(Profile memory p) internal pure returns (uint8) {
        uint256 history;
        if (p.totalISAs > 0) {
            uint256 t = uint256(p.totalISAs);
            history = (40 * uint256(p.completed) * (t < 3 ? t : 3)) / (t * 3); // PLAN §6.3
            if (p.distinctBackers < 2 && history > 13) history = 13; // §6.3 anti-self-dealing cap
        }
        uint256 q = uint256(p.qualEvents);
        uint256 consistency = (20 * (q < 12 ? q : 12)) / 12; // PLAN §6.3
        uint256 volume = (40 * (q < 6 ? q : 6)) / 6; // PLAN §6.3
        return uint8(history + consistency + volume); // ≤ 100 for valid inputs (≤ 255 always fits)
    }

    /// @notice Maximum supportable principal for a score (PLAN §6.3):
    ///         maxP = BASE_MAX_P × (100 + 2 × score) / 100.
    /// @param score_ Result of score(); intended range 0–100.
    /// @return maxP in AUSD base units: 600e6 (score 0) … 1800e6 (score 100).
    ///         Division is always exact (BASE_MAX_P is a multiple of 100).
    function offerOf(uint8 score_) internal pure returns (uint256 maxP) {
        maxP = (BASE_MAX_P * (100 + 2 * uint256(score_))) / 100; // PLAN §6.3
    }

    /// @notice Atomic split of one income event (PLAN §6.2 `receiveIncome` rule):
    ///         toBacker = min(gross × shareBps / 10000, remaining); toSeeker = gross − toBacker.
    /// @param gross Total income received, AUSD base units (6 dp).
    /// @param shareBps Backer share in basis points (2000 = 20%); deal bounds
    ///                 [1000, 2000] are enforced upstream at deal creation (PLAN D6).
    /// @param remaining AUSD left of the cap (cap = principal × capMult / 100, §6.2).
    /// @return toBacker Never exceeds `remaining` (the cap) — §6.4 invariant.
    /// @return toSeeker gross − toBacker; conservation is exact:
    ///                  toBacker + toSeeker == gross (§6.4 #1). Cannot underflow:
    ///                  for shareBps ≤ 10000 both min-branches are ≤ gross.
    /// @dev Cap reached exactly when slice == remaining → upstream marks
    ///      CompletedCapped (§6.2). A failed harvest (gross = 0) diverts zero (PLAN D8).
    function divert(uint256 gross, uint256 shareBps, uint256 remaining)
        internal
        pure
        returns (uint256 toBacker, uint256 toSeeker)
    {
        uint256 slice = (gross * shareBps) / 10000; // PLAN §6.2; integer floor, no floats
        toBacker = slice < remaining ? slice : remaining;
        toSeeker = gross - toBacker;
    }
}
