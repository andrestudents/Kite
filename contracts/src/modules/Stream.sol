// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISAModule} from "./ISA.sol";

/// @title Stream — the PLAN §6.1 modules/Stream.
/// @notice `receiveIncome`: ORCHESTRATOR-only; the channel's signature is
///         verified ONCHAIN over an EIP-712 `IncomeEvent` binding
///         (channelId, isaId, purchaseRef, gross, salt) against the
///         registered pubkey (PLAN D7, constitution V, §6.4 #3); the fact is
///         single-use via the PLAN-literal eventHash registry PLUS a
///         per-channel purchaseRef guard (§6.4 #2's both clauses); the
///         atomic split is `KiteScoring.divert` (constitution III, §6.4 #1);
///         remaining == 0 auto-completes at cap (research.md D8).
/// @dev Owns the `kite.stream` ERC-7201 namespace (research.md D3). EIP-712
///      domain comes from KiteCore's EIP712Upgradeable ("KiteCore", "1").
abstract contract Stream is ISAModule {
    // ── Errors / events ─────────────────────────────────────────────────
    error Kite__BadChannelSignature(bytes32 digest, address recovered, address expected);
    error Kite__ChannelMismatch(uint64 signedChannelId, uint64 dealChannelId);
    error Kite__EventAlreadySettled(bytes32 eventHash);
    error Kite__TermEnded(uint256 isaId, uint64 termEnd);
    error Kite__InvalidGross();

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

    // ── Types ───────────────────────────────────────────────────────────
    /// @dev EIP-712 payload; `isaId` is bound so a compromised orchestrator
    ///      cannot route a genuine mill fact to a different deal on the same
    ///      channel (research.md D6).
    struct IncomeEvent {
        uint64 channelId;
        uint256 isaId;
        bytes32 purchaseRef;
        uint256 gross;
        bytes32 salt;
    }
    // (nested deliberately — consumed only inside this module tree; test
    // suites build the EIP-712 digest from the typehash + domain directly)

    /// @dev keccak256("IncomeEvent(uint64 channelId,uint256 isaId,bytes32 purchaseRef,uint256 gross,bytes32 salt)")
    bytes32 private constant _INCOME_EVENT_TYPEHASH =
        0x993e60ac070df4ed64c120feb264b7cc10bb416da565d78bea5a775c29b665bb;

    // ── Storage (ERC-7201: kite.stream) ─────────────────────────────────
    /// @custom:storage-location erc7201:kite.stream
    struct StreamStorage {
        // PLAN §6.2: eventHash = keccak256(abi.encode(channelId, purchaseRef, gross, salt))
        mapping(bytes32 eventHash => bool) eventHashes;
        // §6.4 #2 second clause: same purchaseRef never settles twice on its
        // channel, even under a fresh salt (research.md D6).
        mapping(uint64 channelId => mapping(bytes32 purchaseRef => bool)) settledRefs;
    }

    // keccak256(abi.encode(uint256(keccak256("kite.stream")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _STREAM_STORAGE_LOCATION =
        0xa7fa64eb4b3dc2ec22ad0449e3b5acdca4127eef8b7a421027cf592af92dee00;

    function _streamStorage() internal pure returns (StreamStorage storage $) {
        assembly {
            $.slot := _STREAM_STORAGE_LOCATION
        }
    }

    /// @notice The eventHash exactly as PLAN §6.2 defines it.
    function _eventHash(uint64 channelId, bytes32 purchaseRef, uint256 gross, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(channelId, purchaseRef, gross, salt)); // PLAN §6.2
    }
}
