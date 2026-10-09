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

    // ────────────────────────────────────────────────────────────────────
    // Qualifying tier — isQualifyingEvent: §6.3 bars, boundaries inclusive.
    // Fixed reference `now` (1,000,000,000) with day offsets; the demo ISA
    // (P 600e6) sizes every gross at exactly 10% so each test isolates one bar.
    // ────────────────────────────────────────────────────────────────────

    uint256 private constant NOW = 1_000_000_000;
    uint256 private constant P600 = 600e6;
    uint256 private constant TEN_PCT = 60e6; // exactly 10% of P600

    function testBoundary_Qualifying_Gap59Days_False() public pure {
        // 59 days after the previous qualifying event → below the 60-day bar
        assertFalse(KiteScoring.isQualifyingEvent(NOW, NOW + 59 days, TEN_PCT, P600));
    }

    function testBoundary_Qualifying_Gap60Days_True() public pure {
        // Exactly 60 days → the bar is "≥", inclusive
        assertTrue(KiteScoring.isQualifyingEvent(NOW, NOW + 60 days, TEN_PCT, P600));
    }

    function testBoundary_Qualifying_GrossBelow10Pct_False() public pure {
        // Long gap but gross 1 base unit under 10% of principal → size bar fails
        assertFalse(KiteScoring.isQualifyingEvent(NOW, NOW + 61 days, TEN_PCT - 1, P600));
    }

    function testBoundary_Qualifying_GrossExactly10Pct_True() public pure {
        // Exactly 10% of principal → qualifies (MIN_EVENT_BPS inclusive)
        assertTrue(KiteScoring.isQualifyingEvent(NOW, NOW + 61 days, TEN_PCT, P600));
    }

    function testBoundary_Qualifying_FirstEvent_Qualifies() public pure {
        // lastEventAt = 0 = no previous qualifying event → gap bar passes by definition
        assertTrue(KiteScoring.isQualifyingEvent(0, NOW, TEN_PCT, P600));
    }

    function testBoundary_Qualifying_ClockInversion_False() public pure {
        // lastEventAt later than `now` → false, and never a revert (research.md D6)
        assertFalse(KiteScoring.isQualifyingEvent(NOW, NOW - 1, TEN_PCT, P600));
    }

    // ────────────────────────────────────────────────────────────────────
    // Saturation / maximum — §6.3 component caps and the score-100 offer
    // ────────────────────────────────────────────────────────────────────

    function testBoundary_Score_Saturation_Consistency12_Volume6() public pure {
        // Components saturate: Consistency caps at 12 events (20 pts), Volume at 6 (40 pts)
        assertEq(_consistency(12), 20);
        assertEq(_volume(6), 40);
        // {1,1,12,2}: H ⌊40/3⌋=13 · C 20 · V 40 → 73
        assertEq(uint256(KiteScoring.score(_profile(1, 1, 12, 2))), 73);
        // Beyond the caps nothing changes: {1,1,20,2} → still 73
        assertEq(uint256(KiteScoring.score(_profile(1, 1, 20, 2))), 73);
    }

    function testBoundary_Offer_Score100_1800() public pure {
        // Score 100 → 600 × 300% = 1800 (§6.3 offer formula ceiling)
        assertEq(KiteScoring.offerOf(100), 1800e6);
    }

    // ────────────────────────────────────────────────────────────────────
    // Fuzz tier — stateless properties (research.md D8)
    // ────────────────────────────────────────────────────────────────────

    /// @dev Ledger-valid profiles only: completed ≤ totalISAs (spec assumption).
    ///      Asserts per-component maxima (40/20/40), score ∈ [0,100], and that
    ///      the library equals the sum of the hand-transcribed components.
    function testFuzz_Score_WithinBounds_ValidProfile(
        uint64 totalISAs,
        uint64 completed,
        uint64 qualEvents,
        uint64 distinctBackers
    ) public pure {
        totalISAs = uint64(bound(uint256(totalISAs), 0, 1000));
        completed = uint64(bound(uint256(completed), 0, totalISAs));
        qualEvents = uint64(bound(uint256(qualEvents), 0, 1000));
        distinctBackers = uint64(bound(uint256(distinctBackers), 0, 1000));

        uint256 h = _history(totalISAs, completed, distinctBackers);
        uint256 c = _consistency(qualEvents);
        uint256 v = _volume(qualEvents);
        assertLe(h, 40);
        assertLe(c, 20);
        assertLe(v, 40);

        uint256 s = uint256(KiteScoring.score(_profile(totalISAs, completed, qualEvents, distinctBackers)));
        assertEq(s, h + c + v);
        assertLe(s, 100);
    }

    /// @dev Monotonic non-decreasing in score (§6.3 offer formula).
    function testFuzz_Offer_Monotonic(uint8 s1, uint8 s2) public view {
        vm.assume(s1 <= s2);
        assertLe(KiteScoring.offerOf(s1), KiteScoring.offerOf(s2));
    }
}
