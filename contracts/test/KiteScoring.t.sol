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
}
