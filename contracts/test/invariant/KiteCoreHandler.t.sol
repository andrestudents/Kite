// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Kite — PLAN §6.4 ghost accounting (T022)
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {KiteCore} from "../../src/KiteCore.sol";
import {MockAUSD} from "../../src/MockAUSD.sol";
import {
    Terms,
    ISA,
    ISAModule,
    STATUS_ACTIVE,
    STATUS_DRAFTED,
    STATUS_COMPLETED_CAPPED,
    STATUS_COMPLETED_AT_TERM,
    STATUS_CANCELLED
} from "../../src/modules/ISA.sol";
import {Stream} from "../../src/modules/Stream.sol";
import {MaliciousAUSD} from "../KiteCore.t.sol";

/// @title KiteCoreHandler — randomized legal + adversarial actor (T022).
/// @notice Bounded actors (admin/relayer/orchestrator/pauser/3 seekers/3
///         backers/1 channel); every action is wrapped in try/catch and
///         MIRRORED into ghost accounting: cumulative AUSD in/out per side,
///         per-ISA snapshots (status, qualifying events, last-event clock,
///         draft-time bounds), the settled-fact set WITH signatures, score
///         latches, a paused mirror and a reentrancy mini-rig latch. The
///         twelve invariant_NN_* functions in KiteCoreInvariants assert
///         PLAN §6.4 against these mirrors.
/// @dev Money is integers in AUSD base units (constitution VI). RNG is a
///      self-mixed hash chain so runs are reproducible per Foundry seed.
contract KiteCoreHandler is Test {
    // ── Actors ──────────────────────────────────────────────────────────
    address public admin;
    address public relayer;
    address public orchestrator;
    address public pauser;
    address public mill;
    address[] public seekers;
    address[] public backers;
    mapping(address => uint256) public pkOf;

    // ── Deployment ──────────────────────────────────────────────────────
    MockAUSD public ausdToken;
    KiteCore public kiteContract;
    bytes32 public domain;

    bytes32 constant INCOME_TYPEHASH =
        0x993e60ac070df4ed64c120feb264b7cc10bb416da565d78bea5a775c29b665bb;
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    // ── Ghost mirrors (read by the invariants) ──────────────────────────
    uint256 public ghostPulled; // Σ gross pulled from the channel (#1)
    uint256 public ghostToBacker; // Σ paid to backers (#1)
    uint256 public ghostToSeeker; // Σ paid to seekers (#1)
    mapping(address => uint256) public ghostBal; // attributed balance (#12)
    address[] public tracked; // every address whose ledger must be explained
    mapping(uint256 => uint8) public ghostStatus; // per-ISA status mirror (#4)
    mapping(uint256 => uint256) public ghostQual; // qualifying-event mirror (#8)
    mapping(uint256 => uint64) public ghostLastEventAt; // clock mirror (#8)
    mapping(uint256 => uint64) public draftTs; // draft-time bounds (#6)
    mapping(uint256 => uint256) public maxPAtDraft; // score-bound mirror (#6)
    mapping(address => uint8) public scoreSnap; // score latch (#7)
    mapping(address => uint256) public completionsSnap; // completion latch (#7)
    address[] public boundWallets; // one-to-one mirror (#5)
    bytes32[] public boundHashes;
    uint256[] public isaIds;
    uint256[] public draftedIds;
    bool public pausedMirror;
    bool public reentryDone;

    // settled-fact set WITH the signature used (#2 re-attempts)
    uint256[] public settledId;
    bytes32[] public settledRef;
    uint256[] public settledGross;
    bytes32[] public settledSalt;
    uint8[] public settledV;
    bytes32[] public settledR;
    bytes32[] public settledS;

    // ── Violation counters — every one MUST stay 0 ──────────────────────
    uint256 public forgedSuccesses; // income without a recovering signature (#3)
    uint256 public terminalSuccesses; // income on a terminal ISA (#4)
    uint256 public replaySuccesses; // a settled fact paid twice (#2)
    uint256 public boundsViolations; // an out-of-bounds draft WRITTEN (#6)
    uint256 public pauseDraftSuccess; // draft while paused (#10)
    uint256 public pauseActivateSuccess; // activate while paused (#10)
    uint256 public scoreViolations; // score moved without completion (#7)
    uint256 public reentryViolations; // guard failed to block (#11)
    uint256 public flagStateChanges; // flagMismatch moved anything

    uint256 internal seed = 7;

    constructor() {
        admin = vm.addr(0xA1);
        relayer = vm.addr(0xA2);
        orchestrator = vm.addr(0xA3);
        pauser = vm.addr(0xA4);
        mill = vm.addr(0xC1);
        pkOf[mill] = 0xC1;
        for (uint256 i; i < 3; ++i) {
            seekers.push(vm.addr(0x51 + i));
            backers.push(vm.addr(0x61 + i));
            pkOf[vm.addr(0x51 + i)] = 0x51 + i;
            pkOf[vm.addr(0x61 + i)] = 0x61 + i;
        }

        ausdToken = new MockAUSD(address(this));
        KiteCore impl = new KiteCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(KiteCore.initialize, (admin, relayer, orchestrator, pauser, address(ausdToken)))
        );
        kiteContract = KiteCore(address(proxy));
        domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KiteCore"),
                keccak256("1"),
                block.chainid,
                address(kiteContract)
            )
        );

        // Verified humans + the channel.
        vm.startPrank(relayer);
        for (uint256 i; i < 3; ++i) {
            bytes32 sh = keccak256(abi.encode("seeker", i));
            bytes32 bh = keccak256(abi.encode("backer", i));
            kiteContract.bindIdentity(seekers[i], sh);
            kiteContract.bindIdentity(backers[i], bh);
            boundWallets.push(seekers[i]);
            boundHashes.push(sh);
            boundWallets.push(backers[i]);
            boundHashes.push(bh);
        }
        vm.stopPrank();
        vm.prank(admin);
        kiteContract.registerChannel(1, "Invariant Mill", mill);

        // Fund and approve the money sides (deal, not transfer: the fixture
        // needs more than INITIAL_SUPPLY in circulation).
        for (uint256 i; i < 3; ++i) {
            deal(address(ausdToken), backers[i], 500_000e6);
            vm.prank(backers[i]);
            ausdToken.approve(address(kiteContract), type(uint256).max);
        }
        deal(address(ausdToken), mill, 2_000_000e6);
        vm.prank(mill);
        ausdToken.approve(address(kiteContract), type(uint256).max);

        // Ghost ledgers begin exactly where reality begins.
        tracked.push(admin);
        tracked.push(relayer);
        tracked.push(orchestrator);
        tracked.push(pauser);
        tracked.push(address(this));
        tracked.push(mill);
        for (uint256 i; i < 3; ++i) {
            tracked.push(seekers[i]);
            tracked.push(backers[i]);
        }
        for (uint256 i; i < tracked.length; ++i) {
            ghostBal[tracked[i]] = ausdToken.balanceOf(tracked[i]);
        }
        for (uint256 i; i < 3; ++i) {
            _latchScore(seekers[i]);
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────
    function _r() internal returns (uint256) {
        seed = uint256(keccak256(abi.encode(seed, block.timestamp, gasleft())));
        return seed;
    }

    function _latchScore(address s) internal {
        scoreSnap[s] = kiteContract.scoreOf(s);
        completionsSnap[s] = kiteContract.profileOf(s).completed;
    }

    /// @dev The score must NEVER move unless a completion ran (#7).
    function _after() internal {
        for (uint256 i; i < seekers.length; ++i) {
            address s = seekers[i];
            uint8 cur = kiteContract.scoreOf(s);
            if (cur != scoreSnap[s] && kiteContract.profileOf(s).completed == completionsSnap[s]) {
                scoreViolations++;
            }
            _latchScore(s);
        }
    }

    function _pickWithStatus(uint8 wanted) internal view returns (uint256) {
        for (uint256 i; i < draftedIds.length; ++i) {
            if (ghostStatus[draftedIds[i]] == wanted) return draftedIds[i];
        }
        return 0;
    }

    function _signIncome(uint256 id, bytes32 ref, uint256 gross, bytes32 salt)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domain,
                keccak256(abi.encode(INCOME_TYPEHASH, uint64(1), id, ref, gross, salt))
            )
        );
        (v, r, s) = vm.sign(uint256(pkOf[mill]), digest);
    }

    // ── Actions ─────────────────────────────────────────────────────────

    /// Legal draft: all bounds satisfied by construction.
    function draftLegal() public {
        address s = seekers[_r() % seekers.length];
        address b = backers[_r() % backers.length];
        Terms memory t = Terms({
            principal: 1 + _r() % kiteContract.offerOf(s), // ≤ maxP (#6)
            shareBps: uint16(1000 + _r() % 1001), // [1000, 2000]
            capMult: uint16(120 + _r() % 31), // [120, 150]
            // [now+1s, now+730d] — 730 days is the §6.2 inclusive cap.
            termEnd: uint64(block.timestamp + 1 + _r() % 730 days),
            channelId: 1
        });
        if (kiteContract.paused()) {
            vm.prank(s);
            (bool ok,) = address(kiteContract).call(
                abi.encodeWithSelector(ISAModule.createISADraft.selector, t, b)
            );
            if (ok) pauseDraftSuccess++;
        } else {
            vm.prank(s); // the SEEKER drafts (bound identity) — without this
            // prank every legal draft reverts NotVerified (T023 finding)
            (bool ok, bytes memory ret) = address(kiteContract).call(
                abi.encodeWithSelector(ISAModule.createISADraft.selector, t, b)
            );
            if (ok) {
                uint256 id = abi.decode(ret, (uint256));
                ghostStatus[id] = STATUS_DRAFTED;
                draftTs[id] = uint64(block.timestamp);
                maxPAtDraft[id] = kiteContract.offerOf(s);
                isaIds.push(id);
                draftedIds.push(id);
            }
        }
        _after();
    }

    /// Adversarial draft: SOME §6.2 bound is violated — must ALWAYS revert.
    function draftAdversarial() public {
        address s = seekers[_r() % seekers.length];
        Terms memory t = Terms({
            principal: 1 + _r() % kiteContract.offerOf(s),
            shareBps: 2000,
            capMult: 150,
            termEnd: uint64(block.timestamp + 730 days),
            channelId: 1
        });
        uint256 mode = _r() % 5;
        if (mode == 0) t.shareBps = 999;
        else if (mode == 1) t.shareBps = 2001;
        else if (mode == 2) t.capMult = 151;
        else if (mode == 3) t.termEnd = uint64(block.timestamp + 731 days);
        else t.principal = kiteContract.offerOf(s) + 1;
        vm.prank(s);
        (bool ok,) = address(kiteContract).call(
            abi.encodeWithSelector(ISAModule.createISADraft.selector, t, backers[_r() % backers.length])
        );
        // NOT assertFalse here: fail_on_revert = false would swallow a
        // reverting assert inside the handler — count and let #6 look.
        if (ok) boundsViolations++;
        _after();
    }

    /// One-tx activation of a drafted deal (permit → pull → pay).
    function activateDrafted() public {
        uint256 id = _pickWithStatus(STATUS_DRAFTED);
        if (id == 0) return;
        ISA memory isa = kiteContract.isaOf(id);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                ausdToken.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        PERMIT_TYPEHASH,
                        isa.backer,
                        address(kiteContract),
                        isa.terms.principal,
                        ausdToken.nonces(isa.backer),
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pkOf[isa.backer], digest);
        (bool ok, ) = address(kiteContract).call(
            abi.encodeWithSelector(ISAModule.activateWithPermit.selector, id, deadline, v, r, s)
        );
        if (ok) {
            if (pausedMirror) pauseActivateSuccess++;
            ghostStatus[id] = STATUS_ACTIVE;
            ghostBal[isa.backer] -= isa.terms.principal;
            ghostBal[isa.seeker] += isa.terms.principal;
        } else if (pausedMirror) {
            // expected: pause blocks activation
        }
        _after();
    }

    /// Pre-activation cancel by a party.
    function cancelDrafted() public {
        uint256 id = _pickWithStatus(STATUS_DRAFTED);
        if (id == 0) return;
        ISA memory isa = kiteContract.isaOf(id);
        address by = _r() % 2 == 0 ? isa.seeker : isa.backer;
        vm.prank(by);
        (bool ok, ) = address(kiteContract).call(
            abi.encodeWithSelector(ISAModule.cancelDraft.selector, id)
        );
        if (ok) ghostStatus[id] = STATUS_CANCELLED;
        _after();
    }

    /// Legal settlement: valid channel signature; the ghost mirrors the
    /// §6.3 split and qualifying rule EXACTLY.
    function settleIncome() public {
        uint256 id = _pickWithStatus(STATUS_ACTIVE);
        if (id == 0) return;
        if (_r() % 2 == 0) vm.warp(block.timestamp + 1 days + _r() % 90 days);
        ISA memory isa = kiteContract.isaOf(id);
        uint256 gross = 1e6 + _r() % 2_000e6;
        bytes32 ref = keccak256(abi.encode("h-ref", id, settledId.length));
        bytes32 salt = bytes32(_r());
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, ref, gross, salt);
        // Expectations are computed INLINE, never by calling KiteScoring:
        // a ghost mirror computed by the code under test verifies nothing
        // (T023 finding). Formulas quoted from KiteScoring.sol / PLAN §6.3.
        uint256 sliceE = (gross * isa.terms.shareBps) / 10000;
        uint256 toBackerE = sliceE < isa.remaining ? sliceE : isa.remaining;
        uint256 toSeekerE = gross - toBackerE;
        bool qualE = (isa.lastEventAt == 0 || isa.lastEventAt + 60 days <= block.timestamp)
            && gross * 10000 >= isa.terms.principal * 1000;
        vm.prank(orchestrator); // receiveIncome is ORCHESTRATOR-only
        (bool ok, ) = address(kiteContract).call(
            abi.encodeWithSelector(
                Stream.receiveIncome.selector, id, ref, gross, salt, v, r, s
            )
        );
        if (ok) {
            ghostPulled += gross;
            ghostToBacker += toBackerE;
            ghostToSeeker += toSeekerE;
            ghostBal[mill] -= gross;
            ghostBal[isa.backer] += toBackerE;
            ghostBal[isa.seeker] += toSeekerE;
            if (qualE) {
                ghostQual[id]++;
                ghostLastEventAt[id] = uint64(block.timestamp);
            }
            ghostStatus[id] =
                kiteContract.isaOf(id).remaining == 0 ? STATUS_COMPLETED_CAPPED : STATUS_ACTIVE;
            settledId.push(id);
            settledRef.push(ref);
            settledGross.push(gross);
            settledSalt.push(salt);
            settledV.push(v);
            settledR.push(r);
            settledS.push(s);
        }
        _after();
    }

    /// Forged settlement: wrong signer — must NEVER succeed (#3).
    function settleForged() public {
        uint256 id = _pickWithStatus(STATUS_ACTIVE);
        if (id == 0) return;
        uint256 gross = 1e6 + _r() % 2_000e6;
        bytes32 ref = keccak256(abi.encode("f-org", id, settledId.length));
        bytes32 salt = bytes32(_r());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(uint256(pkOf[backers[_r() % backers.length]]), keccak256("forged"));
        (bool ok, ) = address(kiteContract).call(
            abi.encodeWithSelector(Stream.receiveIncome.selector, id, ref, gross, salt, v, r, s)
        );
        if (ok) forgedSuccesses++;
        _after();
    }

    /// Replay: resubmit a recorded fact verbatim — must NEVER succeed (#2).
    function settleReplay() public {
        if (settledId.length == 0) return;
        uint256 i = _r() % settledId.length;
        vm.prank(orchestrator); // reach the replay guard, not the role check
        (bool ok, ) = address(kiteContract).call(
            abi.encodeWithSelector(
                Stream.receiveIncome.selector,
                settledId[i],
                settledRef[i],
                settledGross[i],
                settledSalt[i],
                settledV[i],
                settledR[i],
                settledS[i]
            )
        );
        if (ok) {
            replaySuccesses++;
            if (ghostStatus[settledId[i]] >= STATUS_COMPLETED_CAPPED) terminalSuccesses++;
        }
        _after();
    }

    /// Warp past a live term and complete — the remainder is forgiven.
    function completeOverTerm() public {
        uint256 id = _pickWithStatus(STATUS_ACTIVE);
        if (id == 0) return;
        vm.warp(uint256(kiteContract.isaOf(id).terms.termEnd) + 1);
        (bool ok, ) = address(kiteContract).call(
            abi.encodeWithSignature("completeAtTerm(uint256)", id)
        );
        if (ok) ghostStatus[id] = STATUS_COMPLETED_AT_TERM;
        _after();
    }

    /// Reconciliation flag: emit ONLY — nothing may move.
    function flagMismatchOnly() public {
        uint256 balBefore;
        for (uint256 i; i < tracked.length; ++i) balBefore += ausdToken.balanceOf(tracked[i]);
        vm.prank(orchestrator);
        kiteContract.flagMismatch(_r(), _r(), _r());
        uint256 balAfter;
        for (uint256 i; i < tracked.length; ++i) balAfter += ausdToken.balanceOf(tracked[i]);
        if (balAfter != balBefore) flagStateChanges++;
        _after();
    }

    /// PAUSER's asymmetric cycle.
    function pauseFlip() public {
        bool wasPaused = kiteContract.paused(); // read BEFORE the prank: a
        // staticcall between vm.prank and the call consumes the prank.
        vm.prank(pauser);
        if (wasPaused) {
            kiteContract.unpause();
            pausedMirror = false;
        } else {
            kiteContract.pause();
            pausedMirror = true;
        }
        _after();
    }

    /// RELAYER attests more humans (bounded).
    function bindMore() public {
        if (boundWallets.length >= 14) return;
        address w = vm.addr(0x90 + boundWallets.length);
        bytes32 h = keccak256(abi.encode("extra", boundWallets.length));
        vm.prank(relayer);
        (bool ok, ) = address(kiteContract).call(
            abi.encodeWithSelector(bytes4(keccak256("bindIdentity(address,bytes32)")), w, h)
        );
        if (ok) {
            boundWallets.push(w);
            boundHashes.push(h);
        }
        _after();
    }

    /// Pure time travel — terms expire organically.
    function warpOnly() public {
        vm.warp(block.timestamp + 1 days + _r() % 120 days);
        _after();
    }

    /// The D13 attacker rail, ONCE per run: every re-entry must be blocked.
    function reentryProbe() public {
        if (reentryDone) return;
        reentryDone = true;
        MaliciousAUSD tok = new MaliciousAUSD();
        KiteCore impl = new KiteCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(KiteCore.initialize, (admin, relayer, orchestrator, pauser, address(tok)))
        );
        KiteCore rig = KiteCore(address(proxy));
        tok.aim(address(rig));
        address s = seekers[0];
        address b = backers[1];
        vm.startPrank(relayer);
        rig.bindIdentity(s, keccak256("rig-s"));
        rig.bindIdentity(b, keccak256("rig-b"));
        vm.stopPrank();
        vm.prank(admin);
        rig.registerChannel(2, "Rig Channel", mill);
        Terms memory t = Terms({
            principal: 600e6,
            shareBps: 2000,
            capMult: 120,
            termEnd: uint64(block.timestamp + 30 days),
            channelId: 2
        });
        vm.prank(s);
        uint256 id = rig.createISADraft(t, b);
        tok.deal(b, 600e6);
        vm.prank(b);
        tok.approve(address(rig), type(uint256).max);

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                tok.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(PERMIT_TYPEHASH, b, address(rig), 600e6, tok.nonces(b), deadline)
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 sig) = vm.sign(uint256(pkOf[b]), digest);
        tok.arm(true, abi.encodeWithSelector(ISAModule.activateWithPermit.selector, id, deadline, v, r, sig));
        rig.activateWithPermit(id, deadline, v, r, sig);
        if (tok.attempts() == 0 || tok.blocked() != tok.attempts()) reentryViolations++;
        _after();
    }

    // ── Read helpers for the invariant assertions ───────────────────────
    function isaCount() external view returns (uint256) {
        return isaIds.length;
    }

    function isaAt(uint256 i) external view returns (uint256) {
        return isaIds[i];
    }

    function settledCount() external view returns (uint256) {
        return settledId.length;
    }

    function boundCount() external view returns (uint256) {
        return boundWallets.length;
    }

    function seekerCount() external view returns (uint256) {
        return seekers.length;
    }

    function seekerAt(uint256 i) external view returns (address) {
        return seekers[i];
    }

    function trackedCount() external view returns (uint256) {
        return tracked.length;
    }

    function trackedAt(uint256 i) external view returns (address) {
        return tracked[i];
    }

    function isaView(uint256 id) external view returns (ISA memory) {
        return kiteContract.isaOf(id);
    }

    function ausdBalance(address a) external view returns (uint256) {
        return ausdToken.balanceOf(a);
    }
}
