// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {KiteScoring} from "../src/KiteScoring.sol";

/// @notice Acceptance suite for KiteScoring — PLAN §6.3 literal tables as
///         literal numbers (constitution IX), §6.2/§6.3 boundaries, and
///         stateless property fuzzing (research.md D8).
/// @dev Test names are contractual: specs/002-kite-scoring-math/contracts/kite-scoring-api.md.
///      All money literals are AUSD base units (6 dp) — constitution VI.
contract KiteScoringTest is Test {
    // ────────────────────────────────────────────────────────────────────
    // §6.3 component helpers — hand-transcribed from PLAN §6.3 for
    // per-component diagnostics only. The PLAN literals asserted below are
    // the independent anchors: if library and helpers agree but differ
    // from the literals, the literals win and the code is wrong.
    // ────────────────────────────────────────────────────────────────────

    function _history(uint64 totalISAs, uint64 completed, uint64 distinctBackers)
        internal
        pure
        returns (uint256 h)
    {
        if (totalISAs == 0) return 0;
        h = (40 * uint256(completed) * (totalISAs < 3 ? uint256(totalISAs) : 3))
            / (uint256(totalISAs) * 3);
        if (distinctBackers < 2 && h > 13) h = 13; // one backer never funds a full record (§6.3)
    }

    function _consistency(uint64 qualEvents) internal pure returns (uint256) {
        return (20 * (qualEvents < 12 ? uint256(qualEvents) : 12)) / 12;
    }

    function _volume(uint64 qualEvents) internal pure returns (uint256) {
        return (40 * (qualEvents < 6 ? uint256(qualEvents) : 6)) / 6;
    }

    function _profile(uint64 totalISAs, uint64 completed, uint64 qualEvents, uint64 distinctBackers)
        internal
        pure
        returns (KiteScoring.Profile memory)
    {
        return KiteScoring.Profile(totalISAs, completed, qualEvents, distinctBackers);
    }

    // ────────────────────────────────────────────────────────────────────
    // Literal tier — the PLAN §6.3 demo tables as literal numbers
    // ────────────────────────────────────────────────────────────────────

    function testLiteral_Score_NewAccount_0_Offer600() public pure {
        // §6.3 row "New account": empty record → score 0, maxP 600
        assertEq(uint256(KiteScoring.score(_profile(0, 0, 0, 0))), 0);
        assertEq(KiteScoring.offerOf(0), 600e6);
    }

    function testLiteral_Score_BudiPrepared_58_Offer1296() public pure {
        // §6.3 row "Budi, prepared (2 ISAs done)": {2,2,4,2} → H 26 · C 6 · V 26 → 58 → maxP 1,296
        assertEq(_history(2, 2, 2), 26);
        assertEq(_consistency(4), 6);
        assertEq(_volume(4), 26);
        assertEq(uint256(KiteScoring.score(_profile(2, 2, 4, 2))), 58);
        assertEq(KiteScoring.offerOf(58), 1296e6);
    }

    function testLiteral_Score_AfterDemo_91_Offer1692() public pure {
        // §6.3 row "After the demo ISA completes": {3,3,7,3} → H 40 · C 11 · V 40 → 91 → maxP 1,692
        assertEq(_history(3, 3, 3), 40);
        assertEq(_consistency(7), 11);
        assertEq(_volume(7), 40);
        assertEq(uint256(KiteScoring.score(_profile(3, 3, 7, 3))), 91);
        assertEq(KiteScoring.offerOf(91), 1692e6);
    }

    function testLiteral_Score_SingleBacker_HistoryCap13_Score64() public pure {
        // Same record, one backer → History capped at 13 (§6.3 anti-self-dealing): 13+11+40 = 64
        assertEq(uint256(KiteScoring.score(_profile(3, 3, 7, 1))), 64);
    }

    // ────────────────────────────────────────────────────────────────────
    // Split tier — divert: PLAN §6.3 demo ISA table + §6.4 conservation
    // ────────────────────────────────────────────────────────────────────

    function testLiteral_Divert_Panen1_300_1200() public pure {
        // §6.3 Panen 1: gross 1,500, share 20%, remaining 780 → 300 to backer, 1,200 to seeker
        (uint256 toBacker, uint256 toSeeker) = KiteScoring.divert(1500e6, 2000, 780e6);
        assertEq(toBacker, 300e6);
        assertEq(toSeeker, 1200e6);
    }

    function testLiteral_Divert_Panen3_CapReached_180_1320() public pure {
        // §6.3 Panen 3: remaining 180 → divert 180 (cap reached), seeker 1,320 → CompletedCapped
        (uint256 toBacker, uint256 toSeeker) = KiteScoring.divert(1500e6, 2000, 180e6);
        assertEq(toBacker, 180e6);
        assertEq(toSeeker, 1320e6);
    }

    function testBoundary_Divert_CapReachedExactly() public pure {
        // Slice == remaining: the cap is reached exactly, never exceeded
        (uint256 toBacker, uint256 toSeeker) = KiteScoring.divert(1500e6, 2000, 300e6);
        assertEq(toBacker, 300e6);
        assertEq(toSeeker, 1200e6);
    }

    function testBoundary_Divert_ZeroGross_0_0() public pure {
        // Failed harvest: nothing is diverted, nothing is taken (PLAN D8)
        (uint256 toBacker, uint256 toSeeker) = KiteScoring.divert(0, 2000, 780e6);
        assertEq(toBacker, 0);
        assertEq(toSeeker, 0);
    }

    function testBoundary_Divert_ZeroRemaining_AllToSeeker() public pure {
        // Cap exhausted: backer gets 0, seeker keeps the whole gross
        (uint256 toBacker, uint256 toSeeker) = KiteScoring.divert(1500e6, 2000, 0);
        assertEq(toBacker, 0);
        assertEq(toSeeker, 1500e6);
    }

    /// @dev shareBps bounded to [0,10000]: the documented no-revert domain
    ///      (share ≤ 100%; real deals are 1000–2000). gross bounded so
    ///      gross × shareBps cannot overflow (§6.4 #1 properties for all
    ///      inputs in this domain).
    function testFuzz_Divert_Conservation(uint256 gross, uint256 shareBps, uint256 remaining) public pure {
        gross = bound(gross, 0, 2 ** 200);
        shareBps = bound(shareBps, 0, 10000);
        (uint256 toBacker, uint256 toSeeker) = KiteScoring.divert(gross, shareBps, remaining);
        assertLe(toBacker, remaining); // diverted ≤ remaining, always (§6.4 #1)
        assertLe(toBacker, gross);
        assertEq(toBacker + toSeeker, gross); // conservation, exactly
    }
}
