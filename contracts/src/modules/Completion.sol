// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISA, STATUS_ACTIVE, STATUS_COMPLETED_CAPPED, STATUS_COMPLETED_AT_TERM} from "./ISA.sol";
import {Stream} from "./Stream.sol";

/// @title Completion — the PLAN §6.1 modules/Completion.
/// @notice `completeAtTerm`: permissionless after termEnd, idempotent,
///         NEVER pausable (PLAN §6.2, constitution VII) — the remainder is
///         forgiven. Owns the ONE completion-bookkeeping site shared with
///         the auto-complete-at-cap path (research.md D8, §6.4 #7: profile
///         counters change ONLY here).
/// @dev No storage of its own — transitions ISA-owned state via the
///      inherited `kite.isa` namespace (research.md D2/D3).
abstract contract Completion is Stream {
    // ── External surface (PLAN §6.1; research.md D11) ───────────────────
    /// @notice Anyone may complete an Active deal whose term is over; the
    ///         un-paid remainder is FORGIVEN (never owed, never chased —
    ///         constitution VII). Second and later calls are silent no-ops
    ///         (idempotent — a Sentinel retry must not double-count
    ///         reputation, §6.4 #7). Deliberately NOT pause-gated.
    function completeAtTerm(uint256 isaId) external {
        ISA storage isa = _isaStorage().isas[isaId];
        // Idempotent: CompletedCapped / CompletedAtTerm → no-op SUCCESS.
        if (isa.status == STATUS_COMPLETED_CAPPED || isa.status == STATUS_COMPLETED_AT_TERM) {
            return;
        }
        if (isa.status != STATUS_ACTIVE) revert Kite__NotActive(isaId, isa.status);
        // research.md D11: `now >= termEnd` (inclusive — the same instant
        // income may still settle per D7's equality allowance).
        if (block.timestamp < isa.terms.termEnd) revert Kite__TermEnded(isaId, isa.terms.termEnd);

        // D8: the ONE bookkeeping site — same hook the cap path uses, so the
        // two completion paths can never diverge. Forgiven = the remainder.
        _completeInternal(isaId, isa, STATUS_COMPLETED_AT_TERM, isa.remaining);
    }
}
