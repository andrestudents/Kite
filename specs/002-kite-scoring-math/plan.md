# Implementation Plan: KiteScoring Library + Split Math

**Branch**: `002-kite-scoring-math` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-kite-scoring-math/spec.md`
**User constraints**: Foundry only, pure Solidity, no OZ deps beyond math utils, natspec comments citing PLAN.

## Summary

One pure Solidity library — `contracts/src/KiteScoring.sol` — implementing the PLAN §6.3 score formula, offer derivation, split rule, and qualifying-event gate as internal `pure` functions with zero external dependencies. Acceptance is a Foundry test file asserting the PLAN §6.3 demo tables as literal numbers (constitution IX) plus boundary and stateless-fuzz property tests. No storage, no proxy, no state changes anywhere (PLAN §6.1: "Score + offer, pure and hand-checkable").

## Technical Context

**Language/Version**: Solidity `^0.8.20` (repo currently compiles with solc 0.8.36 via forge 1.5.1; `contracts/foundry.toml` stays untouched — default profile already satisfies "0.8.x").

**Primary Dependencies**: forge-std 1.17.0 (vendored in `contracts/lib/`, test-only). **Zero runtime dependencies** — no OpenZeppelin in this feature: the four functions need only checked arithmetic Solidity 0.8 provides natively (see research.md D1). OZ 5.x enters the repo with the KiteCore UUPS/ERC-7201 modules, where it is actually required.

**Storage**: None. Pure library, compile-time inlined into future callers; no proxy, no deployments (spec FR-005, PLAN §6.1).

**Testing**: Foundry `forge test` — three tiers in one test file: literal §6.3 assertions, boundary cases, stateless `testFuzz_*` property tests (bound and conservation properties; no handler/invariant machinery — the library is stateless).

**Target Platform**: EVM (Monad testnet runs Fusaka; pure math is chain-agnostic). No standalone transactions exist, so no gas-limit publishing to `packages/contracts` in this feature — that begins with tx-bearing features.

**Project Type**: library (internal functions, inlined at compile time).

**Performance Goals**: N/A — no standalone tx; inlined call cost is a handful of arithmetic ops.

**Constraints**: Pure functions only (spec FR-005); integer math only, AUSD base units 6 dp, no floats (FR-006, constitution VI); exact PLAN §6.3 formulas verbatim — PLAN wins over any "nicer" rounding (CLAUDE.md); natspec on every function citing PLAN §6.2/§6.3 (user requirement); no new dependencies, no remappings, no foundry.toml changes.

**Scale/Scope**: 1 library file (~100 LOC) + 1 test file (~20 tests). Deletes the forge-init placeholder `Counter.sol`/`Counter.t.sol` (not in PLAN §6.1 — research.md D9).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature complies |
|---|---|---|
| II. Fairness is physics | PARTIAL-BY-SCOPE | Bounds *enforcement* (revert-at-creation) is a later ISA-module feature (spec FR-009). This feature supplies the exact arithmetic those bounds compare against (`offerOf.maxP`) — formulas verbatim from §6.3, no re-rounding. |
| III. Atomic settlement | PASS | Split rule guarantees `diverted ≤ remaining` and `toBacker + toSeeker == gross` exactly (FR-003); both properties are fuzz-tested (SC-002). |
| IV. Contract is the only authority | PASS | Pure deterministic functions anyone can recompute from a Profile — hand-checkable by design (PLAN §6.3). |
| VI. Integer money | PASS | All amounts `uint256` AUSD base units (6 dp); integer floors per component; no floats anywhere (FR-006). |
| IX. Gates before progress | PASS | The §6.3 literal numbers (0/58/91 → 600/1296/1692; 300/1200 and 180/1320) ARE the test suite (FR-007); `forge test` green is the "Done when". |
| X. Honest git history | PASS | Work on branch `002-kite-scoring-math`, one feature per merge, commits in-window. |
| Hard Constraints: Foundry + Solidity 0.8.x | PASS | forge 1.5.1, solc 0.8.36, no Hardhat. |
| Hard Constraints: OZ 5.x | NOT-USED (allowed) | User constraint for this feature: no OZ beyond math utils. None needed — Solidity 0.8 checked arithmetic suffices (research.md D1). OZ arrives with KiteCore. |
| Workflow: spec cites PLAN | PASS | Every FR cites §6.2/§6.3/§6.4; natspec will cite the same sections in-code (user requirement). |

**Gate result: PASS** — no violations, no complexity justifications needed.

## Project Structure

### Documentation (this feature)

```text
specs/002-kite-scoring-math/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output — library API + test-name contract
│   └── kite-scoring-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
contracts/
├── foundry.toml          # UNCHANGED (forge-init default profile)
├── src/
│   ├── KiteScoring.sol   # NEW — pure library: Profile struct, constants,
│   │                     #        score / offerOf / divert / isQualifyingEvent
│   └── Counter.sol       # REMOVED — forge-init placeholder, not in PLAN §6.1
├── test/
│   ├── KiteScoring.t.sol # NEW — literal + boundary + fuzz tests (forge-std)
│   └── Counter.t.sol     # REMOVED — with its subject
└── lib/
    └── forge-std/        # UNCHANGED (vendored, test-only)
```

**Structure Decision**: Single new source file inside the existing Foundry unit (`contracts/`, per PLAN §10 and Feature 001's D3 — not a bun workspace member). No files outside `contracts/` change; `packages/contracts` is untouched until there are deployed artifacts/gas limits to publish. The placeholder Counter pair is deleted so the tested surface is exactly the PLAN §6.1 inventory.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — Constitution Check passes with no violations.
