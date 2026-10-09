// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {KiteScoring} from "../KiteScoring.sol";
import {Identity} from "./Identity.sol";
// OZ 5.x guard state is TRANSIENT storage — the non-upgradeable guard is
// upgrade-safe and shares one instance through the KiteCore diamond.
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Money-rail surface KiteCore needs (ERC-20 + EIP-2612 permit);
///      MockAUSD implements it (research.md D12/D13). DOMAIN_SEPARATOR +
///      nonces let KiteCore pre-verify the permit and raise Kite__WrongBacker
///      instead of letting OZ's InvalidSigner mask the real problem.
interface IAUSD {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonces(address owner) external view returns (uint256);
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
abstract contract ISAModule is Identity, ReentrancyGuard {
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
        IAUSD ausd; // the money rail, injected at init (research.md D13); lives in
        // this namespace because BOTH ISA (permit/pull/pay) and Stream (pull
        // gross) — both below ISAModule — need it, and ERC-7201 forbids plain
        // upgradeable state outside a namespace
    }

    // keccak256(abi.encode(uint256(keccak256("kite.isa")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _ISA_STORAGE_LOCATION =
        0x703f055c7159aded6a7c2eac2aa9665bf0e630528f7bdc19b3152ae57666f800;

    function _isaStorage() internal pure returns (ISAStorage storage $) {
        assembly {
            $.slot := _ISA_STORAGE_LOCATION
        }
    }

    // ── §6.2 parameters (testnet; PLAN §6.2) ────────────────────────────
    uint16 private constant MIN_SHARE_BPS = 1000;
    uint16 private constant MAX_SHARE_BPS = 2000;
    uint16 private constant MIN_CAP_MULT = 120;
    uint16 private constant MAX_CAP_MULT = 150;
    /// @dev PLAN MAX_TERM "24 months" as an integer onchain encoding: 730
    ///      days, INCLUSIVE at the bound (data-model.md: ≤ now + 24 mo).
    uint64 private constant MAX_TERM = 730 days;

    // ── External surface (PLAN §6.1; research.md D4) ────────────────────
    /// @notice The seeker drafts a DIRECTED deal: caller is the seeker, the
    ///         backer is named. Fairness is physics — every out-of-bounds
    ///         term reverts AT CREATION (PLAN D6, §6.4 #6), so a predatory
    ///         deal is not forbidden, it is unwritable.
    function createISADraft(Terms calldata terms, address backer)
        external
        whenNotPaused
        returns (uint256 id)
    {
        IdentityStorage storage ident = _identityStorage();
        ISAStorage storage $ = _isaStorage();
        address seeker = msg.sender;

        if (terms.shareBps < MIN_SHARE_BPS || terms.shareBps > MAX_SHARE_BPS) {
            revert Kite__ShareOutOfBounds(terms.shareBps);
        }
        if (terms.capMult < MIN_CAP_MULT || terms.capMult > MAX_CAP_MULT) {
            revert Kite__CapMultOutOfBounds(terms.capMult);
        }
        if (terms.termEnd > block.timestamp + MAX_TERM) {
            revert Kite__TermTooLong(terms.termEnd, uint64(block.timestamp + MAX_TERM));
        }
        if (terms.termEnd <= block.timestamp) revert Kite__TermAlreadyEnded(terms.termEnd);
        if (terms.principal == 0) revert Kite__ZeroPrincipal();
        uint256 maxP = KiteScoring.offerOf(KiteScoring.score($.profiles[seeker]));
        if (terms.principal > maxP) revert Kite__PrincipalAboveMax(terms.principal, maxP);
        _channelActive(ident, terms.channelId); // reverts Unknown/Inactive itself
        if ($.activeISA[seeker] != 0) revert Kite__HasActiveISA(seeker, $.activeISA[seeker]);
        if (ident.identityOf[seeker] == bytes32(0)) revert Kite__NotVerified(seeker);
        if (ident.identityOf[backer] == bytes32(0)) revert Kite__NotVerified(backer);

        id = ++$.nextIsaId; // first id is 1; 0 never a valid id
        $.isas[id] = ISA({
            terms: terms,
            seeker: seeker,
            backer: backer,
            remaining: (terms.principal * terms.capMult) / 100, // cap fixed AT DRAFT
            activatedAt: 0,
            lastEventAt: 0,
            eventCount: 0,
            status: STATUS_DRAFTED
        });
        emit ISADrafted(id, seeker, backer, terms);
    }

    /// @dev keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")
    bytes32 internal constant _PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    // ── External surface (PLAN §6.1; research.md D5) ────────────────────
    /// @notice ONE tx: permit → pull exactly principal → pay exactly principal
    ///         to the seeker (constitution III). `msg.sender` is unrestricted —
    ///         the backer's signature IS the authorization (PLAN D11). Atomic:
    ///         any revert leaves the deal Drafted, nothing moved.
    function activateWithPermit(uint256 isaId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        whenNotPaused
    {
        ISAStorage storage $ = _isaStorage();
        ISA storage isa = $.isas[isaId];
        if (isa.status != STATUS_DRAFTED) revert Kite__NotDrafted(isaId, isa.status);

        uint256 principal = isa.terms.principal;
        // The permit is verified by THE TOKEN over ITS domain (research.md D5);
        // we pre-recover so a signature by anyone but the NAMED backer fails
        // as Kite__WrongBacker, not as an opaque OZ InvalidSigner. The permit
        // call itself re-verifies; its OZ errors bubble (expiry, used nonce).
        bytes32 permitHash = keccak256(
            abi.encode(_PERMIT_TYPEHASH, isa.backer, address(this), principal, $.ausd.nonces(isa.backer), deadline)
        );
        address recovered =
            ecrecover(keccak256(abi.encodePacked("\x19\x01", $.ausd.DOMAIN_SEPARATOR(), permitHash)), v, r, s);
        if (recovered != isa.backer) revert Kite__WrongBacker(isaId, recovered);

        $.ausd.permit(isa.backer, address(this), principal, deadline, v, r, s);
        $.ausd.transferFrom(isa.backer, address(this), principal);
        $.ausd.transfer(isa.seeker, principal);

        isa.status = STATUS_ACTIVE;
        isa.activatedAt = uint64(block.timestamp);
        $.activeISA[isa.seeker] = isaId;
        emit ISAActivated(isaId, isa.backer, principal);
    }

    /// @notice Pre-activation cancel, by either party, ONLY while Drafted.
    ///         Deliberately NOT pause-gated: pause blocks new risk (draft/
    ///         activate) — cancellation only REMOVES risk (constitution VII).
    function cancelDraft(uint256 isaId) external {
        ISAStorage storage $ = _isaStorage();
        ISA storage isa = $.isas[isaId];
        if (isa.status != STATUS_DRAFTED) revert Kite__NotDrafted(isaId, isa.status);
        if (msg.sender != isa.seeker && msg.sender != isa.backer) {
            revert Kite__NotSeekerOrBacker(isaId, msg.sender);
        }
        isa.status = STATUS_CANCELLED;
        emit ISACancelled(isaId, msg.sender);
    }

    /// @dev Requires the channel to exist AND be active (Identity stores
    ///      `active`; a never-registered id is Unknown, a registered-but-
    ///      inactive id is Inactive — analyze I3: no deactivation setter in
    ///      the MVP, so Inactive is defensive).
    function _channelActive(IdentityStorage storage ident, uint64 channelId) internal view {
        if (!ident.channels[channelId].active) {
            if (ident.channels[channelId].pubkey == address(0)) {
                revert Kite__UnknownChannel(channelId);
            }
            revert Kite__ChannelInactive(channelId);
        }
    }
}
