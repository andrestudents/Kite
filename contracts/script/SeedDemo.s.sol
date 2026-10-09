// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {KiteCore} from "../src/KiteCore.sol";
import {KiteScoring} from "../src/KiteScoring.sol";
import {ISA, Terms, STATUS_NONE, STATUS_DRAFTED, STATUS_ACTIVE, STATUS_COMPLETED_CAPPED} from "../src/modules/ISA.sol";
import {console2} from "forge-std/console2.sol";
import {KiteScriptCommon} from "./KiteScriptCommon.s.sol";

/// @title SeedDemo — the FR-009 demo ledger, built ONLY via the public 003 API.
/// @notice Five stages, ONE qualifying income event per stage (the per-event
///         gap rule: qualifying status is decided per event, so E2–E5 each
///         needs its own wait — `contracts/script/seed-demo.sh` owns that
///         timing; this script never sleeps, research D5). Run stages IN
///         ORDER; every stage re-derives its world from chain reads and skips
///         steps that already happened (idempotent re-runs, spec edge case).
///         Stage 5 ends in the full FR-008/FR-012 assert block + persona
///         manifest. No admin state writes — constitution IV.
/// @dev Signatures: activation permits over the ASSET's domain (read live via
///      DOMAIN_SEPARATOR()); income facts over KiteCore's EIP-712 domain
///      ("KiteCore","1") — the proxy exposes no DOMAIN_SEPARATOR(), so it is
///      derived exactly as KiteCore.t.sol does. Keys come from env only; the
///      script never logs one (FR-005).
///
/// Seed ledger (AUSD base units — constitution VI):
///   ISA-1 Budi→Siti   P 300e6 · 2000 bps · 130× (cap 390e6): E1 1500e6 →
///     divert 300e6, remaining 90e6; E2 450e6 → divert 90e6 → CompletedCapped
///     → profile {1,1,2,1} · score 29 · maxP 948e6
///   ISA-2 Budi→Wati   P 600e6 (≤948) · cap 780e6: E3 1500e6 → 300e6;
///     E4 2400e6 → 480e6 → CompletedCapped → {2,2,4,2} · score 58 · maxP 1296e6
///   ISA-3 Budi→PakHaji P 600e6 · cap 780e6 (the demo ISA): E5 1500e6 →
///     remaining 480e6 · score stays 58 while Active
contract SeedDemo is KiteScriptCommon {
    // ── Stage selector (env SEED_STAGE 1..5; the driver sets it) ─────────
    error BadStage(uint256 stage);

    // ── FR-012 assert abort (stage 5) ───────────────────────────────────
    error SeedAssert(string what, uint256 expected, uint256 observed);

    // ── Signing typehashes (must byte-match the modules) ─────────────────
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 internal constant INCOME_TYPEHASH =
        keccak256("IncomeEvent(uint64 channelId,uint256 isaId,bytes32 purchaseRef,uint256 gross,bytes32 salt)");

    // ── Channel (matches DeployKiteCore / addresses.ts) ──────────────────
    uint64 internal constant CHANNEL_ID = 1;

    // ── FR-009 literals (AUSD base units) ────────────────────────────────
    uint256 internal constant ISA1_P = 300e6;
    uint16 internal constant ISA1_BPS = 2000;
    uint16 internal constant ISA1_CAPMULT = 130; // cap 390e6
    uint256 internal constant E1_GROSS = 1500e6;
    uint256 internal constant E2_GROSS = 450e6;
    uint256 internal constant ISA2_P = 600e6; // ≤ offerOf(29) = 948e6
    uint16 internal constant ISA2_BPS = 2000;
    uint16 internal constant ISA2_CAPMULT = 130; // cap 780e6
    uint256 internal constant E3_GROSS = 1500e6;
    uint256 internal constant E4_GROSS = 2400e6;
    uint256 internal constant ISA3_P = 600e6; // ≤ offerOf(58) = 1296e6
    uint16 internal constant ISA3_BPS = 2000;
    uint16 internal constant ISA3_CAPMULT = 130; // cap 780e6
    uint256 internal constant E5_GROSS = 1500e6;
    uint256 internal constant EXPECTED_SCORE = 58;
    uint256 internal constant EXPECTED_REMAINING_3 = 480e6; // 780 − 300 (E5)
    // Stage-5 balance floors (funding minus what the ledger spends, headroom
    // left for the manual-loop finale gross).
    uint256 internal constant MILL_FUND = 10_000e6; // grosses 7,350e6 + finale headroom
    uint256 internal constant PERSONA_FUND = 1_000e6; // each backer pays their principal
    uint256 internal constant EXPECTED_MILL_FLOOR = 2_650e6; // 10_000 − 7_350
    uint256 internal constant EXPECTED_PAKHAJI_FLOOR = 400e6; // 1_000 − 600

    /// @dev One memory struct — every helper takes it; keeps the stack shallow.
    struct Ctx {
        KiteCore kite;
        address asset; // read from the contract, never from env
        uint256 deployerKey;
        uint256 relayerKey;
        uint256 orchestratorKey;
        uint256 budiKey;
        uint256 sitiKey;
        uint256 watiKey;
        uint256 pakhajiKey;
        uint256 millKey;
        address deployer;
        address relayer;
        address orchestrator;
        address budi;
        address siti;
        address wati;
        address pakhaji;
        address mill;
        uint256 demoGap; // assert-only (the driver owns timing)
    }

    function run() external {
        _chainGuard();
        Ctx memory c = _ctx();
        uint256 stage = _uintOr("SEED_STAGE", 1);
        if (stage == 1) _stage1(c);
        else if (stage == 2) _stage2(c);
        else if (stage == 3) _stage3(c);
        else if (stage == 4) _stage4(c);
        else if (stage == 5) _stage5(c);
        else revert BadStage(stage);
    }

    // ── Context (keys via env only; addresses derived, never logged) ────
    function _ctx() private view returns (Ctx memory c) {
        c.deployerKey = vm.parseUint(_req("DEPLOYER_KEY"));
        c.relayerKey = vm.parseUint(_req("RELAYER_KEY"));
        c.orchestratorKey = vm.parseUint(_req("ORCHESTRATOR_KEY"));
        c.budiKey = vm.parseUint(_req("BUDI_KEY"));
        c.sitiKey = vm.parseUint(_req("SITI_KEY"));
        c.watiKey = vm.parseUint(_req("WATI_KEY"));
        c.pakhajiKey = vm.parseUint(_req("PAKHAJI_KEY"));
        c.millKey = vm.parseUint(_req("MILL_KEY"));
        c.deployer = vm.addr(c.deployerKey);
        c.relayer = vm.addr(c.relayerKey);
        c.orchestrator = vm.addr(c.orchestratorKey);
        c.budi = vm.addr(c.budiKey);
        c.siti = vm.addr(c.sitiKey);
        c.wati = vm.addr(c.watiKey);
        c.pakhaji = vm.addr(c.pakhajiKey);
        c.mill = vm.addr(c.millKey);
        c.kite = KiteCore(payable(vm.parseAddress(_req("KITE_CORE_ADDRESS"))));
        c.asset = c.kite.ausd(); // chain read — the contract is the authority
        c.demoGap = _uintOr("DEMO_GAP_SECONDS", 60);
        if (c.demoGap == 0) revert ZeroGap();
    }

    // ═══ Stage 1: fund + bind + ISA-1 (draft/activate) + E1 ═════════════
    function _stage1(Ctx memory c) private {
        _fund(c);
        _bindAll(c);
        _draftIfNone(c, 1, ISA1_P, ISA1_BPS, ISA1_CAPMULT, c.siti);
        _activateIfDrafted(c, 1, c.sitiKey, c.siti);
        _settleIfNext(c, 1, 0, E1_GROSS, keccak256("kite-demo-isa1-e1"), keccak256("kite-demo-salt-e1"));
        _assertIsa(c, 1, ISA1_P * ISA1_CAPMULT / 100 - ISA1_P, STATUS_ACTIVE, "isa1.afterE1");
    }

    // ═══ Stage 2: E2 → ISA-1 CompletedCapped → {1,1,2,1} score 29 ═══════
    function _stage2(Ctx memory c) private {
        _requireActive(c, 1, "stage 1 (ISA-1 Active)");
        _settleIfNext(c, 1, 1, E2_GROSS, keccak256("kite-demo-isa1-e2"), keccak256("kite-demo-salt-e2"));
        _assertIsa(c, 1, 0, STATUS_COMPLETED_CAPPED, "isa1.capped");
    }

    // ═══ Stage 3: ISA-2 draft + activate + E3 ═══════════════════════════
    function _stage3(Ctx memory c) private {
        _requireCapped(c, 1, "stage 2 (ISA-1 capped)");
        _draftIfNone(c, 2, ISA2_P, ISA2_BPS, ISA2_CAPMULT, c.wati);
        _activateIfDrafted(c, 2, c.watiKey, c.wati);
        _settleIfNext(c, 2, 0, E3_GROSS, keccak256("kite-demo-isa2-e3"), keccak256("kite-demo-salt-e3"));
        _assertIsa(c, 2, 480e6, STATUS_ACTIVE, "isa2.afterE3"); // cap 780 − divert 300
    }

    // ═══ Stage 4: E4 → ISA-2 CompletedCapped → {2,2,4,2} score 58 ═══════
    function _stage4(Ctx memory c) private {
        _requireActive(c, 2, "stage 3 (ISA-2 Active)");
        _settleIfNext(c, 2, 1, E4_GROSS, keccak256("kite-demo-isa2-e4"), keccak256("kite-demo-salt-e4"));
        _assertIsa(c, 2, 0, STATUS_COMPLETED_CAPPED, "isa2.capped");
    }

    // ═══ Stage 5: ISA-3 (the demo ISA) + E5 + the assert block ══════════
    function _stage5(Ctx memory c) private {
        _requireCapped(c, 2, "stage 4 (ISA-2 capped)");
        _draftIfNone(c, 3, ISA3_P, ISA3_BPS, ISA3_CAPMULT, c.pakhaji);
        _activateIfDrafted(c, 3, c.pakhajiKey, c.pakhaji);
        _settleIfNext(c, 3, 0, E5_GROSS, keccak256("kite-demo-isa3-e5"), keccak256("kite-demo-salt-e5"));
        _asserts(c);
        _manifest(c);
    }

    // ── Funding leg (deployer): AUSD balances, MON top-ups; the mill's own
    //    approval rides a MILL-KEYED broadcast — allowance is owner-scoped, so
    //    approving from the deployer broadcast would set the WRONG owner's
    //    allowance (live-run T017 discovery; sim state is per-broadcast).
    function _fund(Ctx memory c) private {
        IERC20 ausd = IERC20(c.asset);
        vm.startBroadcast(c.deployerKey);
        if (ausd.balanceOf(c.siti) < PERSONA_FUND) ausd.transfer(c.siti, PERSONA_FUND);
        if (ausd.balanceOf(c.wati) < PERSONA_FUND) ausd.transfer(c.wati, PERSONA_FUND);
        if (ausd.balanceOf(c.pakhaji) < PERSONA_FUND) ausd.transfer(c.pakhaji, PERSONA_FUND);
        if (ausd.balanceOf(c.mill) < MILL_FUND) ausd.transfer(c.mill, MILL_FUND);
        uint256 monOps = _uintOr("MON_TOPUP_OPERATOR", 1e18);
        uint256 monPersona = _uintOr("MON_TOPUP_PERSONA", 0.3e18);
        if (c.relayer.balance < monOps) payable(c.relayer).transfer(monOps);
        if (c.orchestrator.balance < monOps) payable(c.orchestrator).transfer(monOps);
        if (c.budi.balance < monPersona) payable(c.budi).transfer(monPersona); // drafts are Budi's txs
        if (c.mill.balance < monPersona) payable(c.mill).transfer(monPersona); // the mill signs its own approve (T017)
        vm.stopBroadcast();
        if (ausd.allowance(c.mill, address(c.kite)) < MILL_FUND) {
            vm.startBroadcast(c.millKey);
            ausd.approve(address(c.kite), type(uint256).max);
            vm.stopBroadcast();
        }
    }

    // ── Identity (relayer): bind each persona once — hash only onchain ───
    function _bindAll(Ctx memory c) private {
        vm.startBroadcast(c.relayerKey);
        _bindIfUnbound(c, c.budi);
        _bindIfUnbound(c, c.siti);
        _bindIfUnbound(c, c.wati);
        _bindIfUnbound(c, c.pakhaji);
        vm.stopBroadcast();
    }

    function _bindIfUnbound(Ctx memory c, address who) private {
        if (c.kite.identityOf(who) == bytes32(0)) {
            c.kite.bindIdentity(who, keccak256(abi.encodePacked("kite-demo-identity:", who)));
        }
    }

    // ── Draft (Budi broadcasts; skip when the id already exists) ────────
    function _draftIfNone(Ctx memory c, uint256 id, uint256 principal, uint16 bps, uint16 capMult, address backer)
        private
    {
        if (c.kite.isaOf(id).status != STATUS_NONE) {
            return; // already drafted (or beyond) — idempotent skip
        }
        Terms memory t = Terms({
            principal: principal,
            shareBps: bps,
            capMult: capMult,
            termEnd: uint64(block.timestamp + 365 days),
            channelId: CHANNEL_ID
        });
        vm.startBroadcast(c.budiKey);
        c.kite.createISADraft(t, backer);
        vm.stopBroadcast();
    }

    // ── Activate (permissionless — deployer broadcasts the backer's sig) ─
    function _activateIfDrafted(Ctx memory c, uint256 id, uint256 backerKey, address backer) private {
        ISA memory isa = c.kite.isaOf(id);
        if (isa.status != STATUS_DRAFTED) return; // active or beyond — skip
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(c, backerKey, backer, isa.terms.principal, deadline);
        vm.startBroadcast(c.deployerKey);
        c.kite.activateWithPermit(id, deadline, v, r, s);
        vm.stopBroadcast();
    }

    /// @dev ERC-2612 over the LIVE asset's domain (the token verifies it).
    function _permitSig(Ctx memory c, uint256 backerKey, address backer, uint256 value, uint256 deadline)
        private
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        IERC20Permit ausd = IERC20Permit(c.asset);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                ausd.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, backer, address(c.kite), value, ausd.nonces(backer), deadline))
            )
        );
        (v, r, s) = vm.sign(backerKey, digest);
    }

    /// @dev Settle the (expectedNext)th qualifying event IF it hasn't happened.
    ///      Orchestrator transports the mill-signed fact (sig computed OFF the
    ///      broadcast — reads are free anytime).
    function _settleIfNext(Ctx memory c, uint256 id, uint256 expectedNext, uint256 gross, bytes32 ref, bytes32 salt)
        private
    {
        ISA memory isa = c.kite.isaOf(id);
        if (isa.eventCount > expectedNext) return; // already settled — skip
        (uint8 v, bytes32 r, bytes32 s) = _incomeSig(c, id, ref, gross, salt);
        vm.startBroadcast(c.orchestratorKey);
        c.kite.receiveIncome(id, ref, gross, salt, v, r, s);
        vm.stopBroadcast();
    }

    /// @dev EIP-712 IncomeEvent over KiteCore's own domain ("KiteCore","1") —
    ///      the proxy exposes no DOMAIN_SEPARATOR(), derive per EIP-712 (same
    ///      derivation KiteCore.t.sol uses). Signed by the MILL key.
    function _incomeSig(Ctx memory c, uint256 id, bytes32 ref, uint256 gross, bytes32 salt)
        private
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KiteCore"),
                keccak256("1"),
                block.chainid,
                address(c.kite)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domain,
                keccak256(abi.encode(INCOME_TYPEHASH, CHANNEL_ID, id, ref, gross, salt))
            )
        );
        (v, r, s) = vm.sign(c.millKey, digest);
    }

    // ── Ordering guards (run stages out of order → named abort) ─────────
    function _requireActive(Ctx memory c, uint256 id, string memory need) private view {
        require(c.kite.isaOf(id).status == STATUS_ACTIVE, need);
    }

    function _requireCapped(Ctx memory c, uint256 id, string memory need) private view {
        require(c.kite.isaOf(id).status == STATUS_COMPLETED_CAPPED, need);
    }

    // ── Light per-stage assert (catch drift at the right stage) ─────────
    function _assertIsa(Ctx memory c, uint256 id, uint256 remaining, uint8 status, string memory label) private view {
        ISA memory isa = c.kite.isaOf(id);
        if (isa.remaining != remaining) revert SeedAssert(label, remaining, isa.remaining);
        if (isa.status != status) revert SeedAssert(label, status, isa.status);
    }

    // ── Stage-5 assert block (FR-008/FR-012) ════════════════════════════
    function _asserts(Ctx memory c) private view {
        ISA memory isa3 = c.kite.isaOf(3);
        if (c.kite.scoreOf(c.budi) != EXPECTED_SCORE) {
            revert SeedAssert("scoreOf(budi)", EXPECTED_SCORE, c.kite.scoreOf(c.budi));
        }
        KiteScoring.Profile memory p = c.kite.profileOf(c.budi);
        if (p.totalISAs != 2) revert SeedAssert("profile.totalISAs", 2, p.totalISAs);
        if (p.completed != 2) revert SeedAssert("profile.completed", 2, p.completed);
        if (p.qualEvents != 4) revert SeedAssert("profile.qualEvents", 4, p.qualEvents);
        if (p.distinctBackers != 2) revert SeedAssert("profile.distinctBackers", 2, p.distinctBackers);
        if (isa3.terms.principal != ISA3_P) revert SeedAssert("isa3.principal", ISA3_P, isa3.terms.principal);
        if (isa3.remaining != EXPECTED_REMAINING_3) {
            revert SeedAssert("isa3.remaining", EXPECTED_REMAINING_3, isa3.remaining);
        }
        if (isa3.status != STATUS_ACTIVE) revert SeedAssert("isa3.status", STATUS_ACTIVE, isa3.status);
        if (isa3.backer != c.pakhaji) revert SeedAssert("isa3.backer", uint256(uint160(c.pakhaji)), uint256(uint160(isa3.backer)));
        IERC20 ausd = IERC20(c.asset);
        if (ausd.balanceOf(c.pakhaji) < EXPECTED_PAKHAJI_FLOOR) {
            revert SeedAssert("pakhaji.ausd", EXPECTED_PAKHAJI_FLOOR, ausd.balanceOf(c.pakhaji));
        }
        if (ausd.balanceOf(c.mill) < EXPECTED_MILL_FLOOR) {
            revert SeedAssert("mill.ausd", EXPECTED_MILL_FLOOR, ausd.balanceOf(c.mill));
        }
        if (c.relayer.balance == 0) revert SeedAssert("relayer.mon", 1, 0);
        if (c.orchestrator.balance == 0) revert SeedAssert("orchestrator.mon", 1, 0);
        uint256 gap = c.kite.minEventGap();
        if (gap != c.demoGap) revert SeedAssert("minEventGap", c.demoGap, gap);
    }

    /// @dev Persona manifest (public addresses only) — the block to paste into
    ///      contracts/script/DEMO-ACCOUNTS.md.
    function _manifest(Ctx memory c) private view {
        console2.log("=== Seed persona manifest (public addresses only) ===");
        console2.log("seeker Budi", c.budi);
        console2.log("backer Siti (ISA-1)", c.siti);
        console2.log("backer Wati (ISA-2)", c.wati);
        console2.log("backer PakHaji (ISA-3, demo)", c.pakhaji);
        console2.log("mill (channel signer + gross source)", c.mill);
        console2.log("relayer", c.relayer);
        console2.log("orchestrator", c.orchestrator);
        console2.log("asset", c.asset);
        console2.log("isaId 3 = the demo ISA; scoreOf(Budi) should read 58");
    }
}
