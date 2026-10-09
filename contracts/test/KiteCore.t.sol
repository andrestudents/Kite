// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {KiteCore} from "../src/KiteCore.sol";
import {MockAUSD} from "../src/MockAUSD.sol";
import {Terms, ISA, ISAModule, STATUS_ACTIVE, STATUS_DRAFTED, STATUS_COMPLETED_CAPPED, STATUS_COMPLETED_AT_TERM, STATUS_CANCELLED} from "../src/modules/ISA.sol";
import {Identity} from "../src/modules/Identity.sol";
import {Governed} from "../src/modules/Governed.sol";
import {Stream} from "../src/modules/Stream.sol";
import {KiteScoring} from "../src/KiteScoring.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Acceptance suite for KiteCore — PLAN §6.2/6.3 through the real
///         settlement path (constitution IX). Test names are contractual:
///         specs/003-kitecore-mockausd/contracts/kitecore-api.md.
/// @dev All money is AUSD base units (6 dp) — constitution VI. Fixture:
///      Budi (seeker) prepared to reputation {2,2,4,2} → score 58, then the
///      6.3 demo deal (P 600e6, share 20%, cap 1.3× → cap 780e6) runs
///      activation + three harvests 61 days apart on channel 1 (the mill).
contract KiteCoreTest is Test {
    // ── Actors ──────────────────────────────────────────────────────────
    uint256 internal adminPk = 0xA1;
    uint256 internal relayerPk = 0xA2;
    uint256 internal orchestratorPk = 0xA3;
    uint256 internal pauserPk = 0xA4;
    uint256 internal budiPk = 0xB1; // seeker
    uint256 internal hajiPk = 0xB2; // Pak Haji — the demo backer
    uint256 internal h1Pk = 0xB3; // prior-deal backer 1
    uint256 internal h2Pk = 0xB4; // prior-deal backer 2
    uint256 internal millPk = 0xC1; // channel 1: signs AND funds (research.md D6)

    address internal admin;
    address internal relayer;
    address internal orchestrator;
    address internal pauser;
    address internal budi;
    address internal haji;
    address internal h1;
    address internal h2;
    address internal mill;

    MockAUSD internal ausd;
    KiteCore internal kite; // the proxy

    uint64 internal constant CHANNEL_ID = 1;

    // Role constants, resolved once in setUp (hoisted out of expectRevert
    // args — a view call there consumes a pending vm.prank).
    bytes32 internal relayerRole;
    bytes32 internal orchestratorRole;
    bytes32 internal pauserRole;
    bytes32 internal adminRole;

    // EIP-712 pieces of KiteCore ("KiteCore", "1" — KiteCore.sol initialize).
    bytes32 internal kiteDomain;
    bytes32 internal constant INCOME_TYPEHASH =
        0x993e60ac070df4ed64c120feb264b7cc10bb416da565d78bea5a775c29b665bb;
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    uint256 internal demoIsaId;

    function setUp() public {
        admin = vm.addr(adminPk);
        relayer = vm.addr(relayerPk);
        orchestrator = vm.addr(orchestratorPk);
        pauser = vm.addr(pauserPk);
        budi = vm.addr(budiPk);
        haji = vm.addr(hajiPk);
        h1 = vm.addr(h1Pk);
        h2 = vm.addr(h2Pk);
        mill = vm.addr(millPk);

        ausd = new MockAUSD(address(this)); // 1,000,000 AUSD minted to this test; distributed below
        KiteCore impl = new KiteCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            // Q1/A: the suite runs at the PROTOCOL gap (60 days) — the §6.3
            // literal journey must prove the real qualifying bar. The 60-second
            // demo configuration has its own tier below (testGap_).
            abi.encodeCall(KiteCore.initialize, (admin, relayer, orchestrator, pauser, address(ausd), 60 days))
        );
        kite = KiteCore(address(proxy));

        kiteDomain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KiteCore"),
                keccak256("1"),
                block.chainid,
                address(kite)
            )
        );

        // Fund everyone (constitution VI: base units).
        ausd.transfer(haji, 5_000e6);
        ausd.transfer(h1, 5_000e6);
        ausd.transfer(h2, 5_000e6);
        ausd.transfer(mill, 20_000e6);
        vm.prank(mill);
        ausd.approve(address(kite), type(uint256).max); // the mill's standing approval (D6)

        // Verified humans (relayer attests; users never pay gas).
        vm.startPrank(relayer);
        kite.bindIdentity(budi, keccak256("budi@mera"));
        kite.bindIdentity(haji, keccak256("haji@mera"));
        kite.bindIdentity(h1, keccak256("h1@mera"));
        kite.bindIdentity(h2, keccak256("h2@mera"));
        vm.stopPrank();

        // The mill's channel (admin).
        vm.prank(admin);
        kite.registerChannel(CHANNEL_ID, "Koperasi Mill", mill);

        relayerRole = kite.RELAYER_ROLE();
        orchestratorRole = kite.ORCHESTRATOR_ROLE();
        pauserRole = kite.PAUSER_ROLE();
        adminRole = kite.DEFAULT_ADMIN_ROLE();
    }

    // ────────────────────────────────────────────────────────────────────
    // Fixture helpers
    // ────────────────────────────────────────────────────────────────────

    function _terms(uint256 principal, uint16 shareBps, uint16 capMult, uint64 termEnd)
        internal
        pure
        returns (Terms memory)
    {
        return Terms({principal: principal, shareBps: shareBps, capMult: capMult, termEnd: termEnd, channelId: CHANNEL_ID});
    }

    function _draft(address seeker, Terms memory t, address backer) internal returns (uint256 id) {
        vm.prank(seeker);
        id = kite.createISADraft(t, backer);
    }

    function _activate(uint256 id, uint256 backerPk, address backer) internal {
        uint256 principal = kite.isaOf(id).terms.principal;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        // The TOKEN verifies the permit over ITS domain (research.md D5);
        // KiteCore pre-recovers over the same domain for Kite__WrongBacker.
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                ausd.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, backer, address(kite), principal, ausd.nonces(backer), deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(backerPk, digest);
        kite.activateWithPermit(id, deadline, v, r, s);
    }

    function _signIncome(uint256 id, bytes32 ref, uint256 gross, bytes32 salt)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                kiteDomain,
                keccak256(abi.encode(INCOME_TYPEHASH, uint64(CHANNEL_ID), id, ref, gross, salt))
            )
        );
        (v, r, s) = vm.sign(millPk, digest);
    }

    function _settle(uint256 id, bytes32 ref, uint256 gross, bytes32 salt) internal {
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, ref, gross, salt);
        vm.prank(orchestrator);
        kite.receiveIncome(id, ref, gross, salt, v, r, s);
    }

    function _day(uint256 n) internal pure returns (bytes32) {
        return keccak256(abi.encode("purchase/", n));
    }

    /// @notice Drives Budi to the prepared reputation {2,2,4,2} (score 58):
    ///         two capped deals, one backer each, two qualifying events each.
    function _prepareBudi() internal {
        // Deal 1 (backer h1): P 600e6, cap 1.2× → 720e6. Two harvests of
        // 1800e6 slice 360e6 each → cap reached exactly at event 2. The term
        // must COVER both harvests (+61d/+122d) — D7 is a hard stop.
        Terms memory t1 = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 180 days));
        uint256 id1 = _draft(budi, t1, h1);
        _activate(id1, h1Pk, h1);
        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id1, _day(1), 1800e6, keccak256("s1"));
        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id1, _day(2), 1800e6, keccak256("s2"));
        assertEq(kite.isaOf(id1).status, STATUS_COMPLETED_CAPPED);

        // Deal 2 (backer h2): same shape.
        Terms memory t2 = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 180 days));
        uint256 id2 = _draft(budi, t2, h2);
        _activate(id2, h2Pk, h2);
        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id2, _day(3), 1800e6, keccak256("s3"));
        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id2, _day(4), 1800e6, keccak256("s4"));
        assertEq(kite.isaOf(id2).status, STATUS_COMPLETED_CAPPED);

        // {2,2,4,2} → H 26 · C 6 · V 26 → 58 (PLAN 6.3)
        assertEq(kite.scoreOf(budi), 58);
        assertEq(kite.offerOf(budi), 1296e6);
    }

    /// @notice Drafts the 6.3 demo deal: P 600e6 / share 20% / cap 1.3× →
    ///         cap 780e6, 12-month term, channel 1, backer Pak Haji.
    function _demoDraft() internal returns (uint256 id) {
        Terms memory t = _terms(600e6, 2000, 130, uint64(vm.getBlockTimestamp() + 365 days));
        id = _draft(budi, t, haji);
    }

    /// @notice Advances the 6.3 journey: stage 1 = activated, 2 = panen 1,
    ///         3 = panen 2, 4 = panen 3 (completed at cap). Panens land at
    ///         +61d/+122d/+183d from activation — every one INSIDE the
    ///         12-month term, each ≥ 60d after the last qualifying event.
    function _runTo(uint8 stage) internal returns (uint256 id) {
        _prepareBudi();
        id = _demoDraft();
        demoIsaId = id;
        if (stage >= 1) {
            _activate(id, hajiPk, haji);
        }
        if (stage >= 2) {
            vm.warp(vm.getBlockTimestamp() + 61 days);
            _settle(id, _day(11), 1500e6, keccak256("d1"));
        }
        if (stage >= 3) {
            vm.warp(vm.getBlockTimestamp() + 61 days);
            _settle(id, _day(12), 1500e6, keccak256("d2"));
        }
        if (stage >= 4) {
            vm.warp(vm.getBlockTimestamp() + 61 days);
            _settle(id, _day(13), 1500e6, keccak256("d3"));
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // Literal tier — the 6.3 journey through the real path (constitution IX)
    // ────────────────────────────────────────────────────────────────────

    function testLiteral_Demo_Activation_600Out_600In_Remaining780() public {
        uint256 id = _runTo(0);
        uint256 backerBefore = ausd.balanceOf(haji);
        uint256 seekerBefore = ausd.balanceOf(budi);

        _activate(id, hajiPk, haji); // ONE tx: permit → pull 600 → pay 600

        assertEq(ausd.balanceOf(haji), backerBefore - 600e6, "backer pays exactly principal");
        assertEq(ausd.balanceOf(budi), seekerBefore + 600e6, "seeker paid exactly principal");
        assertEq(ausd.balanceOf(address(kite)), 0, "contract holds nothing (6.4 #9)");
        ISA memory isa = kite.isaOf(id);
        assertEq(isa.status, STATUS_ACTIVE);
        assertEq(isa.remaining, 780e6, "cap = 600e6 x 130 / 100");
        assertEq(kite.activeISA(budi), id);
    }

    function testLiteral_Demo_Panen1_Back300_Seeker1200_Remaining480() public {
        uint256 id = _runTo(1);
        uint256 backerBefore = ausd.balanceOf(haji);
        uint256 seekerBefore = ausd.balanceOf(budi);

        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id, _day(11), 1500e6, keccak256("d1"));

        assertEq(ausd.balanceOf(haji), backerBefore + 300e6, "6.3 panen 1: backer +300");
        assertEq(ausd.balanceOf(budi), seekerBefore + 1200e6, "6.3 panen 1: seeker +1,200");
        assertEq(kite.isaOf(id).remaining, 480e6);
        assertEq(kite.isaOf(id).eventCount, 1, "first event qualifies");
    }

    function testLiteral_Demo_Panen2_Back300_Seeker1200_Remaining180() public {
        uint256 id = _runTo(2);
        uint256 backerBefore = ausd.balanceOf(haji);
        uint256 seekerBefore = ausd.balanceOf(budi);

        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id, _day(12), 1500e6, keccak256("d2"));

        assertEq(ausd.balanceOf(haji), backerBefore + 300e6, "6.3 panen 2: backer +300");
        assertEq(ausd.balanceOf(budi), seekerBefore + 1200e6, "6.3 panen 2: seeker +1,200");
        assertEq(kite.isaOf(id).remaining, 180e6);
        assertEq(kite.isaOf(id).eventCount, 2);
    }

    function testLiteral_Demo_Panen3_Back180_Seeker1320_CompletedCapped() public {
        uint256 id = _runTo(3);
        uint256 backerBefore = ausd.balanceOf(haji);
        uint256 seekerBefore = ausd.balanceOf(budi);

        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id, _day(13), 1500e6, keccak256("d3"));

        // Slice would be 300e6 but remaining is 180e6 — the cap wins (6.4 #1).
        assertEq(ausd.balanceOf(haji), backerBefore + 180e6, "6.3 panen 3: backer +180");
        assertEq(ausd.balanceOf(budi), seekerBefore + 1320e6, "6.3 panen 3: seeker +1,320");
        ISA memory isa = kite.isaOf(id);
        assertEq(isa.remaining, 0);
        assertEq(isa.status, STATUS_COMPLETED_CAPPED, "auto-complete at cap, same tx");
        assertEq(kite.activeISA(budi), 0, "slot cleared");
        assertEq(ausd.balanceOf(address(kite)), 0, "contract holds nothing (6.4 #9)");
    }

    function testLiteral_Demo_Reputation_58During_91AtFinish() public {
        uint256 id = _runTo(3); // activated + panen 1 + panen 2 settled
        assertEq(kite.scoreOf(budi), 58, "prepared score holds DURING the deal (6.4 #7)");

        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id, _day(13), 1500e6, keccak256("d3"));

        // {3,3,7,3} → H 40 · C 11 · V 40 → 91 — exactly at completion.
        assertEq(kite.profileOf(budi).totalISAs, 3);
        assertEq(kite.profileOf(budi).completed, 3);
        assertEq(kite.profileOf(budi).qualEvents, 7);
        assertEq(kite.profileOf(budi).distinctBackers, 3);
        assertEq(kite.scoreOf(budi), 91);
        assertEq(kite.offerOf(budi), 1692e6);
    }

    function testLiteral_Cap_Formula_PrincipalTimesCapMultOver100() public {
        _prepareBudi(); // score 58 → maxP 1296e6
        Terms memory t = _terms(1000e6, 2000, 150, uint64(vm.getBlockTimestamp() + 365 days));
        uint256 id = _draft(budi, t, haji);
        assertEq(kite.isaOf(id).remaining, 1500e6, "1000e6 x 150 / 100");
        assertEq(kite.isaOf(id).status, STATUS_DRAFTED);
    }

    // ────────────────────────────────────────────────────────────────────
    // Boundary tier (US2) — unwritable unfairness + unwipeable identity.
    // Behavior exists from US1: every test must PASS on arrival; a failure
    // here is a src bug, not test debt (tasks.md Notes).
    // ────────────────────────────────────────────────────────────────────

    /// @dev A freshly bound seeker: score 0 → maxP exactly 600e6.
    function _newVerifiedSeeker(uint256 pk, bytes32 hash) internal returns (address s) {
        s = vm.addr(pk);
        vm.prank(relayer);
        kite.bindIdentity(s, hash);
    }

    // ── Draft bounds: inclusive edges accept, one past reverts (FR-005) ──

    function testBoundary_Draft_Share999_Reverts() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = _terms(600e6, 999, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(s);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__ShareOutOfBounds.selector, uint16(999)));
        kite.createISADraft(t, haji);
    }

    function testBoundary_Draft_Share1000_Ok() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = _terms(600e6, 1000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(s);
        uint256 id = kite.createISADraft(t, haji);
        assertEq(kite.isaOf(id).status, STATUS_DRAFTED);
    }

    function testBoundary_Draft_Share2000_Ok() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(s);
        uint256 id = kite.createISADraft(t, haji);
        assertEq(kite.isaOf(id).status, STATUS_DRAFTED);
    }

    function testBoundary_Draft_Share2001_Reverts() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = _terms(600e6, 2001, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(s);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__ShareOutOfBounds.selector, uint16(2001)));
        kite.createISADraft(t, haji);
    }

    function testBoundary_Draft_Cap119_Reverts() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = _terms(600e6, 2000, 119, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(s);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__CapMultOutOfBounds.selector, uint16(119)));
        kite.createISADraft(t, haji);
    }

    function testBoundary_Draft_Cap120_Ok() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(s);
        uint256 id = kite.createISADraft(t, haji);
        assertEq(kite.isaOf(id).remaining, 720e6, "600e6 x 120 / 100");
    }

    function testBoundary_Draft_Cap150_Ok() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = _terms(600e6, 2000, 150, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(s);
        uint256 id = kite.createISADraft(t, haji);
        assertEq(kite.isaOf(id).remaining, 900e6, "600e6 x 150 / 100");
    }

    function testBoundary_Draft_Cap151_Reverts() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = _terms(600e6, 2000, 151, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(s);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__CapMultOutOfBounds.selector, uint16(151)));
        kite.createISADraft(t, haji);
    }

    // ── Term bound: MAX_TERM 730 days, inclusive (data-model.md) ─────────

    function testBoundary_Draft_TermBeyond24Months_Reverts() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 730 days + 1));
        vm.prank(s);
        vm.expectRevert(
            abi.encodeWithSelector(
                ISAModule.Kite__TermTooLong.selector, uint64(vm.getBlockTimestamp() + 730 days + 1), uint64(vm.getBlockTimestamp() + 730 days)
            )
        );
        kite.createISADraft(t, haji);
    }

    function testBoundary_Draft_TermExactly24Months_Ok() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 730 days));
        vm.prank(s);
        uint256 id = kite.createISADraft(t, haji);
        assertEq(kite.isaOf(id).status, STATUS_DRAFTED);
    }

    // ── Principal bound: score decides maxP (FR-005) ─────────────────────

    function testBoundary_Draft_PrincipalAboveMaxP_Reverts() public {
        _prepareBudi(); // score 58 → maxP 1296e6
        Terms memory t = _terms(1296e6 + 1, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(budi);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__PrincipalAboveMax.selector, 1296e6 + 1, 1296e6));
        kite.createISADraft(t, haji);
    }

    function testBoundary_Draft_PrincipalExactlyMaxP_Ok() public {
        _prepareBudi(); // score 58 → maxP 1296e6
        Terms memory t = _terms(1296e6, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(budi);
        uint256 id = kite.createISADraft(t, haji);
        assertEq(kite.isaOf(id).remaining, 1296e6 * 120 / 100, "1296e6 x 120 / 100 = 1555200000");
    }

    function testBoundary_Draft_PrincipalAboveScore0Max_Reverts() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = _terms(600e6 + 1, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(s);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__PrincipalAboveMax.selector, 600e6 + 1, 600e6));
        kite.createISADraft(t, haji);
    }

    // ── Channel / one-deal / verification gates ──────────────────────────

    function testBoundary_Draft_UnknownChannel_Reverts() public {
        address s = _newVerifiedSeeker(0xD1, keccak256("s1@mera"));
        Terms memory t = Terms({principal: 600e6, shareBps: 2000, capMult: 120, termEnd: uint64(vm.getBlockTimestamp() + 30 days), channelId: 99});
        vm.prank(s);
        vm.expectRevert(abi.encodeWithSelector(Identity.Kite__UnknownChannel.selector, uint64(99)));
        kite.createISADraft(t, haji);
    }

    function testBoundary_Draft_SeekerWithActiveDeal_Reverts() public {
        uint256 id = _runTo(1); // demo deal ACTIVE for budi
        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(budi);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__HasActiveISA.selector, budi, id));
        kite.createISADraft(t, haji);
    }

    function testBoundary_Draft_SeekerUnverified_Reverts() public {
        address ghost = vm.addr(0xE1); // never bound
        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(ghost);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__NotVerified.selector, ghost));
        kite.createISADraft(t, haji);
    }

    // ── Identity: one-to-one, immutable both ways (§6.4 #5) ──────────────

    function testBoundary_Identity_HashToSecondWallet_Reverts() public {
        bytes32 budiHash = kite.identityOf(budi);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Identity.Kite__HashAlreadyBound.selector, budiHash, vm.addr(0xE2)));
        kite.bindIdentity(vm.addr(0xE2), budiHash);
    }

    function testBoundary_Identity_SecondHashToWallet_Reverts() public {
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(Identity.Kite__IdentityAlreadyBound.selector, budi, keccak256("other@mera"))
        );
        kite.bindIdentity(budi, keccak256("other@mera"));
    }

    // ── Cancel: either party, Drafted only, terminal (D4) ─────────────────

    function testBoundary_Cancel_BySeeker_WhileDrafted_Ok() public {
        uint256 id = _demoDraft();
        vm.prank(budi);
        kite.cancelDraft(id);
        assertEq(kite.isaOf(id).status, STATUS_CANCELLED);
        assertEq(kite.activeISA(budi), 0, "draft never set the slot");
    }

    function testBoundary_Cancel_ByBacker_WhileDrafted_Ok() public {
        uint256 id = _demoDraft();
        vm.prank(haji);
        kite.cancelDraft(id);
        assertEq(kite.isaOf(id).status, STATUS_CANCELLED);
    }

    function testBoundary_Cancel_AfterActivation_Reverts() public {
        uint256 id = _runTo(1); // Active
        vm.prank(budi);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__NotDrafted.selector, id, uint8(STATUS_ACTIVE)));
        kite.cancelDraft(id);
    }

    // ── Views recompute from public state (constitution IV) ──────────────

    function testBoundary_Views_RecomputeFromPublicState() public {
        uint256 id = _runTo(3); // two panens settled, one to go
        ISA memory isa = kite.isaOf(id);
        assertEq(isa.remaining, 180e6, "600e6 x 130 / 100 - 300e6 - 300e6");
        // Profile recomputes to the §6.3 literal: {2,2,4,2} → 58 → 1296e6.
        KiteScoring.Profile memory p = kite.profileOf(budi);
        assertEq(p.totalISAs, 2);
        assertEq(p.completed, 2);
        assertEq(p.qualEvents, 4);
        assertEq(p.distinctBackers, 2);
        assertEq(kite.scoreOf(budi), KiteScoring.score(p), "scoreOf == score(profileOf)");
        assertEq(kite.scoreOf(budi), 58);
        assertEq(kite.offerOf(budi), 1296e6);
        // The live deal's cap math is recomputable from isaOf alone.
        assertEq(isa.terms.principal * isa.terms.capMult / 100 - 300e6 - 300e6, isa.remaining);
    }

    // ────────────────────────────────────────────────────────────────────
    // Stream adversarial tier (US3) — nothing dishonest is possible.
    // Rows 25–37 of contracts/kitecore-api.md.
    // ────────────────────────────────────────────────────────────────────

    /// @dev Mirror of Stream.IncomeSettled for vm.expectEmit (only the data
    ///      fields are compared; indexed topics unchecked).
    event IncomeSettled(
        uint256 indexed isaId,
        uint64 indexed channelId,
        bytes32 indexed purchaseRef,
        uint256 gross,
        uint256 toBacker,
        uint256 toSeeker,
        uint256 remaining,
        bool qualifying
    );

    /// @dev Mirror of Stream.MismatchFlagged for vm.expectEmit.
    event MismatchFlagged(uint256 indexed day, uint256 expected, uint256 actual);

    /// @dev The EIP-712 digest KiteCore verifies onchain (Stream._verifyChannelFact).
    function _incomeDigest(uint64 channelId, uint256 id, bytes32 ref, uint256 gross, bytes32 salt)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked("\x19\x01", kiteDomain, keccak256(abi.encode(INCOME_TYPEHASH, channelId, id, ref, gross, salt)))
        );
    }

    function testBoundary_Income_CallerNotOrchestrator_Reverts() public {
        uint256 id = _runTo(1);
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(11), 1500e6, keccak256("d1"));
        address intruder = vm.addr(0xE3);
        vm.prank(intruder);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, intruder, orchestratorRole)
        );
        kite.receiveIncome(id, _day(11), 1500e6, keccak256("d1"), v, r, s);
    }

    function testBoundary_Income_ForgedSignature_Reverts() public {
        uint256 id = _runTo(1);
        bytes32 ref = _day(11);
        uint256 gross = 1500e6;
        bytes32 salt = keccak256("d1");
        bytes32 digest = _incomeDigest(uint64(CHANNEL_ID), id, ref, gross, salt);
        address forger = vm.addr(0xF1); // never registered as a channel key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xF1, digest);
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(Stream.Kite__BadChannelSignature.selector, digest, forger, mill));
        kite.receiveIncome(id, ref, gross, salt, v, r, s);
    }

    function testBoundary_Income_WrongChannel_Reverts() public {
        uint256 id = _runTo(1);
        address k2 = vm.addr(0xF2);
        vm.prank(admin);
        kite.registerChannel(2, "Koperasi Lain", k2); // a REGISTERED second channel
        bytes32 ref = _day(11);
        uint256 gross = 1500e6;
        bytes32 salt = keccak256("d1");
        // Fact signed by channel 2's key but naming channel 1 (the deal's).
        bytes32 digest = _incomeDigest(uint64(CHANNEL_ID), id, ref, gross, salt);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xF2, digest);
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(Stream.Kite__ChannelMismatch.selector, uint64(2), uint64(CHANNEL_ID)));
        kite.receiveIncome(id, ref, gross, salt, v, r, s);
    }

    function testBoundary_Income_TamperedGross_Reverts() public {
        uint256 id = _runTo(1);
        bytes32 ref = _day(11);
        bytes32 salt = keccak256("d1");
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, ref, 1500e6, salt); // mill signed 1500e6
        // Orchestrator submits 1400e6 — recovery over the tampered digest fails.
        bytes32 tampered = _incomeDigest(uint64(CHANNEL_ID), id, ref, 1400e6, salt);
        address bogus = ecrecover(tampered, v, r, s);
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(Stream.Kite__BadChannelSignature.selector, tampered, bogus, mill));
        kite.receiveIncome(id, ref, 1400e6, salt, v, r, s);
    }

    function testBoundary_Income_ReplaySameTuple_Reverts() public {
        uint256 id = _runTo(1);
        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id, _day(11), 1500e6, keccak256("d1"));
        // PLAN §6.2 eventHash, byte-for-byte: (channelId, purchaseRef, gross, salt).
        bytes32 eventHash = keccak256(abi.encode(uint64(CHANNEL_ID), _day(11), uint256(1500e6), keccak256("d1")));
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(11), 1500e6, keccak256("d1"));
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(Stream.Kite__EventAlreadySettled.selector, eventHash));
        kite.receiveIncome(id, _day(11), 1500e6, keccak256("d1"), v, r, s);
    }

    function testBoundary_Income_ReplaySameRefNewSalt_Reverts() public {
        uint256 id = _runTo(1);
        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id, _day(11), 1500e6, keccak256("d1"));
        // Same purchaseRef, fresh salt: the settledRefs guard still fires —
        // the NEW eventHash is named in the revert (§6.4 #2, second clause).
        bytes32 eventHash2 = keccak256(abi.encode(uint64(CHANNEL_ID), _day(11), uint256(1500e6), keccak256("d1b")));
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(11), 1500e6, keccak256("d1b"));
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(Stream.Kite__EventAlreadySettled.selector, eventHash2));
        kite.receiveIncome(id, _day(11), 1500e6, keccak256("d1b"), v, r, s);
    }

    function testBoundary_Income_OnDrafted_Reverts() public {
        uint256 id = _runTo(0); // drafted, NOT activated
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(11), 1500e6, keccak256("d1"));
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__NotActive.selector, id, uint8(STATUS_DRAFTED)));
        kite.receiveIncome(id, _day(11), 1500e6, keccak256("d1"), v, r, s);
    }

    function testBoundary_Income_OnCancelled_Reverts() public {
        uint256 id = _demoDraft();
        vm.prank(budi);
        kite.cancelDraft(id);
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(11), 1500e6, keccak256("d1"));
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__NotActive.selector, id, uint8(STATUS_CANCELLED)));
        kite.receiveIncome(id, _day(11), 1500e6, keccak256("d1"), v, r, s);
    }

    function testBoundary_Income_OnCompletedCapped_Reverts() public {
        uint256 id = _runTo(4); // panen 3 hits the cap → CompletedCapped
        assertEq(kite.isaOf(id).status, STATUS_COMPLETED_CAPPED);
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(99), 1500e6, keccak256("late"));
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__NotActive.selector, id, uint8(STATUS_COMPLETED_CAPPED)));
        kite.receiveIncome(id, _day(99), 1500e6, keccak256("late"), v, r, s);
    }

    function testBoundary_Income_ZeroGross_SettlesZero_NeverQualifies() public {
        uint256 id = _runTo(1);
        vm.warp(vm.getBlockTimestamp() + 61 days);
        uint256 backerBefore = ausd.balanceOf(haji);
        uint256 seekerBefore = ausd.balanceOf(budi);
        bytes32 ref = keccak256("purchase/zero"); // fresh ref — a failed harvest

        vm.expectEmit(false, false, false, true, address(kite));
        emit IncomeSettled(id, uint64(CHANNEL_ID), ref, 0, 0, 0, 780e6, false);
        _settle(id, ref, 0, keccak256("z"));

        assertEq(ausd.balanceOf(haji), backerBefore, "0/0 split");
        assertEq(ausd.balanceOf(budi), seekerBefore, "0/0 split");
        ISA memory isa = kite.isaOf(id);
        assertEq(isa.remaining, 780e6, "cap untouched");
        assertEq(isa.status, STATUS_ACTIVE, "still active");
        assertEq(isa.eventCount, 0, "zero gross never qualifies (D9)");
        assertEq(isa.lastEventAt, 0);
        // D9: the failed fact IS recorded — replaying it reverts.
        bytes32 eventHash = keccak256(abi.encode(uint64(CHANNEL_ID), ref, uint256(0), keccak256("z")));
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, ref, 0, keccak256("z"));
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(Stream.Kite__EventAlreadySettled.selector, eventHash));
        kite.receiveIncome(id, ref, 0, keccak256("z"), v, r, s);
    }

    function testBoundary_Income_SubBarGap_Splits_NoQualCredit() public {
        uint256 id = _runTo(1);
        // 61d − 1s after activation, no prior event: the gap clause passes,
        // so ONLY the 10%-of-principal clause can (and does) disqualify.
        vm.warp(vm.getBlockTimestamp() + 61 days - 1 seconds);
        uint256 backerBefore = ausd.balanceOf(haji);
        uint256 seekerBefore = ausd.balanceOf(budi);

        _settle(id, _day(11), 59e6, keccak256("small")); // 59e6 < 10% of 600e6

        assertEq(ausd.balanceOf(haji), backerBefore + 11_800_000, "splits anyway: 59e6 x 20%");
        assertEq(ausd.balanceOf(budi), seekerBefore + 47_200_000, "seeker keeps 80%");
        ISA memory isa = kite.isaOf(id);
        assertEq(isa.remaining, 768_200_000, "780e6 - 11.8e6");
        assertEq(isa.eventCount, 0, "no qualifying credit (6.4 #8)");
        assertEq(isa.lastEventAt, 0);
    }

    function testBoundary_Income_SliceEqualsRemaining_CompletesExactly() public {
        uint256 id = _runTo(3); // remaining 180e6
        vm.warp(vm.getBlockTimestamp() + 61 days);
        uint256 backerBefore = ausd.balanceOf(haji);
        uint256 seekerBefore = ausd.balanceOf(budi);

        _settle(id, _day(13), 900e6, keccak256("d3x")); // slice 900e6 x 20% = 180e6 == remaining

        assertEq(ausd.balanceOf(haji), backerBefore + 180e6, "no clamp needed: slice == remaining");
        assertEq(ausd.balanceOf(budi), seekerBefore + 720e6);
        ISA memory isa = kite.isaOf(id);
        assertEq(isa.remaining, 0);
        assertEq(isa.status, STATUS_COMPLETED_CAPPED, "completes at exactly the cap");
        assertEq(kite.activeISA(budi), 0);
        assertEq(ausd.balanceOf(address(kite)), 0, "contract holds nothing (6.4 #9)");
    }

    function testBoundary_Income_AfterTermEnd_Reverts() public {
        uint256 id = _runTo(1);
        uint64 termEnd = kite.isaOf(id).terms.termEnd;
        vm.warp(uint256(termEnd) + 1); // D7 hard stop; equality is still allowed
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(99), 1500e6, keccak256("late"));
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(Stream.Kite__TermEnded.selector, id, termEnd));
        kite.receiveIncome(id, _day(99), 1500e6, keccak256("late"), v, r, s);
    }

    // ────────────────────────────────────────────────────────────────────
    // Completion matrix (US3) — rows 38–41: permissionless, idempotent,
    // remainder FORGIVEN, never pausable.
    // ────────────────────────────────────────────────────────────────────

    function testBoundary_Complete_BeforeTermEnd_Reverts() public {
        uint256 id = _runTo(1); // Active, months before termEnd
        vm.expectRevert(abi.encodeWithSelector(Stream.Kite__TermEnded.selector, id, kite.isaOf(id).terms.termEnd));
        kite.completeAtTerm(id);
    }

    function testBoundary_Complete_FromDrafted_Reverts() public {
        uint256 id = _demoDraft(); // Drafted — status gate fires before the clock
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__NotActive.selector, id, uint8(STATUS_DRAFTED)));
        kite.completeAtTerm(id);
    }

    function testBoundary_Complete_RemainderForgiven_ProfileUpdated() public {
        uint256 id = _runTo(3); // panen 1 + 2 settled: remaining 180e6, eventCount 2
        vm.warp(uint256(kite.isaOf(id).terms.termEnd)); // inclusive boundary (D11)

        kite.completeAtTerm(id); // permissionless — no prank needed

        ISA memory isa = kite.isaOf(id);
        assertEq(isa.status, STATUS_COMPLETED_AT_TERM);
        assertEq(isa.remaining, 180e6, "remainder stays on the record (forgiven, not erased)");
        assertEq(kite.activeISA(budi), 0);
        // {+1,+1,+eventCount,+1} on {2,2,4,2} → {3,3,6,3} → 90 → 1680e6.
        KiteScoring.Profile memory p = kite.profileOf(budi);
        assertEq(p.totalISAs, 3);
        assertEq(p.completed, 3);
        assertEq(p.qualEvents, 6, "eventCount folded in at completion only");
        assertEq(p.distinctBackers, 3);
        assertEq(kite.scoreOf(budi), 90);
        assertEq(kite.offerOf(budi), 1680e6);
        // Terminal: post-term income reverts, even with a valid signature.
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(99), 1500e6, keccak256("late"));
        vm.prank(orchestrator);
        vm.expectRevert(
            abi.encodeWithSelector(ISAModule.Kite__NotActive.selector, id, uint8(STATUS_COMPLETED_AT_TERM))
        );
        kite.receiveIncome(id, _day(99), 1500e6, keccak256("late"), v, r, s);
    }

    function testBoundary_Complete_SecondCall_NoOpSuccess() public {
        uint256 id = _runTo(2);
        vm.warp(uint256(kite.isaOf(id).terms.termEnd));
        kite.completeAtTerm(id);
        KiteScoring.Profile memory p1 = kite.profileOf(budi);
        uint256 hajiBal = ausd.balanceOf(haji);
        uint256 budiBal = ausd.balanceOf(budi);

        vm.recordLogs();
        kite.completeAtTerm(id); // a Sentinel retry must not double-count (6.4 #7)
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 kiteLogs;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter == address(kite)) ++kiteLogs;
        }

        assertEq(kiteLogs, 0, "idempotent: no duplicate event");
        KiteScoring.Profile memory p2 = kite.profileOf(budi);
        assertEq(p2.totalISAs, p1.totalISAs);
        assertEq(p2.completed, p1.completed);
        assertEq(p2.qualEvents, p1.qualEvents);
        assertEq(p2.distinctBackers, p1.distinctBackers);
        assertEq(kite.isaOf(id).status, STATUS_COMPLETED_AT_TERM);
        assertEq(ausd.balanceOf(haji), hajiBal, "no money moved");
        assertEq(ausd.balanceOf(budi), budiBal, "no money moved");
    }

    // ────────────────────────────────────────────────────────────────────
    // Role tier (US3) — rows 46–51: least authority, provable fund safety
    // (§6.4 #12: RELAYER/ORCHESTRATOR can never move user funds beyond
    // the §6.2 functions).
    // ────────────────────────────────────────────────────────────────────

    /// @dev Shared AccessControl revert expectation.
    function _expectAccess(address who, bytes32 role) internal {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role));
    }

    function testRole_Relayer_CanOnlyBind() public {
        uint256 id = _runTo(1); // Active, in-term — backdrop for the reverts
        uint64 demoTermEnd = kite.isaOf(id).terms.termEnd; // hoisted (see below)
        address impl2 = address(new KiteCore()); // hoisted: a create after expectRevert
        // The one thing a relayer DOES: attest a human.
        address newcomer = _newVerifiedSeeker(0xD9, keccak256("r9@mera"));
        assertEq(kite.identityOf(newcomer), keccak256("r9@mera"));

        vm.prank(relayer);
        _expectAccess(relayer, orchestratorRole); // income
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(11), 1500e6, keccak256("d1"));
        kite.receiveIncome(id, _day(11), 1500e6, keccak256("d1"), v, r, s);

        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__NotVerified.selector, relayer)); // draft (unbound)
        kite.createISADraft(t, haji);

        vm.prank(relayer); // complete: permissionless fn, state-gated (Active, in-term)
        // (termEnd hoisted — a view call inside expectRevert args consumes it)
        vm.expectRevert(abi.encodeWithSelector(Stream.Kite__TermEnded.selector, id, demoTermEnd));
        kite.completeAtTerm(id);

        vm.prank(relayer);
        _expectAccess(relayer, orchestratorRole); // flag
        kite.flagMismatch(1, 1, 1);

        vm.prank(relayer);
        _expectAccess(relayer, adminRole); // register
        kite.registerChannel(9, "x", relayer);

        vm.prank(relayer); // upgrade — UUPS entry lives on the implementation
        _expectAccess(relayer, adminRole);
        kite.upgradeToAndCall(impl2, "");
    }

    function testRole_Orchestrator_OnlyIncomeCompleteFlag() public {
        uint256 id = _runTo(1);
        // Those three, OK:
        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id, _day(11), 1500e6, keccak256("d1")); // income
        assertEq(kite.isaOf(id).remaining, 480e6);
        vm.warp(uint256(kite.isaOf(id).terms.termEnd));
        vm.prank(orchestrator); // complete
        kite.completeAtTerm(id);
        assertEq(kite.isaOf(id).status, STATUS_COMPLETED_AT_TERM);
        vm.expectEmit(false, false, false, true, address(kite)); // flag
        emit MismatchFlagged(7, 100e6, 90e6);
        vm.prank(orchestrator);
        kite.flagMismatch(7, 100e6, 90e6);

        // Everything else reverts:
        vm.prank(orchestrator);
        _expectAccess(orchestrator, relayerRole); // bind
        kite.bindIdentity(orchestrator, keccak256("orc@mera"));

        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__NotVerified.selector, orchestrator)); // draft
        kite.createISADraft(t, haji);

        vm.prank(orchestrator);
        _expectAccess(orchestrator, adminRole); // register
        kite.registerChannel(9, "x", orchestrator);
    }

    function testRole_Pauser_OnlyPauseCycle() public {
        vm.prank(pauser);
        kite.pause();
        assertTrue(kite.paused());
        vm.prank(pauser);
        kite.unpause();
        assertFalse(kite.paused());

        // Every fund-adjacent call reverts for the pauser as actor:
        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(pauser);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__NotVerified.selector, pauser)); // draft
        kite.createISADraft(t, haji);

        uint256 id = _runTo(1);
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(11), 1500e6, keccak256("d1"));
        vm.prank(pauser);
        _expectAccess(pauser, orchestratorRole); // income
        kite.receiveIncome(id, _day(11), 1500e6, keccak256("d1"), v, r, s);

        vm.prank(pauser);
        _expectAccess(pauser, orchestratorRole); // flag
        kite.flagMismatch(1, 1, 1);

        vm.prank(pauser);
        _expectAccess(pauser, relayerRole); // bind
        kite.bindIdentity(pauser, keccak256("p@mera"));

        vm.prank(pauser);
        _expectAccess(pauser, adminRole); // register
        kite.registerChannel(9, "x", pauser);
    }

    function testRole_Admin_GrantsRoles_CannotMoveFunds() public {
        // Grant/revoke OK — and the grant is EFFECTIVE:
        address delegate = vm.addr(0xE6);
        vm.prank(admin);
        kite.grantRole(relayerRole, delegate);
        address newcomer = vm.addr(0xE7);
        vm.prank(delegate); // now a relayer
        kite.bindIdentity(newcomer, keccak256("n7@mera"));
        assertEq(kite.identityOf(newcomer), keccak256("n7@mera"));
        vm.prank(admin);
        kite.revokeRole(relayerRole, delegate);
        vm.prank(delegate); // power gone
        _expectAccess(delegate, relayerRole);
        kite.bindIdentity(vm.addr(0xE8), keccak256("n8@mera"));

        // ...but ADMIN as an actor moves nothing (§6.4 #12):
        uint256 id = _runTo(1);
        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(11), 1500e6, keccak256("d1"));
        vm.prank(admin);
        _expectAccess(admin, orchestratorRole); // income
        kite.receiveIncome(id, _day(11), 1500e6, keccak256("d1"), v, r, s);

        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__NotVerified.selector, admin)); // draft
        kite.createISADraft(t, haji);
        // (Upgrade authority itself is proven in testUpgrade_StateSurvives_V2.)
    }

    function testRole_Stranger_OnlyCompleteAtTerm() public {
        uint256 id = _runTo(1);
        vm.warp(uint256(kite.isaOf(id).terms.termEnd) + 1);
        address stranger = vm.addr(0xE5);

        // Everything role-gated reverts for a stranger:
        vm.prank(stranger);
        _expectAccess(stranger, relayerRole);
        kite.bindIdentity(stranger, keccak256("s5@mera"));

        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ISAModule.Kite__NotVerified.selector, stranger)); // draft
        kite.createISADraft(t, haji);

        (uint8 v, bytes32 r, bytes32 s) = _signIncome(id, _day(11), 1500e6, keccak256("d1"));
        vm.prank(stranger);
        _expectAccess(stranger, orchestratorRole);
        kite.receiveIncome(id, _day(11), 1500e6, keccak256("d1"), v, r, s);

        vm.prank(stranger);
        _expectAccess(stranger, orchestratorRole);
        kite.flagMismatch(1, 1, 1);

        vm.prank(stranger);
        _expectAccess(stranger, pauserRole);
        kite.pause();

        // The ONE permissionless act: complete the over-term deal.
        vm.prank(stranger);
        kite.completeAtTerm(id);
        assertEq(kite.isaOf(id).status, STATUS_COMPLETED_AT_TERM);
    }

    function testRole_FlagMismatch_EmitsOnly_ZeroStateChange() public {
        uint256 id = _runTo(1);
        // Snapshot EVERYTHING a stranger might hope to corrupt.
        uint256 hajiBal = ausd.balanceOf(haji);
        uint256 budiBal = ausd.balanceOf(budi);
        uint256 millBal = ausd.balanceOf(mill);
        uint256 kiteBal = ausd.balanceOf(address(kite));
        ISA memory before = kite.isaOf(id);
        KiteScoring.Profile memory prof = kite.profileOf(budi);
        uint8 score = kite.scoreOf(budi);
        bool wasPaused = kite.paused();

        vm.expectEmit(false, false, false, true, address(kite));
        emit MismatchFlagged(9, 123e6, 100e6);
        vm.prank(orchestrator);
        kite.flagMismatch(9, 123e6, 100e6);

        // Byte-identical: balances, ISA state, reputation, pause.
        assertEq(ausd.balanceOf(haji), hajiBal);
        assertEq(ausd.balanceOf(budi), budiBal);
        assertEq(ausd.balanceOf(mill), millBal);
        assertEq(ausd.balanceOf(address(kite)), kiteBal);
        ISA memory after_ = kite.isaOf(id);
        assertEq(after_.remaining, before.remaining);
        assertEq(after_.eventCount, before.eventCount);
        assertEq(after_.lastEventAt, before.lastEventAt);
        assertEq(after_.status, before.status);
        assertEq(after_.activatedAt, before.activatedAt);
        assertEq(kite.profileOf(budi).totalISAs, prof.totalISAs);
        assertEq(kite.profileOf(budi).completed, prof.completed);
        assertEq(kite.profileOf(budi).qualEvents, prof.qualEvents);
        assertEq(kite.profileOf(budi).distinctBackers, prof.distinctBackers);
        assertEq(kite.scoreOf(budi), score);
        assertFalse(kite.paused() != wasPaused);
    }

    // ────────────────────────────────────────────────────────────────────
    // Pause tier (US3) — rows 52–56: ASYMMETRIC by construction (§6.2,
    // constitution VII). Pause blocks ONLY draft/activate.
    // ────────────────────────────────────────────────────────────────────

    function testPause_Blocks_CreateISADraft() public {
        vm.prank(pauser);
        kite.pause();
        Terms memory t = _terms(600e6, 2000, 120, uint64(vm.getBlockTimestamp() + 30 days));
        vm.prank(budi);
        vm.expectRevert(abi.encodeWithSelector(Governed.Kite__Paused.selector));
        kite.createISADraft(t, haji);
    }

    function testPause_Blocks_ActivateWithPermit() public {
        uint256 id = _demoDraft();
        vm.prank(pauser);
        kite.pause();
        // All reads/signing BEFORE expectRevert — _activate's internal view
        // calls into the token would consume the expectation.
        uint256 principal = kite.isaOf(id).terms.principal;
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                ausd.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, haji, address(kite), principal, ausd.nonces(haji), deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(hajiPk, digest);
        vm.expectRevert(abi.encodeWithSelector(Governed.Kite__Paused.selector));
        vm.prank(haji);
        kite.activateWithPermit(id, deadline, v, r, s);
    }

    function testPause_Allows_ReceiveIncome() public {
        uint256 id = _runTo(1);
        vm.prank(pauser);
        kite.pause();
        assertTrue(kite.paused());
        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id, _day(11), 1500e6, keccak256("d1")); // never blocked (6.4 #10)
        assertEq(kite.isaOf(id).remaining, 480e6);
        assertEq(kite.isaOf(id).status, STATUS_ACTIVE);
    }

    function testPause_Allows_CompleteAtTerm() public {
        uint256 id = _runTo(1);
        vm.prank(pauser);
        kite.pause();
        vm.warp(uint256(kite.isaOf(id).terms.termEnd));
        vm.prank(budi); // even a party, while paused — forgiveness never waits
        kite.completeAtTerm(id);
        assertEq(kite.isaOf(id).status, STATUS_COMPLETED_AT_TERM);
    }

    function testPause_Allows_BindAndRegister() public {
        vm.prank(pauser);
        kite.pause();
        // Documented default (research D10): role actions are NOT pause-gated.
        address newcomer = _newVerifiedSeeker(0xD9, keccak256("p9@mera"));
        assertEq(kite.identityOf(newcomer), keccak256("p9@mera"));
        vm.prank(admin);
        kite.registerChannel(3, "Koperasi Tiga", vm.addr(0xF3));
        (, address pubkey, bool active) = kite.channelOf(3);
        assertTrue(active);
        assertEq(pubkey, vm.addr(0xF3));
    }

    // ────────────────────────────────────────────────────────────────────
    // Reentrancy tier (US3) — research.md D13 rig: a MALICIOUS money rail
    // (the initializer's ausd argument) that re-enters from its own
    // transfer/transferFrom during real settlements. `nonReentrant` is
    // declared FIRST on both entry points, so the guard fires before any
    // other gate — every re-entry must revert, while the legit outer flow
    // still completes atomically.
    // ────────────────────────────────────────────────────────────────────

    struct ReenterRig {
        KiteCore kite;
        MaliciousAUSD token;
        address seeker;
        address backer;
        uint256 backerPk;
        bytes32 domain;
        uint256 id;
    }

    /// @dev A full KiteCore deployment on the malicious rail: identities,
    ///      channel, a 600e6 draft (P 600 / share 20% / cap 1.2×) and the
    ///      backer's standing approval.
    function _rig() internal returns (ReenterRig memory r) {
        MaliciousAUSD tok = new MaliciousAUSD();
        KiteCore impl = new KiteCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(KiteCore.initialize, (admin, relayer, orchestrator, pauser, address(tok), 60 days))
        );
        r.kite = KiteCore(address(proxy));
        r.token = tok;
        tok.aim(address(r.kite));

        r.seeker = vm.addr(0xD9);
        r.backer = vm.addr(0xDA);
        r.backerPk = 0xDA;
        vm.prank(relayer);
        r.kite.bindIdentity(r.seeker, keccak256("rs@mera"));
        vm.prank(relayer);
        r.kite.bindIdentity(r.backer, keccak256("rb@mera"));
        vm.prank(admin);
        r.kite.registerChannel(1, "Rig Mill", mill);

        r.domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KiteCore"),
                keccak256("1"),
                block.chainid,
                address(r.kite)
            )
        );

        Terms memory t =
            Terms({principal: 600e6, shareBps: 2000, capMult: 120, termEnd: uint64(vm.getBlockTimestamp() + 30 days), channelId: 1});
        vm.prank(r.seeker);
        r.id = r.kite.createISADraft(t, r.backer);

        tok.deal(r.backer, 600e6);
        tok.deal(mill, 20_000e6); // the channel funds settlements (D6)
        vm.prank(r.backer);
        tok.approve(address(r.kite), type(uint256).max);
        vm.prank(mill);
        tok.approve(address(r.kite), type(uint256).max);
    }

    function testReentrancy_ActivateWithPermit_Blocked() public {
        ReenterRig memory r = _rig();
        // Valid permit over the RAIL's own domain — the attacker rail allows all.
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                r.token.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, r.backer, address(r.kite), 600e6, r.token.nonces(r.backer), deadline))
            )
        );
        (uint8 v, bytes32 rv, bytes32 sv) = vm.sign(r.backerPk, digest);
        r.token.arm(true, abi.encodeWithSelector(ISAModule.activateWithPermit.selector, r.id, deadline, v, rv, sv));

        r.kite.activateWithPermit(r.id, deadline, v, rv, sv); // legit entry; hook fires mid-pull

        assertGt(r.token.attempts(), 0, "re-entry was attempted");
        assertEq(r.token.blocked(), r.token.attempts(), "EVERY re-entry hit the guard");
        ISA memory isa = r.kite.isaOf(r.id);
        assertEq(isa.status, STATUS_ACTIVE, "legit flow completed atomically anyway");
        assertEq(r.token.balanceOf(r.seeker), 600e6, "seeker paid exactly principal");
        assertEq(r.token.balanceOf(r.backer), 0, "backer paid exactly principal");
    }

    function testReentrancy_ReceiveIncome_Blocked() public {
        ReenterRig memory r = _rig();
        // Clean activation first (re-entry disarmed).
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                r.token.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, r.backer, address(r.kite), 600e6, r.token.nonces(r.backer), deadline))
            )
        );
        (uint8 v, bytes32 rv, bytes32 sv) = vm.sign(r.backerPk, digest);
        r.kite.activateWithPermit(r.id, deadline, v, rv, sv);
        assertEq(r.kite.isaOf(r.id).status, STATUS_ACTIVE);

        // The channel signs a real fact; the re-entry payload is typed garbage —
        // the guard must fire BEFORE the signature check even looks at it.
        bytes32 ref = keccak256("rig/1");
        bytes32 incomeDigest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                r.domain,
                keccak256(abi.encode(INCOME_TYPEHASH, uint64(1), r.id, ref, 1500e6, keccak256("r1")))
            )
        );
        (uint8 iv, bytes32 ir, bytes32 isig) = vm.sign(millPk, incomeDigest);
        r.token.arm(
            true,
            abi.encodeWithSelector(
                Stream.receiveIncome.selector, r.id, ref, uint256(1), bytes32(0), uint8(1), bytes32(0), bytes32(0)
            )
        );
        vm.prank(orchestrator);
        r.kite.receiveIncome(r.id, ref, 1500e6, keccak256("r1"), iv, ir, isig);

        assertGt(r.token.attempts(), 0, "re-entry was attempted");
        assertEq(r.token.blocked(), r.token.attempts(), "EVERY re-entry hit the guard");
        ISA memory isa = r.kite.isaOf(r.id);
        assertEq(isa.status, STATUS_ACTIVE);
        assertEq(isa.remaining, 420e6, "rig cap 720e6: 1500e6 x 20% = 300e6 diverted atomically");
    }

    // ── Upgrade tier (US3) — ADMIN is the sole upgrade authority ────────

    function testUpgrade_AdminOnly_UnauthorizedReverts() public {
        address v2 = address(new KiteCoreV2());
        vm.prank(relayer);
        _expectAccess(relayer, adminRole);
        kite.upgradeToAndCall(v2, "");
        address stranger = vm.addr(0xE5);
        vm.prank(stranger);
        _expectAccess(stranger, adminRole);
        kite.upgradeToAndCall(v2, "");
        // Nothing bricked by the failed attempts: ADMIN still can.
        vm.prank(admin);
        kite.upgradeToAndCall(v2, "");
        assertEq(KiteCoreV2(address(kite)).ping(), "v2");
    }

    function testUpgrade_StateSurvives_V2() public {
        uint256 id = _runTo(2); // live deal + reputation across four namespaces
        ISA memory before = kite.isaOf(id);
        KiteScoring.Profile memory prof = kite.profileOf(budi);
        address v2 = address(new KiteCoreV2()); // hoisted: a create in the args eats the prank

        vm.prank(admin);
        kite.upgradeToAndCall(v2, "");

        assertEq(KiteCoreV2(address(kite)).ping(), "v2", "new code is live");
        ISA memory after_ = kite.isaOf(id);
        assertEq(after_.remaining, before.remaining, "kite.isa survived");
        assertEq(after_.status, before.status);
        assertEq(after_.eventCount, before.eventCount);
        assertEq(kite.activeISA(budi), id, "active slot survived");
        assertEq(kite.profileOf(budi).totalISAs, prof.totalISAs, "kite.isa profiles survived");
        assertEq(kite.profileOf(budi).completed, prof.completed);
        assertEq(kite.profileOf(budi).qualEvents, prof.qualEvents);
        assertEq(kite.profileOf(budi).distinctBackers, prof.distinctBackers);
        assertEq(kite.scoreOf(budi), 58);
        assertTrue(kite.hasRole(relayerRole, relayer), "kite.governed roles survived");
        assertFalse(kite.paused());
        assertEq(kite.identityOf(budi), keccak256("budi@mera"), "kite.identity survived");
        assertEq(kite.ausd(), address(ausd), "money rail pointer survived");
        // And the settlement path still runs end-to-end on V2:
        vm.warp(vm.getBlockTimestamp() + 61 days);
        _settle(id, _day(12), 1500e6, keccak256("d2"));
        assertEq(kite.isaOf(id).remaining, 180e6);
    }

    function testUpgrade_ModuleNamespaces_Distinct() public pure {
        // The four ERC-7201 slots: nonzero and pairwise distinct — a copy-paste
        // collision would alias two modules' storage across upgrades.
        bytes32 governed = _erc7201("kite.governed");
        bytes32 identity = _erc7201("kite.identity");
        bytes32 isa = _erc7201("kite.isa");
        bytes32 stream = _erc7201("kite.stream");
        assertTrue(governed != bytes32(0));
        assertTrue(identity != bytes32(0));
        assertTrue(isa != bytes32(0));
        assertTrue(stream != bytes32(0));
        assertTrue(governed != identity);
        assertTrue(governed != isa);
        assertTrue(governed != stream);
        assertTrue(identity != isa);
        assertTrue(identity != stream);
        assertTrue(isa != stream);
    }

    /// @dev The ERC-7201 formula the modules use (same as OZ's StorageSlot
    ///      derivation): keccak256(abi.encode(uint256(keccak256(label)) - 1)) & ~0xff.
    function _erc7201(string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encode(uint256(keccak256(bytes(label))) - 1)) & ~bytes32(uint256(0xff));
    }

    // ── Init tier (US3) ──────────────────────────────────────────────────

    /// @notice The init-once parameters landed exactly as passed, and cannot
    ///         be changed: the only path back to `initialize` reverts
    ///         (Q1/A — the governed gap has NO setter, spec FR-016).
    function testInitialize_SetsRolesAssetAndGap() public {
        assertTrue(kite.hasRole(relayerRole, relayer), "RELAYER_ROLE at init");
        assertTrue(kite.hasRole(orchestratorRole, orchestrator), "ORCHESTRATOR_ROLE at init");
        assertTrue(kite.hasRole(pauserRole, pauser), "PAUSER at init");
        assertEq(kite.ausd(), address(ausd), "asset immutable at init");
        assertEq(kite.minEventGap(), 60 days, "gap set once, from the initializer argument");
        // Re-init with a DIFFERENT gap — the would-be change path — reverts.
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        kite.initialize(admin, relayer, orchestrator, pauser, address(ausd), 30 days);
    }

    // ── Governed-gap tier (Q1/A, Feature 004) — contractual names in
    //    specs/004.../contracts/deploy-seed-api.md ─────────────────────────

    /// @dev Re-points the suite's `ausd`/`kite` at a deployment whose governed
    ///      gap is `gapSec` — the demo configuration. Every fixture helper
    ///      (_draft/_activate/_settle) then works unchanged against it.
    function _deployWithGap(uint256 gapSec) internal {
        ausd = new MockAUSD(address(this));
        KiteCore impl = new KiteCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(KiteCore.initialize, (admin, relayer, orchestrator, pauser, address(ausd), gapSec))
        );
        kite = KiteCore(address(proxy));
        // The income-signature helpers sign over the domain of the LIVE proxy —
        // re-derive it or every fact verifies against the stale address.
        kiteDomain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KiteCore"),
                keccak256("1"),
                block.chainid,
                address(kite)
            )
        );
        ausd.transfer(haji, 5_000e6); // the backer pays principal at activation
        ausd.transfer(mill, 20_000e6);
        vm.prank(mill);
        ausd.approve(address(kite), type(uint256).max);
        vm.startPrank(relayer);
        kite.bindIdentity(budi, keccak256("budi@mera"));
        kite.bindIdentity(haji, keccak256("haji@mera"));
        vm.stopPrank();
        vm.prank(admin);
        kite.registerChannel(CHANNEL_ID, "Koperasi Mill", mill);
    }

    function testGap_MinEventGap_SetAtInit_NoSetter() public {
        _deployWithGap(90 days);
        assertEq(kite.minEventGap(), 90 days, "whatever init passed IS the value");
        // No setter exists: the raw selector call must revert (no fallback).
        (bool ok,) =
            address(kite).call(abi.encodeWithSelector(bytes4(keccak256("setMinEventGap(uint256)")), 1 days));
        assertFalse(ok, "no setter: the gap is init-once (FR-016)");
    }

    function testGap_Qualifying_At60Seconds_DemoDeployment() public {
        _deployWithGap(60 seconds); // the demo deployment (Q1/A)
        Terms memory t = _terms(600e6, 2000, 130, uint64(vm.getBlockTimestamp() + 365 days));
        uint256 id = _draft(budi, t, haji);
        _activate(id, hajiPk, haji);
        _settle(id, _day(1), 1500e6, keccak256("e1")); // first event: gap-free by definition
        vm.warp(vm.getBlockTimestamp() + 60 seconds); // exactly the demo bar — inclusive
        _settle(id, _day(2), 1500e6, keccak256("e2"));
        ISA memory isa = kite.isaOf(id);
        assertEq(isa.eventCount, 2, "60 s apart: both qualify at the demo gap");
        assertEq(isa.lastEventAt, vm.getBlockTimestamp());
    }

    function testGap_NonQualifying_At59Seconds_DemoDeployment() public {
        _deployWithGap(60 seconds);
        Terms memory t = _terms(600e6, 2000, 130, uint64(vm.getBlockTimestamp() + 365 days));
        uint256 id = _draft(budi, t, haji);
        _activate(id, hajiPk, haji);
        _settle(id, _day(1), 1500e6, keccak256("e1"));
        vm.warp(vm.getBlockTimestamp() + 59 seconds); // one second short of the bar
        _settle(id, _day(2), 1500e6, keccak256("e2"));
        ISA memory isa = kite.isaOf(id);
        assertEq(isa.eventCount, 1, "59 s apart: splits normally, no qualifying credit");
        assertEq(isa.remaining, 180e6, "780e6 - 300e6 - 300e6: the split happened, the credit did not");
    }
}

// ───────────────────────────────────────────────────────────────────────
// Reentrancy rig (research.md D13): the initializer's ausd argument IS the
// attack surface — a rail whose transfers re-enter KiteCore and COUNT what
// the guard blocks. `require`s nothing: the outer flow must complete.
// ───────────────────────────────────────────────────────────────────────
contract MaliciousAUSD {
    KiteCore internal kite;
    bool internal armed;
    bytes internal payload;
    uint256 public attempts;
    uint256 public blocked;
    mapping(address account => uint256) public balanceOf;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    constructor() {
        balanceOf[msg.sender] = 1_000_000e6;
    }

    function aim(address target) external {
        kite = KiteCore(target);
    }

    function arm(bool on, bytes calldata reentry) external {
        armed = on;
        payload = reentry;
    }

    function deal(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        _hook();
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        _hook();
        return true;
    }

    // Attacker-controlled rail: permits are free, the domain is arbitrary.
    function permit(address, address, uint256, uint256, uint8, bytes32, bytes32) external pure {}

    function DOMAIN_SEPARATOR() external pure returns (bytes32) {
        return keccak256("Kite reentrancy rig");
    }

    function nonces(address) external pure returns (uint256) {
        return 0;
    }

    function _hook() internal {
        if (!armed) return;
        attempts++;
        (bool ok, ) = address(kite).call(payload);
        if (!ok) ++blocked; // the guard fired — exactly what must happen
    }
}

/// @dev Dummy successor for the upgrade tier: new code, zero storage changes.
contract KiteCoreV2 is KiteCore {
    function ping() external pure returns (string memory) {
        return "v2";
    }
}
