// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
// OZ 5.x: ReentrancyGuard's state is TRANSIENT storage, so the non-upgradeable
// guard is upgrade-safe (no ReentrancyGuardUpgradeable exists in 5.7; no init).
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {KiteScoring} from "./KiteScoring.sol";
import {Governed} from "./modules/Governed.sol";
import {Identity} from "./modules/Identity.sol";
import {ISAModule, Terms, ISA, IAUSD} from "./modules/ISA.sol";
import {Stream} from "./modules/Stream.sol";
import {Completion} from "./modules/Completion.sol";

/// @title KiteCore
/// @notice The PLAN §6.1 settlement contract: ONE UUPS proxy implementation
///         composed of the five ERC-7201 namespaced modules (research.md
///         D2/D3). The contract is the only authority for score, limits and
///         ISA state — everything else is a projection (constitution IV).
///         All money is integers in AUSD base units, 6 decimals
///         (constitution VI).
/// @dev External surface per specs/003.../contracts/kitecore-api.md. Roles:
///      RELAYER binds identities; ORCHESTRATOR submits signed income facts,
///      flags mismatches; PAUSER pauses (asymmetrically — receiveIncome and
///      completeAtTerm are NEVER blocked); ADMIN grants roles and upgrades.
///      RELAYER_ROLE/ORCHESTRATOR_ROLE can never move user funds beyond the
///      PLAN §6.2 functions (§6.4 #12).
contract KiteCore is Initializable, Governed, UUPSUpgradeable, EIP712Upgradeable, ReentrancyGuard, Completion {
    // ── Errors ──────────────────────────────────────────────────────────
    error Kite__ZeroAddress();

    // ── Storage constant for views ──────────────────────────────────────
    /// @dev The AUSD money rail, injected at initialization (research.md
    ///      D13) so tests can wire a malicious token for reentrancy proofs.
    IAUSD private _ausd;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address relayer, address orchestrator, address pauser, address ausd)
        external
        initializer
    {
        if (admin == address(0) || relayer == address(0) || orchestrator == address(0) || pauser == address(0) || ausd == address(0))
        {
            revert Kite__ZeroAddress();
        }
        __Governed_init(admin, relayer, orchestrator, pauser);
        // UUPS has no init in OZ 5.x (implementation slot is ERC-1967, set at proxy deploy)
        __EIP712_init("KiteCore", "1"); // research.md D6/D12: domain mirrors app signatures
        _ausd = IAUSD(ausd);
    }

    // ── Views (constitution IV: recomputable from public state) ─────────
    function ausd() external view returns (address) {
        return address(_ausd);
    }

    function isaOf(uint256 isaId) external view returns (ISA memory) {
        return _isaStorage().isas[isaId];
    }

    function profileOf(address seeker) external view returns (KiteScoring.Profile memory) {
        return _isaStorage().profiles[seeker];
    }

    function scoreOf(address seeker) external view returns (uint8) {
        return KiteScoring.score(_isaStorage().profiles[seeker]);
    }

    function offerOf(address seeker) external view returns (uint256) {
        return KiteScoring.offerOf(KiteScoring.score(_isaStorage().profiles[seeker]));
    }

    function channelOf(uint64 id)
        external
        view
        returns (string memory name, address pubkey, bool active)
    {
        Identity.Channel storage c = _identityStorage().channels[id];
        return (c.name, c.pubkey, c.active);
    }

    function identityOf(address wallet) external view returns (bytes32) {
        return _identityStorage().identityOf[wallet];
    }

    function walletOfIdentity(bytes32 identityHash) external view returns (address) {
        return _identityStorage().walletOfIdentity[identityHash];
    }

    /// @notice The seeker's live deal id, 0 = none (one active deal per seeker).
    function activeISA(address seeker) external view returns (uint256) {
        return _isaStorage().activeISA[seeker];
    }

    // ── UUPS (ADMIN-only upgrade — spec FR-001/FR-017) ──────────────────
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ── T004 skeleton stubs — reverting until T012–T014 implement them ──
    function activateWithPermit(uint256 isaId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external pure {
        isaId;
        deadline;
        v;
        r;
        s;
        revert();
    }

    function receiveIncome(
        uint256 isaId,
        bytes32 purchaseRef,
        uint256 gross,
        bytes32 salt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external pure {
        isaId;
        purchaseRef;
        gross;
        salt;
        v;
        r;
        s;
        revert();
    }

    function completeAtTerm(uint256 isaId) external pure {
        isaId;
        revert();
    }

    function flagMismatch(uint256 day, uint256 expected, uint256 actual) external pure {
        day;
        expected;
        actual;
        revert();
    }
}
