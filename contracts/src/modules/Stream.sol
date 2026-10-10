// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {KiteScoring} from "../KiteScoring.sol";
import {ISAModule, ISA, STATUS_ACTIVE, STATUS_COMPLETED_CAPPED} from "./ISA.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

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
abstract contract Stream is ISAModule, EIP712Upgradeable {
    // ── Errors / events ─────────────────────────────────────────────────
    error Kite__BadChannelSignature(bytes32 digest, address recovered, address expected);
    error Kite__ChannelMismatch(uint64 signedChannelId, uint64 dealChannelId);
    error Kite__EventAlreadySettled(bytes32 eventHash);
    error Kite__TermEnded(uint256 isaId, uint64 termEnd);

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

    /// @notice ORCHESTRATOR reconciliation signal (WF-3 Reconcile, PLAN §7.5):
    ///         a console figure disagreed with the settled fact. Emits ONLY —
    ///         zero state change (§6.2; testRole flagMismatch asserts storage
    ///         and balances byte-identical).
    event MismatchFlagged(uint256 indexed day, uint256 expected, uint256 actual);

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

    /// @dev One submitted income fact, bundling the scalar args so internal
    ///      helpers take one memory slot instead of five (old codegen stack
    ///      limit; no --via-ir in this build).
    struct Fact {
        uint256 isaId;
        uint64 dealChannel;
        bytes32 purchaseRef;
        uint256 gross;
        bytes32 salt;
    }

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

    // ── External surface (PLAN §6.1; research.md D6/D7) ─────────────────
    /// @notice Settle one harvest: ORCHESTRATOR transports a channel-signed
    ///         fact; KiteCore verifies the signature ONCHAIN against the
    ///         registered pubkey, blocks replay twice over, pulls the gross
    ///         from the channel, and splits atomically via KiteScoring.divert
    ///         (constitution III: backer + seeker paid in THIS tx). Never
    ///         pause-gated (constitution VII). Zero-gross facts settle 0/0 and
    ///         never qualify (research.md D9) — a failed harvest is recorded,
    ///         not punished.
    function receiveIncome(uint256 isaId, bytes32 purchaseRef, uint256 gross, bytes32 salt, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        onlyRole(ORCHESTRATOR_ROLE)
    {
        ISAStorage storage $ = _isaStorage();
        ISA storage isa = $.isas[isaId];
        if (isa.status != STATUS_ACTIVE) revert Kite__NotActive(isaId, isa.status);
        // D7 hard stop: income after termEnd reverts even if nobody has
        // called completeAtTerm yet. Equality allowed (inclusive, PLAN §6.3).
        if (block.timestamp > isa.terms.termEnd) revert Kite__TermEnded(isaId, isa.terms.termEnd);

        uint64 dealChannel = isa.terms.channelId;
        address channelKey = _verifyChannelFact(dealChannel, isaId, purchaseRef, gross, salt, v, r, s);
        Fact memory f = Fact({isaId: isaId, dealChannel: dealChannel, purchaseRef: purchaseRef, gross: gross, salt: salt});
        _settleFact(isa, f, channelKey);
    }

    /// @dev Onchain signature verification (PLAN D7): the fact is EIP-712
    ///      over KiteCore's OWN domain ("KiteCore","1"); the channelId is
    ///      bound INTO the payload by construction, so a compromised
    ///      orchestrator cannot route a genuine mill fact to a foreign deal
    ///      (research.md D6). Returns the expected channel key.
    function _verifyChannelFact(uint64 dealChannel, uint256 isaId, bytes32 purchaseRef, uint256 gross, bytes32 salt, uint8 v, bytes32 r, bytes32 s)
        internal
        view
        returns (address channelKey)
    {
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(_INCOME_EVENT_TYPEHASH, dealChannel, isaId, purchaseRef, gross, salt))
        );
        channelKey = _identityStorage().channels[dealChannel].pubkey;
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == channelKey) return channelKey;
        uint64 signedChannel = _identityStorage().channelIdByPubkey[recovered];
        if (signedChannel != 0) revert Kite__ChannelMismatch(signedChannel, dealChannel);
        revert Kite__BadChannelSignature(digest, recovered, channelKey);
    }

    /// @dev The settlement tail: replay guard, pull, atomic split, qualifying
    ///      bookkeeping, event, and the cap auto-complete. Split from
    ///      {receiveIncome} only to keep both frames out of stack-too-deep
    ///      territory (no --via-ir; the old codegen limit is 16 slots).
    function _settleFact(ISA storage isa, Fact memory f, address channelKey) internal {
        // §6.4 #2, both clauses: the exact tuple never repeats AND a
        // purchaseRef never settles twice on its channel even under a fresh
        // salt (research.md D6). Scope-blocked so its locals die before the
        // money section (old codegen stack limit — no --via-ir).
        {
            StreamStorage storage st = _streamStorage();
            bytes32 eventHash = _eventHash(f.dealChannel, f.purchaseRef, f.gross, f.salt);
            if (st.eventHashes[eventHash] || st.settledRefs[f.dealChannel][f.purchaseRef]) {
                revert Kite__EventAlreadySettled(eventHash);
            }
            st.eventHashes[eventHash] = true;
            st.settledRefs[f.dealChannel][f.purchaseRef] = true;
        }

        // The channel key is ALSO the funding account in the MVP (D6): pull
        // the gross, then divert atomically — the contract never holds a
        // balance across transactions (§6.4 #9).
        _isaStorage().ausd.transferFrom(channelKey, address(this), f.gross);
        (uint256 toBacker, uint256 toSeeker) = KiteScoring.divert(f.gross, isa.terms.shareBps, isa.remaining);
        _isaStorage().ausd.transfer(isa.backer, toBacker);
        _isaStorage().ausd.transfer(isa.seeker, toSeeker);
        isa.remaining -= toBacker;

        // Qualifying bookkeeping (§6.3): gap >= the governed minEventGap (set
        // at init — Q1/A) AND gross >= 10% of principal; non-qualifying events
        // still split, they count toward nothing. Profiles update ONLY at
        // completion (research.md D8).
        bool qualifying =
            KiteScoring.isQualifyingEvent(isa.lastEventAt, block.timestamp, f.gross, isa.terms.principal, minEventGap());
        if (qualifying) {
            isa.lastEventAt = uint64(block.timestamp);
            isa.eventCount++;
        }

        emit IncomeSettled(
            f.isaId, f.dealChannel, f.purchaseRef, f.gross, toBacker, toSeeker, isa.remaining, qualifying
        );

        // Cap reached exactly: auto-complete in the SAME tx (research.md D8).
        if (isa.remaining == 0) {
            _completeInternal(f.isaId, isa, STATUS_COMPLETED_CAPPED, 0);
        }
    }

    // ── Reconciliation (PLAN §6.1 flagMismatch) ─────────────────────────
    /// @notice ORCHESTRATOR flags a console-vs-ledger discrepancy. Emits
    ///         ONLY — the contract holds no dispute state; resolution is an
    ///         offchain/operator concern for the MVP.
    function flagMismatch(uint256 day, uint256 expected, uint256 actual) external onlyRole(ORCHESTRATOR_ROLE) {
        emit MismatchFlagged(day, expected, actual);
    }
}
