// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {MockAUSD} from "../src/MockAUSD.sol";

/// @notice Acceptance suite for MockAUSD — the money rail (research.md D12):
///         6-decimal ERC-20 with EIP-2612 permit and the EIP-3009 gasless
///         transfer authorization. Test names are contractual:
///         specs/003-kitecore-mockausd/contracts/kitecore-api.md.
/// @dev All money is AUSD base units (6 dp) — constitution VI.
contract MockAUSDTest is Test {
    MockAUSD internal ausd;

    uint256 internal constant HOLDER_PK = 0xA11CE;
    address internal holder;
    address internal recipient = makeAddr("recipient");
    address internal relayer = makeAddr("relayer");

    uint256 internal constant AMOUNT = 250e6;

    // EIP-712 domain of MockAUSD: name "AUSD", version "1", this chain.
    bytes32 internal domainSeparator;

    function setUp() public {
        holder = vm.addr(HOLDER_PK);
        ausd = new MockAUSD(holder);
        domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AUSD"),
                keccak256("1"),
                block.chainid,
                address(ausd)
            )
        );
        assertEq(domainSeparator, ausd.DOMAIN_SEPARATOR()); // domain mirrors ERC20Permit's
    }

    /// @dev EIP-712 digest for the EIP-3009 TransferWithAuthorization payload.
    function _authDigest(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (bytes32) {
        bytes32 typehash =
            keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
        bytes32 structHash = keccak256(abi.encode(typehash, from, to, value, validAfter, validBefore, nonce));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    /// @dev EIP-712 digest for the EIP-2612 Permit payload.
    function _permitDigest(address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                spender,
                value,
                ausd.nonces(owner),
                deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    // ── Tier: mock ──────────────────────────────────────────────────────

    function testMock_Decimals_Six() public view {
        assertEq(ausd.decimals(), 6); // constitution VI
        assertEq(ausd.symbol(), "AUSD");
        assertEq(ausd.totalSupply(), ausd.INITIAL_SUPPLY());
        assertEq(ausd.balanceOf(holder), 1_000_000e6); // minted once, to holder only
    }

    function testMock_Permit_UnlocksPull() public {
        // The funding-leg primitive (research.md D5): holder signs, any
        // spender (here `relayer`) pulls the exact value without gas from
        // the holder.
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_PK, _permitDigest(holder, relayer, AMOUNT, deadline));
        ausd.permit(holder, relayer, AMOUNT, deadline, v, r, s);
        assertEq(ausd.allowance(holder, relayer), AMOUNT);
        vm.prank(relayer);
        ausd.transferFrom(holder, recipient, AMOUNT);
        assertEq(ausd.balanceOf(recipient), AMOUNT);
    }

    function testMock_Permit_Expired_Reverts() public {
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_PK, _permitDigest(holder, relayer, AMOUNT, deadline));
        vm.expectRevert(abi.encodeWithSelector(ERC20Permit.ERC2612ExpiredSignature.selector, deadline));
        ausd.permit(holder, relayer, AMOUNT, deadline, v, r, s);
    }

    function testMock_Permit_ReplayedNonce_Reverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOLDER_PK, _permitDigest(holder, relayer, AMOUNT, deadline));
        ausd.permit(holder, relayer, AMOUNT, deadline, v, r, s);
        // OZ builds the structHash with the ALREADY-CONSUMED nonce, so the
        // replay surfaces as a signer mismatch over the new hash, not a
        // nonce error: recovered(old sig over nonce-1 hash) != holder.
        bytes32 digestAtNonce1 = _permitDigest(holder, relayer, AMOUNT, deadline);
        vm.expectRevert(
            abi.encodeWithSelector(
                ERC20Permit.ERC2612InvalidSigner.selector, ecrecover(digestAtNonce1, v, r, s), holder
            )
        );
        ausd.permit(holder, relayer, AMOUNT, deadline, v, r, s);
    }

    function testMock_Permit_ForgedSignature_Reverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = _permitDigest(holder, relayer, AMOUNT, deadline);
        // Signed by an impostor key, submitted as if from `holder`.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, digest);
        // OZ 5.7 shape: ERC2612InvalidSigner(recoveredSigner, owner).
        vm.expectRevert(
            abi.encodeWithSelector(ERC20Permit.ERC2612InvalidSigner.selector, ecrecover(digest, v, r, s), holder)
        );
        ausd.permit(holder, relayer, AMOUNT, deadline, v, r, s);
    }

    function testMock_TransferWithAuthorization_GaslessSend() public {
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("auth-1");
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(HOLDER_PK, _authDigest(holder, recipient, AMOUNT, validAfter, validBefore, nonce));
        // The RELAYER executes; the holder never pays gas (constitution I).
        vm.prank(relayer);
        ausd.transferWithAuthorization(holder, recipient, AMOUNT, validAfter, validBefore, nonce, v, r, s);
        assertEq(ausd.balanceOf(recipient), AMOUNT);
        assertEq(ausd.balanceOf(holder), 1_000_000e6 - AMOUNT);
    }

    function testMock_TransferWithAuthorization_ReplayedNonce_Reverts() public {
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("auth-2");
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(HOLDER_PK, _authDigest(holder, recipient, AMOUNT, validAfter, validBefore, nonce));
        vm.prank(relayer);
        ausd.transferWithAuthorization(holder, recipient, AMOUNT, validAfter, validBefore, nonce, v, r, s);
        vm.expectRevert(abi.encodeWithSelector(MockAUSD.AuthorizationUsed.selector, holder, nonce));
        vm.prank(relayer);
        ausd.transferWithAuthorization(holder, recipient, AMOUNT, validAfter, validBefore, nonce, v, r, s);
    }

    function testMock_TransferWithAuthorization_Expired_Reverts() public {
        uint256 validBefore = block.timestamp; // valid on [after, before) → already expired
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(HOLDER_PK, _authDigest(holder, recipient, AMOUNT, 0, validBefore, keccak256("auth-3")));
        vm.expectRevert(MockAUSD.AuthorizationExpired.selector);
        ausd.transferWithAuthorization(holder, recipient, AMOUNT, 0, validBefore, keccak256("auth-3"), v, r, s);
    }

    function testMock_TransferWithAuthorization_NotYetValid_Reverts() public {
        uint256 validAfter = block.timestamp + 1; // not yet reachable
        uint256 validBefore = validAfter + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(HOLDER_PK, _authDigest(holder, recipient, AMOUNT, validAfter, validBefore, keccak256("auth-4")));
        vm.expectRevert(MockAUSD.AuthorizationNotYetValid.selector);
        ausd.transferWithAuthorization(holder, recipient, AMOUNT, validAfter, validBefore, keccak256("auth-4"), v, r, s);
    }

    function testMock_TransferWithAuthorization_ForgedSignature_Reverts() public {
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("auth-5");
        // Impostor signature; submitted with `holder` as the authorizer.
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(0xBAD, _authDigest(holder, recipient, AMOUNT, validAfter, validBefore, nonce));
        vm.expectRevert(MockAUSD.AuthorizationInvalidSigner.selector);
        ausd.transferWithAuthorization(holder, recipient, AMOUNT, validAfter, validBefore, nonce, v, r, s);
    }
}
