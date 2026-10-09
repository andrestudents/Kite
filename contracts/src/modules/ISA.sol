// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {KiteScoring} from "../KiteScoring.sol";
import {Identity} from "./Identity.sol";

/// @dev Money-rail surface KiteCore needs (ERC-20 + EIP-2612 permit);
///      MockAUSD implements it (research.md D12/D13).
interface IAUSD {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

// ── Types (PLAN §6.2, field-for-field) ──────────────────────────────────

struct Terms {
    uint256 principal; // AUSD base units (6 dp) — constitution VI
    uint16 shareBps; // 1000..2000 (10–20%)
    uint16 capMult; // 120..150 (1.2–1.5×)
    uint64 termEnd; // unix seconds
    uint64 channelId; // the mill's channel
}

/// @dev status: 0 None · 1 Drafted · 2 Active · 3 CompletedCapped ·
///      4 CompletedAtTerm · 5 Cancelled (research.md D3).
struct ISA {
    Terms terms;
    address seeker;
    address backer;
    uint256 remaining; // cap left = principal × capMult / 100 at draft
    uint64 activatedAt;
    uint64 lastEventAt; // last QUALIFYING event (0 = none)
    uint64 eventCount; // qualifying events only (§6.3)
    uint8 status;
}

uint8 constant STATUS_NONE = 0;
uint8 constant STATUS_DRAFTED = 1;
uint8 constant STATUS_ACTIVE = 2;
uint8 constant STATUS_COMPLETED_CAPPED = 3;
uint8 constant STATUS_COMPLETED_AT_TERM = 4;
uint8 constant STATUS_CANCELLED = 5;

/// @title ISA — the PLAN §6.1 modules/ISA.
/// @notice Deal drafts with unwritable-unfairness bounds (PLAN D6, §6.4 #6),
///         one-tx activation (permit → pull principal → pay seeker, PLAN D5,
///         constitution III), pre-activation cancel, and the per-seeker
///         reputation profiles that update ONLY at completion (research.md
///         D8, §6.4 #7).
/// @dev Owns the `kite.isa` ERC-7201 namespace (research.md D3). Named
///      ISAModule to avoid colliding with the §6.2 `ISA` struct above.
abstract contract ISAModule is Identity {
    // ── Errors / events ─────────────────────────────────────────────────
    error Kite__NotVerified(address account);
    error Kite__ShareOutOfBounds(uint16 shareBps);
    error Kite__CapMultOutOfBounds(uint16 capMult);
    error Kite__TermTooLong(uint64 termEnd, uint64 maxTermEnd);
    error Kite__TermAlreadyEnded(uint64 termEnd);
    error Kite__PrincipalAboveMax(uint256 principal, uint256 maxP);
    error Kite__HasActiveISA(address seeker, uint256 activeIsaId);
    error Kite__NotDrafted(uint256 isaId, uint8 status);
    error Kite__NotActive(uint256 isaId, uint8 status);
    error Kite__NotSeekerOrBacker(uint256 isaId, address caller);
    error Kite__WrongBacker(uint256 isaId, address permitOwner);
    error Kite__ZeroPrincipal();

    event ISADrafted(uint256 indexed isaId, address indexed seeker, address indexed backer, Terms terms);
    event ISAActivated(uint256 indexed isaId, address indexed backer, uint256 principal);
    event ISACancelled(uint256 indexed isaId, address indexed by);
    event ISACompletedCapped(uint256 indexed isaId);
    event ISACompletedAtTerm(uint256 indexed isaId, uint256 forgiven);
    event ScoreChanged(address indexed seeker, uint8 oldScore, uint8 newScore);

    // ── Storage (ERC-7201: kite.isa) ────────────────────────────────────
    /// @custom:storage-location erc7201:kite.isa
    struct ISAStorage {
        mapping(uint256 isaId => ISA) isas;
        mapping(address seeker => uint256 isaId) activeISA; // 0 = none
        mapping(address seeker => KiteScoring.Profile) profiles;
        // distinctBackers support: first completed deal per (seeker, backer)? (research.md D8)
        mapping(address seeker => mapping(address backer => bool)) completedWithBacker;
        uint256 nextIsaId; // first id is 1; 0 never a valid id
    }

    // keccak256(abi.encode(uint256(keccak256("kite.isa")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _ISA_STORAGE_LOCATION =
        0x703f055c7159aded6a7c2eac2aa9665bf0e630528f7bdc19b3152ae57666f800;

    function _isaStorage() internal pure returns (ISAStorage storage $) {
        assembly {
            $.slot := _ISA_STORAGE_LOCATION
        }
    }
}
