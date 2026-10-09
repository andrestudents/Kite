# Implementation Plan: KiteCore Settlement Contract + MockAUSD

**Branch**: `003-kitecore-mockausd` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-kitecore-mockausd/spec.md`

## Summary

Deliver the PLAN §6.1 contract inventory: `KiteCore` — one UUPS proxy implementation
composed of five ERC-7201 namespaced modules (Governed, Identity, ISA, Stream,
Completion) implementing the §6.2 state, functions, testnet parameters, and
asymmetric pause — plus `MockAUSD` (ERC-20, 6 dp, ERC-2612 permit + ERC-3009
`transferWithAuthorization`) as the gasless money rail. Acceptance is the
constitution-IX gate: the §6.3 demo numbers pass end-to-end through `receiveIncome`,
every §6.4 invariant holds under a Foundry invariant suite (84 tests total), a gas
snapshot is committed with limits published to `packages/contracts`, and every
Slither finding is triaged in `contracts/SLITHER.md`. All Phase-0 decisions are in
[research.md](research.md) (D1–D18); the interface contract is
[contracts/kitecore-api.md](contracts/kitecore-api.md) (contractual test names).

## Technical Context

**Language/Version**: Solidity ^0.8.20 → compiled with solc 0.8.36 (forge pin), via
Foundry 1.5.1.

**Primary Dependencies**: OpenZeppelin **5.x** (pinned tag, both
`openzeppelin-contracts` and `openzeppelin-contracts-upgradeable`,
research D1): `AccessControlUpgradeable`, `UUPSUpgradeable`, `EIP712Upgradeable`,
`PausableUpgradeable`, `ReentrancyGuardUpgradeable`, `ERC1967Proxy` (tests),
`ERC20` + `ERC20Permit` (MockAUSD), `ECDSA`. forge-std 1.17.0 (vendored). The
Feature-002 `KiteScoring` library (zero deps) is imported by the modules.

**Storage**: Onchain only — ERC-7201 namespaced structs per module (research D3:
`kite.governed/identity/isa/stream`). No database in this feature (DB/backend are
later features; the contract is the only authority, constitution IV).

**Testing**: `forge test --root contracts` — 84 tests: unit/literal/boundary/role/
pause/reentrancy/upgrade tiers (`KiteCore.t.sol`, `MockAUSD.t.sol`) + handler-based
invariant suite (`test/invariant/`, research D15) + Slither static analysis with
written triage (research D16).

**Target Platform**: Local EVM now; Monad testnet at the next feature (PLAN §12
Day 4). Gas numbers are local-EVM baselines, labeled as such
(constitution Hard Constraints: Monad recalibration at deploy).

**Project Type**: Smart-contract protocol core (library + proxy system + test-only
token) inside the repo's `contracts/` unit.

**Performance Goals**: None web-style — the measured quantity is gas: committed
`.gas-snapshot`, published fixed limits (`packages/contracts/src/gasLimits.ts`,
research D17).

**Constraints**: Constitution Hard Constraints — Foundry+Solidity 0.8.x+OZ 5.x,
UUPS + ERC-7201 (never Hardhat); roles can never move user funds beyond §6.2
functions; pause never blocks `receiveIncome`/`completeAtTerm`; integer AUSD base
units only, no floats anywhere.

**Scale/Scope**: 1 implementation contract + 5 module files + 1 mock token + 1
handler + 3 test files + Slither triage doc + published limits; ~84-test suite.

**Assumptions**: All spec Assumptions carry over; the `/speckit-clarify` session was
terminated early by the user, so its five queued questions were resolved as research
decisions D4, D7, D9, D10, D13 (each veto-able at review; D4 and D7 are PLAN-text
refinements that get recorded as PLAN clarifications at merge — never silent
deviations).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Invisible Blockchain | PASS | No UI in scope. `activateWithPermit` is relayer-submittable so users never pay gas (research D5); MockAUSD mirrors real AUSD so app code never branches (D12). |
| II. Fairness Is Physics | PASS | All six §6.2 bounds revert at creation (FR-005, testBoundary_Draft_* ×16). |
| III. Atomic Settlement | PASS | Split lives inside `receiveIncome`; escrow conservation exact (FR-006/FR-010, invariant_01/09). |
| IV. Contract Is Only Authority | PASS | Views recompute score/offer/state from public storage; nothing cached (FR-016). |
| V. Facts vs Decisions | PASS | Channel signature verified onchain, EIP-712 binding isaId (research D6); double replay guard (eventHash + purchaseRef, §6.4 #2). |
| VI. Integer Money | PASS | AUSD base units only; KiteScoring integer math reused. |
| VII. Humane by Design | PASS | Asymmetric pause (FR-002), permissionless forgiveness (FR-013), hard stop at termEnd (research D7), zero-gross settles 0/0 (D9). |
| VIII. Honesty Boundary | PASS | MockAUSD named/labeled as testnet stand-in; Slither failures are documented, never silently passed (D16). |
| IX. Gates Before Progress | PASS | The whole feature IS a gate: §6.3 literals through the real path (FR-021), §6.4 invariants ×12 (FR-020), user-runnable quickstart. |
| X. Honest Git History | PASS | One feature per merge on `003-kitecore-mockausd`; window-dated commits. |

Hard Constraints check: OZ 5.x + UUPS + ERC-7201 ✓ (D1/D2); gas measured + published
✓ (D17/D18 — with honest local-EVM labeling); role fund-confinement ✓
(invariant_12, role tier); no backend in scope.

Post-Phase-1 re-check (design artifacts): data-model matches §6.2 field-for-field;
API contract carries all PLAN-named functions/events (`ISAActivated`,
`IncomeSettled`, `MismatchFlagged`) plus the indexer's `ScoreChanged`; test
inventory covers every FR and every §6.4 item. **GATE: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/003-kitecore-mockausd/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0: decisions D1–D18 (incl. 5 deferred-clarify resolutions)
├── data-model.md        # Phase 1: entities, lifecycle, storage ownership
├── contracts/
│   └── kitecore-api.md  # Phase 1: API + events + errors + 84 contractual test names
├── quickstart.md        # Phase 1: §0–§6 validation gates (the Done-when commands)
├── checklists/
│   └── requirements.md  # 16/16 PASS (from /speckit-specify)
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
contracts/
├── foundry.toml         # + [invariant] runs/depth = 128 (research D18)
├── lib/
│   ├── forge-std/                      # vendored (existing)
│   ├── openzeppelin-contracts/         # NEW — pinned 5.x tag (research D1)
│   └── openzeppelin-contracts-upgradeable/  # NEW — pinned 5.x tag
├── src/
│   ├── KiteCore.sol                    # NEW — UUPS impl composing the five modules
│   ├── MockAUSD.sol                    # NEW — ERC20(6dp)+permit+ERC-3009 subset
│   ├── KiteScoring.sol                 # existing (Feature 002, untouched)
│   └── modules/
│       ├── Governed.sol                # roles + asymmetric pause + upgrade auth
│       ├── Identity.sol                # identity bindings + channel registry
│       ├── ISA.sol                     # isas, drafts/activation/cancel, profiles
│       ├── Stream.sol                  # receiveIncome: sig verify + replay + split
│       └── Completion.sol              # completeAtTerm + completion bookkeeping
├── test/
│   ├── KiteCore.t.sol                  # 62 tests (literal/boundary/role/pause/reentrancy/upgrade/init)
│   ├── MockAUSD.t.sol                  # 10 tests
│   ├── invariant/
│   │   ├── KiteCoreInvariants.t.sol    # 12 invariant_ tests (§6.4)
│   │   └── KiteCoreHandler.t.sol       # bounded actors + ghost accounting
│   └── KiteScoring.t.sol               # existing (Feature 002, untouched)
├── SLITHER.md                          # NEW — triage: every finding fixed|justified
└── .gas-snapshot                       # NEW — committed (research D17)

packages/contracts/
└── src/gasLimits.ts                    # NEW — published fixed limits (local-EVM baseline label)
```

**Structure Decision**: Foundry unit at `contracts/` (not a bun workspace member —
Feature-001 research), mirroring the existing scaffold; modules under
`src/modules/` per PLAN §6.1's "modules/Governed…" inventory; the invariant suite in
`test/invariant/` with its handler; `packages/contracts` (existing bun workspace)
receives only the generated gas-limits artifact.

## Complexity Tracking

No constitution violations to justify — table intentionally empty.
