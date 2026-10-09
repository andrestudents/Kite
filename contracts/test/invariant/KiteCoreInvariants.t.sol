// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Kite — PLAN §6.4 invariants (T022, api.md rows 1–12)
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {KiteCore} from "../../src/KiteCore.sol";
import {MockAUSD} from "../../src/MockAUSD.sol";
import {ISA} from "../../src/modules/ISA.sol";
import {Stream} from "../../src/modules/Stream.sol";
import {KiteCoreHandler} from "./KiteCoreHandler.t.sol";

/// @title KiteCoreInvariants — PLAN §6.4 as twelve Foundry invariants (T022).
/// @notice One per row of specs/003-kitecore-mockausd/contracts/kitecore-api.md:
///          1 split conservation, 2 event-fact single use, 3 signature gate,
///          4 terminal means terminal, 5 identity one-to-one, 6 term bounds,
///          7 score immutability between completions, 8 qualifying-event
///          credit, 9 the contract never holds money, 10 asymmetric pause,
///          11 reentrancy resistance, 12 role-confined fund movements.
/// @dev The handler holds the ghost mirrors; these assertions read only.
contract KiteCoreInvariants is StdInvariant, Test {
    KiteCoreHandler internal handler;
    KiteCore internal kite;
    MockAUSD internal ausd;

    function setUp() public {
        handler = new KiteCoreHandler();
        kite = KiteCore(address(handler.kiteContract()));
        ausd = MockAUSD(address(handler.ausdToken()));
        targetContract(address(handler));
    }

    // ── #1 SplitConservation: pulled == backer + seeker, exactly ────────
    function invariant_01_SplitConservation_CumulativeExact() public view {
        assertEq(
            handler.ghostPulled(),
            handler.ghostToBacker() + handler.ghostToSeeker(),
            "pulled income != backer+seeker legs (no dust, no skimming)"
        );
    }

    // ── #2 EventFacts are single-use: recorded sigs re-pays nothing ─────
    function invariant_02_EventFacts_SingleUse() public {
        assertEq(handler.replaySuccesses(), 0, "a recorded fact paid TWICE");
        for (uint256 i; i < handler.settledCount(); ++i) {
            vm.prank(handler.orchestrator());
            (bool ok, ) = address(kite).call(
                abi.encodeWithSelector(
                    Stream.receiveIncome.selector,
                    handler.settledId(i),
                    handler.settledRef(i),
                    handler.settledGross(i),
                    handler.settledSalt(i),
                    handler.settledV(i),
                    handler.settledR(i),
                    handler.settledS(i)
                )
            );
            assertFalse(ok, "settled fact replayed through receiveIncome");
        }
    }

    // ── #3 Income requires a valid channel signature ────────────────────
    function invariant_03_Income_RequiresValidChannelSignature() public view {
        assertEq(handler.forgedSuccesses(), 0, "forged-signature settlement SUCCEEDED");
    }

    // ── #4 Terminal ISAs never take income again (and never resurrect) ──
    function invariant_04_NoIncome_OnTerminalISA() public view {
        assertEq(handler.terminalSuccesses(), 0, "income succeeded on a TERMINAL ISA");
        for (uint256 i; i < handler.isaCount(); ++i) {
            uint256 id = handler.isaAt(i);
            ISA memory isa = handler.isaView(id);
            assertEq(
                uint8(isa.status),
                handler.ghostStatus(id),
                "ISA status diverged from the ghost mirror (resurrection?)"
            );
        }
    }

    // ── #5 identityHash <-> wallet one-to-one, both directions ──────────
    function invariant_05_Identity_OneToOneBothWays() public view {
        for (uint256 i; i < handler.boundCount(); ++i) {
            address w = handler.boundWallets(i);
            bytes32 h = handler.boundHashes(i);
            assertEq(kite.identityOf(w), h, "wallet lost its identityHash");
            assertEq(kite.walletOfIdentity(h), w, "identityHash lost its wallet");
        }
    }

    // ── #6 Every stored deal stays within the §6.2 bounds ───────────────
    function invariant_06_Terms_WithinBounds() public view {
        assertEq(handler.boundsViolations(), 0, "an out-of-bounds draft was WRITTEN");
        for (uint256 i; i < handler.isaCount(); ++i) {
            uint256 id = handler.isaAt(i);
            ISA memory isa = handler.isaView(id);
            assertGe(isa.terms.shareBps, 1000, "shareBps below 10%");
            assertLe(isa.terms.shareBps, 2000, "shareBps above 20%");
            assertGe(isa.terms.capMult, 120, "capMult below 1.2x");
            assertLe(isa.terms.capMult, 150, "capMult above 1.5x");
            assertLe(uint256(isa.terms.termEnd), handler.draftTs(id) + 730 days, "term beyond 730d");
            assertLe(isa.terms.principal, handler.maxPAtDraft(id), "principal above score offer");
        }
    }

    // ── #7 Score stays 0..100 and only moves on a completion ────────────
    function invariant_07_Score_Within0_100_ChangesOnlyOnCompletion() public view {
        assertEq(handler.scoreViolations(), 0, "score moved without a completion");
        for (uint256 i; i < handler.seekerCount(); ++i) {
            assertLe(kite.scoreOf(handler.seekerAt(i)), 100, "score above 100");
        }
    }

    // ── #8 Sub-threshold events add NO qualifying credit ────────────────
    function invariant_08_SubBarEvents_AddNoQualCredit() public view {
        for (uint256 i; i < handler.isaCount(); ++i) {
            uint256 id = handler.isaAt(i);
            assertEq(
                uint256(handler.isaView(id).eventCount),
                handler.ghostQual(id),
                "qualifying-event count diverged from the ghost mirror"
            );
        }
    }

    // ── #9 Escrow conservation: the contract NEVER holds money ──────────
    function invariant_09_EscrowConservation_ContractHoldsNothing() public view {
        assertEq(ausd.balanceOf(address(kite)), 0, "KiteCore is holding user money");
    }

    // ── #10 Pause blocks new risk only (never income/completion) ────────
    function invariant_10_PauseAsymmetric_BlocksNewRisk_Only() public view {
        assertEq(kite.paused(), handler.pausedMirror(), "pause state diverged from the mirror");
        assertEq(handler.pauseDraftSuccess(), 0, "draft SUCCEEDED while paused");
        assertEq(handler.pauseActivateSuccess(), 0, "activation SUCCEEDED while paused");
    }

    // ── #11 Reentrancy is resisted on both money entry points ───────────
    function invariant_11_Reentrancy_Resisted() public view {
        assertEq(handler.reentryViolations(), 0, "a re-entering call was NOT blocked");
    }

    // ── #12 Roles move funds ONLY along §6.2 attribution legs ───────────
    function invariant_12_Roles_ConfinedToPlanFunctions() public view {
        for (uint256 i; i < handler.trackedCount(); ++i) {
            address a = handler.trackedAt(i);
            assertEq(
                ausd.balanceOf(a),
                handler.ghostBal(a),
                "unexplained AUSD movement outside the 6.2 legs"
            );
        }
    }
}
