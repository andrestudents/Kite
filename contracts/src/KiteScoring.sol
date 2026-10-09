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
}
