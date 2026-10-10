// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/// @title Governed — the PLAN §6.1 modules/Governed.
/// @notice Roles (ADMIN, RELAYER_ROLE, ORCHESTRATOR_ROLE, PAUSER) and the
///         ASYMMETRIC pause (PLAN §6.2): `pause()` blocks ONLY the new-risk
///         entry points (draft/activate — they opt in via {whenNotPaused});
///         it MUST NEVER block `receiveIncome` or `completeAtTerm`
///         (constitution VII, PLAN §6.4 #10). Upgrade authority is ADMIN.
/// @dev Owns the `kite.governed` ERC-7201 namespace (research.md D3).
abstract contract Governed is Initializable, AccessControlUpgradeable {
    // ── Roles (PLAN §6.1/§6.2) ──────────────────────────────────────────
    /// @dev ADMIN == AccessControl's DEFAULT_ADMIN_ROLE (grants/revokes all,
    ///      sole upgrade authority — spec FR-001).
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant ORCHESTRATOR_ROLE = keccak256("ORCHESTRATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ── Errors / events ─────────────────────────────────────────────────
    error Kite__Paused();
    error Kite__ZeroGap();
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    // ── Storage (ERC-7201: kite.governed) ───────────────────────────────
    /// @custom:storage-location erc7201:kite.governed
    struct GovernedStorage {
        bool paused;
        // §6.2 qualifying window in seconds, set ONCE at initialize() —
        // protocol value 60 days, demo deployment 60 s (PLAN §6.2
        // clarification, Feature 004 Q1/A). NO SETTER: init-once like the
        // asset, so the score-integrity knob can never turn (spec FR-016).
        uint256 minEventGap;
    }

    // keccak256(abi.encode(uint256(keccak256("kite.governed")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _GOVERNED_STORAGE_LOCATION =
        0xda5af543a99ad6af65d0fa74e83e97304e3f518e4f033dfa64ddeffc1022bf00;

    function _governedStorage() private pure returns (GovernedStorage storage $) {
        assembly {
            $.slot := _GOVERNED_STORAGE_LOCATION
        }
    }

    // ── Init ────────────────────────────────────────────────────────────
    function __Governed_init(
        address admin,
        address relayer,
        address orchestrator,
        address pauser,
        uint256 minEventGapSec
    ) internal onlyInitializing {
        if (minEventGapSec == 0) revert Kite__ZeroGap();
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin); // ADMIN (spec FR-001)
        _grantRole(RELAYER_ROLE, relayer);
        _grantRole(ORCHESTRATOR_ROLE, orchestrator);
        _grantRole(PAUSER_ROLE, pauser);
        _governedStorage().minEventGap = minEventGapSec; // init-once (Q1/A)
    }

    // ── Pause (asymmetric — PLAN §6.2, constitution VII) ────────────────
    /// @dev Blocks ONLY callers that opt in via {whenNotPaused}: exactly
    ///      createISADraft and activateWithPermit (research.md D10).
    modifier whenNotPaused() {
        if (_governedStorage().paused) revert Kite__Paused();
        _;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _governedStorage().paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _governedStorage().paused = false;
        emit Unpaused(msg.sender);
    }

    function paused() public view returns (bool) {
        return _governedStorage().paused;
    }

    /// @notice The configured qualifying window in seconds (PLAN §6.2
    ///         MIN_EVENT_GAP as a governed parameter, Q1/A). Init-once —
    ///         deliberately NO setter (spec FR-016): the disclosure story is
    ///         "born with this value, nothing can change it".
    function minEventGap() public view returns (uint256) {
        return _governedStorage().minEventGap;
    }
}
