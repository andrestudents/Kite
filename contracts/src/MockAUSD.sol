// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title MockAUSD — Demo Tool
/// @notice Testnet stand-in for the AUSD settlement asset (research.md D12,
///         PLAN Q1): ERC-20 with 6 decimals (integer base units everywhere —
///         constitution VI), EIP-2612 `permit` and the EIP-3009
///         `transferWithAuthorization` gasless path, mirroring the real
///         asset's interface so application code is identical when swapped.
///         NOT proxied; mints a fixed supply once to `initialHolder` (no
///         later owner-mint, mirroring the immutable real asset).
/// @dev EIP-3009 is hand-rolled (not in OZ) against the EIP text: EIP-712
///      domain "AUSD"/"1" shared with ERC20Permit's, single-use
///      authorization nonces per authorizer.
contract MockAUSD is ERC20, ERC20Permit {
    // ── EIP-3009 errors ─────────────────────────────────────────────────
    error AuthorizationUsed(address authorizer, bytes32 nonce);
    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error AuthorizationInvalidSigner();

    uint256 public constant INITIAL_SUPPLY = 1_000_000e6; // 1,000,000 AUSD (6 dp)

    /// @dev keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)") — EIP-3009 §Appendix (verified against cast)
    bytes32 private constant _TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    /// @dev authorizer → nonce → used (EIP-3009: single-use forever)
    mapping(address authorizer => mapping(bytes32 nonce => bool)) private _authorizationUsed;

    constructor(address initialHolder) ERC20("AUSD", "AUSD") ERC20Permit("AUSD") {
        _mint(initialHolder, INITIAL_SUPPLY);
    }

    /// @notice 6 decimals — AUSD base units (constitution VI).
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice EIP-3009 gasless transfer: `from` signs; anyone (the relayer)
    ///         executes. Valid on [validAfter, validBefore); single-use.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s);
    }

    // ── Internal (shared by the public entrypoint; tests target it) ─────
    function _transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal {
        if (block.timestamp < validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(_TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce))
        );
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0) || recovered != from) revert AuthorizationInvalidSigner();

        if (_authorizationUsed[from][nonce]) revert AuthorizationUsed(from, nonce);
        _authorizationUsed[from][nonce] = true;

        _transfer(from, to, value);
    }

    function _update(address from, address to, uint256 value) internal override(ERC20) {
        super._update(from, to, value);
    }
}
