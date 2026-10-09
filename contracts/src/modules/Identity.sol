// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Governed} from "./Governed.sol";

/// @title Identity — the PLAN §6.1 modules/Identity.
/// @notice One-to-one, immutable identityHash ↔ wallet bindings (PLAN D4,
///         §6.4 #5) and the channel registry with signing pubkeys (D7).
///         "Verified" = carries a bound hash (spec Assumptions).
/// @dev Owns the `kite.identity` ERC-7201 namespace (research.md D3).
abstract contract Identity is Governed {
    // ── Errors / events ─────────────────────────────────────────────────
    error Kite__IdentityAlreadyBound(address wallet, bytes32 identityHash);
    error Kite__HashAlreadyBound(bytes32 identityHash, address wallet);
    error Kite__ChannelExists(uint64 channelId);
    error Kite__UnknownChannel(uint64 channelId);
    error Kite__ChannelInactive(uint64 channelId);

    event IdentityBound(address indexed wallet, bytes32 indexed identityHash);
    event ChannelRegistered(uint64 indexed id, string name, address indexed pubkey);

    // ── Types ───────────────────────────────────────────────────────────
    /// @dev The signing pubkey address is also the funding account for the
    ///      MVP (research.md D6); `active` gates new drafts (write-once true
    ///      in the MVP — deactivation setter is roadmap, analyze I3).
    struct Channel {
        string name;
        address pubkey;
        bool active;
    }

    // ── Storage (ERC-7201: kite.identity) ───────────────────────────────
    /// @custom:storage-location erc7201:kite.identity
    struct IdentityStorage {
        mapping(address wallet => bytes32 identityHash) identityOf;
        mapping(bytes32 identityHash => address wallet) walletOfIdentity;
        mapping(uint64 id => Channel) channels;
    }

    // keccak256(abi.encode(uint256(keccak256("kite.identity")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _IDENTITY_STORAGE_LOCATION =
        0xa16b848ab310b968ee9451d8baab29b919dd718da60cfb1f8e6b0db2f2e25a00;

    function _identityStorage() internal pure returns (IdentityStorage storage $) {
        assembly {
            $.slot := _IDENTITY_STORAGE_LOCATION
        }
    }

    // ── External surface (PLAN §6.1) ────────────────────────────────────
    /// @notice RELAYER attests a human: binds identityHash ↔ wallet ONE-TO-ONE,
    ///         both directions, immutably (§6.4 #5 — no unbind, no rebind).
    function bindIdentity(address wallet, bytes32 identityHash) external onlyRole(RELAYER_ROLE) {
        IdentityStorage storage $ = _identityStorage();
        if ($.identityOf[wallet] != bytes32(0)) revert Kite__IdentityAlreadyBound(wallet, identityHash);
        if ($.walletOfIdentity[identityHash] != address(0)) revert Kite__HashAlreadyBound(identityHash, wallet);
        $.identityOf[wallet] = identityHash;
        $.walletOfIdentity[identityHash] = wallet;
        emit IdentityBound(wallet, identityHash);
    }

    /// @notice ADMIN registers a channel (the income source) and its signing
    ///         pubkey. Write-once in the MVP: a used id can never be
    ///         repointed (analyze I3) — pubkey swaps would silently redirect
    ///         the settlement trust root.
    function registerChannel(uint64 id, string calldata name, address pubkey)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        IdentityStorage storage $ = _identityStorage();
        if ($.channels[id].active) revert Kite__ChannelExists(id);
        $.channels[id] = Channel({name: name, pubkey: pubkey, active: true});
        emit ChannelRegistered(id, name, pubkey);
    }
}
