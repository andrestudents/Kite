// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {KiteCore} from "../src/KiteCore.sol";
import {MockAUSD} from "../src/MockAUSD.sol";
import {Terms, ISA, STATUS_ACTIVE, STATUS_DRAFTED, STATUS_COMPLETED_CAPPED, STATUS_COMPLETED_AT_TERM, STATUS_CANCELLED} from "../src/modules/ISA.sol";

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
            abi.encodeCall(KiteCore.initialize, (admin, relayer, orchestrator, pauser, address(ausd)))
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
        uint256 deadline = block.timestamp + 1 hours;
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
        Terms memory t1 = _terms(600e6, 2000, 120, uint64(block.timestamp + 180 days));
        uint256 id1 = _draft(budi, t1, h1);
        _activate(id1, h1Pk, h1);
        vm.warp(block.timestamp + 61 days);
        _settle(id1, _day(1), 1800e6, keccak256("s1"));
        vm.warp(block.timestamp + 61 days);
        _settle(id1, _day(2), 1800e6, keccak256("s2"));
        assertEq(kite.isaOf(id1).status, STATUS_COMPLETED_CAPPED);

        // Deal 2 (backer h2): same shape.
        Terms memory t2 = _terms(600e6, 2000, 120, uint64(block.timestamp + 180 days));
        uint256 id2 = _draft(budi, t2, h2);
        _activate(id2, h2Pk, h2);
        vm.warp(block.timestamp + 61 days);
        _settle(id2, _day(3), 1800e6, keccak256("s3"));
        vm.warp(block.timestamp + 61 days);
        _settle(id2, _day(4), 1800e6, keccak256("s4"));
        assertEq(kite.isaOf(id2).status, STATUS_COMPLETED_CAPPED);

        // {2,2,4,2} → H 26 · C 6 · V 26 → 58 (PLAN 6.3)
        assertEq(kite.scoreOf(budi), 58);
        assertEq(kite.offerOf(budi), 1296e6);
    }

    /// @notice Drafts the 6.3 demo deal: P 600e6 / share 20% / cap 1.3× →
    ///         cap 780e6, 12-month term, channel 1, backer Pak Haji.
    function _demoDraft() internal returns (uint256 id) {
        Terms memory t = _terms(600e6, 2000, 130, uint64(block.timestamp + 365 days));
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
            vm.warp(block.timestamp + 61 days);
            _settle(id, _day(11), 1500e6, keccak256("d1"));
        }
        if (stage >= 3) {
            vm.warp(block.timestamp + 61 days);
            _settle(id, _day(12), 1500e6, keccak256("d2"));
        }
        if (stage >= 4) {
            vm.warp(block.timestamp + 61 days);
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

        vm.warp(block.timestamp + 61 days);
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

        vm.warp(block.timestamp + 61 days);
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

        vm.warp(block.timestamp + 61 days);
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

        vm.warp(block.timestamp + 61 days);
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
        Terms memory t = _terms(1000e6, 2000, 150, uint64(block.timestamp + 365 days));
        uint256 id = _draft(budi, t, haji);
        assertEq(kite.isaOf(id).remaining, 1500e6, "1000e6 x 150 / 100");
        assertEq(kite.isaOf(id).status, STATUS_DRAFTED);
    }
}
