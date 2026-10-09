// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Stream} from "./Stream.sol";

/// @title Completion — the PLAN §6.1 modules/Completion.
/// @notice `completeAtTerm`: permissionless after termEnd, idempotent,
///         NEVER pausable (PLAN §6.2, constitution VII) — the remainder is
///         forgiven. Owns the ONE completion-bookkeeping site shared with
///         the auto-complete-at-cap path (research.md D8, §6.4 #7: profile
///         counters change ONLY here).
/// @dev No storage of its own — transitions ISA-owned state via the
///      inherited `kite.isa` namespace (research.md D2/D3).
abstract contract Completion is Stream {}
