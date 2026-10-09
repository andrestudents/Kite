---
description: "Task list for Feature 002 — KiteScoring Library + Split Math"
---

# Tasks: KiteScoring Library + Split Math

**Input**: Design documents from `/specs/002-kite-scoring-math/`
(plan.md, spec.md, research.md, data-model.md, contracts/kite-scoring-api.md, quickstart.md)

**Tests**: Test tasks ARE the deliverable — the spec's acceptance criteria are the
PLAN §6.3 literal tables (spec FR-007/FR-008, constitution IX). Every test name is
predefined in `contracts/kite-scoring-api.md` and MUST be used verbatim.

**Organization**: Grouped by user story; each story is independently testable via its
`forge test --match-test` tier (quickstart §3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3)
- Exact file paths in every description

## Path Conventions

Foundry unit at `contracts/` (not a bun workspace member — Feature 001 research D3).
Library: `contracts/src/KiteScoring.sol` · Tests: `contracts/test/KiteScoring.t.sol`.
Run commands from repo root as `forge test --root contracts …` (forge 1.5.1: flag
AFTER the subcommand).

---

## Phase 1: Setup

**Purpose**: Branch hygiene before any code (constitution X).

- [ ] T001 Create feature branch `002-kite-scoring-math` from `main` (constitution X: one feature per merge)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: A clean, PLAN-§6.1-exact contracts unit before any story lands.

**⚠️ CRITICAL**: No user-story work can begin until T003 compiles.

- [x] T002 [P] Delete the forge-init placeholders `contracts/src/Counter.sol` and `contracts/test/Counter.t.sol` (research.md D9 — not in PLAN §6.1); run `forge build --root contracts` and confirm it is still green with zero sources failing — *done: also removed `contracts/script/Counter.s.sol`, a fourth forge-init placeholder importing Counter.sol (same D9 rationale, missed in the original enumeration); build green*
- [x] T003 [P] Create `contracts/src/KiteScoring.sol` skeleton — `// SPDX-License-Identifier: MIT`, `pragma solidity ^0.8.20`, `library KiteScoring` with NO imports (research.md D1) containing: `struct Profile { uint64 totalISAs; uint64 completed; uint64 qualEvents; uint64 distinctBackers; }` (field-for-field PLAN §6.2, research.md D3) and the constants `uint256 internal constant BASE_MAX_P = 600e6;` / `MIN_EVENT_GAP = 60 days;` / `MIN_EVENT_BPS = 1000;` (PLAN §6.2 testnet parameters, research.md D4), plus a library-level `/// @notice` natspec block citing PLAN §6.1–§6.3; verify `forge build --root contracts` is green

**Checkpoint**: contracts unit compiles with exactly the PLAN §6.1 inventory (KiteScoring only).

---

## Phase 3: User Story 1 — The §6.3 score/offer tables as literal tests (Priority: P1) 🎯 MVP

**Goal**: `score(Profile)` and `offerOf(uint8)` reproduce PLAN §6.3's demo table exactly: {0,0,0,0}→0/600e6 · {2,2,4,2}→58/1296e6 · {3,3,7,3}→91/1692e6 · single-backer History cap (spec FR-001, FR-002, FR-007).

**Independent Test**: `forge test --root contracts --match-test testLiteral` → 6 passed… wait, US1's slice is the 4 score literals — run `forge test --root contracts --match-test testLiteral_Score` → **4 passed** (quickstart §3, tier subset).

### Implementation for User Story 1 (tests first — RED, then GREEN)

- [x] T004 [US1] Create `contracts/test/KiteScoring.t.sol` (forge-std `Test`, contract `KiteScoringTest`) with the four literal score tests using the EXACT names from contracts/kite-scoring-api.md: `testLiteral_Score_NewAccount_0_Offer600` (asserts `score({0,0,0,0}) == 0`, `offerOf(0) == 600e6`), `testLiteral_Score_BudiPrepared_58_Offer1296` (asserts components History 26 / Consistency 6 / Volume 26 — via a component-checking helper or re-derived asserts — plus `score == 58`, `offerOf(58) == 1296e6`), `testLiteral_Score_AfterDemo_91_Offer1692` (History 40 / Consistency 11 / Volume 40, `score == 91`, `offerOf(91) == 1692e6`), `testLiteral_Score_SingleBacker_HistoryCap13_Score64` (asserts `score({3,3,7,1}) == 64` because History is capped at 13); add reverting stubs `score`/`offerOf` to `contracts/src/KiteScoring.sol` so the file compiles, run `forge test --root contracts --match-test testLiteral_Score` and confirm 4 FAILED (RED state recorded)
- [x] T005 [US1] Implement `score(Profile memory)` and `offerOf(uint8)` in `contracts/src/KiteScoring.sol` replacing the stubs, each with natspec citing PLAN §6.3 (user constraint): History = `40 * completed * min(totalISAs, 3) / (totalISAs * 3)` with **`totalISAs == 0` → 0** (divide-by-zero guard, research.md D7) and **capped at 13 when `distinctBackers < 2`**; Consistency = `20 * min(qualEvents, 12) / 12`; Volume = `40 * min(qualEvents, 6) / 6`; return type `uint8`; `offerOf` = `BASE_MAX_P * (100 + 2 * score) / 100` returning `uint256`; NO clamping beyond the PLAN's own 13-cap
- [x] T006 [US1] GREEN gate: `forge test --root contracts --match-test testLiteral_Score` → **4 passed; 0 failed** (quickstart §3 subset) — *verified: 4 passed; 0 failed*

**Checkpoint**: The constitution-IX score table is literally green — the MVP of this feature.

---

## Phase 4: User Story 2 — The split rule exact and capped (Priority: P2)

**Goal**: `divert(gross, shareBps, remaining)` returns `(toBacker, toSeeker)` with `toBacker = min(gross × shareBps / 10000, remaining)` and `toSeeker = gross − toBacker`, never exceeding the cap (spec FR-003, FR-007 L5–L6, FR-008).

**Independent Test**: `forge test --root contracts --match-test testDivert` → **6 passed** (2 literal + 3 boundary + 1 fuzz).

### Implementation for User Story 2 (tests first — RED, then GREEN)

- [x] T007 [US2] Add to `contracts/test/KiteScoring.t.sol` the divert tests with EXACT names from contracts/kite-scoring-api.md: literals `testLiteral_Divert_Panen1_300_1200` (`divert(1500e6, 2000, 780e6) == (300e6, 1200e6)`) and `testLiteral_Divert_Panen3_CapReached_180_1320` (`divert(1500e6, 2000, 180e6) == (180e6, 1320e6)`); boundaries `testBoundary_Divert_CapReachedExactly` (`divert(1500e6, 2000, 300e6) == (300e6, 1200e6)`), `testBoundary_Divert_ZeroGross_0_0`, `testBoundary_Divert_ZeroRemaining_AllToSeeker` (`(0, gross)`); fuzz `testFuzz_Divert_Conservation(uint256 gross, uint256 shareBps, uint256 remaining)` asserting `toBacker <= remaining` AND `toBacker + toSeeker == gross`; add a reverting `divert` stub to `contracts/src/KiteScoring.sol`, run `forge test --root contracts --match-test testDivert` → 6 FAILED (RED)
- [x] T008 [US2] Implement `divert(uint256 gross, uint256 shareBps, uint256 remaining) internal pure returns (uint256 toBacker, uint256 toSeeker)` in `contracts/src/KiteScoring.sol` with natspec citing PLAN §6.2/§6.3 and the conservation invariant §6.4 #1: `toBacker = slice < remaining ? slice : remaining` where `slice = gross * shareBps / 10000`; `toSeeker = gross - toBacker` (cannot underflow — both min-branches are ≤ slice ≤ gross)
- [x] T009 [US2] GREEN gate: `forge test --root contracts --match-test Divert` → **6 passed; 0 failed** (quickstart §3 subset) — *verified: 6 passed; 0 failed. Pattern corrected: `--match-test` is a substring regex, so the gate pattern is `Divert`/`Qualifying` (no test name contains the literal `testDivert`)*

**Checkpoint**: The §6.3 split table and both conservation properties are green.

---

## Phase 5: User Story 3 — Only real seasons qualify (Priority: P3)

**Goal**: `isQualifyingEvent(lastEventAt, now, gross, principal)` → true iff gap ≥ 60 days (first event passes; clock inversion → false, never revert) AND gross ≥ 10% of principal, boundaries inclusive (spec FR-004, FR-008).

**Independent Test**: `forge test --root contracts --match-test testQualifying` → **6 passed**.

### Implementation for User Story 3 (tests first — RED, then GREEN)

- [x] T010 [US3] Add to `contracts/test/KiteScoring.t.sol` the six qualifying tests with EXACT names from contracts/kite-scoring-api.md: `testBoundary_Qualifying_Gap59Days_False`, `testBoundary_Qualifying_Gap60Days_True`, `testBoundary_Qualifying_GrossBelow10Pct_False`, `testBoundary_Qualifying_GrossExactly10Pct_True`, `testBoundary_Qualifying_FirstEvent_Qualifies` (`lastEventAt = 0` passes the gap bar), `testBoundary_Qualifying_ClockInversion_False` (`lastEventAt > now` → false and NO revert); use a fixed reference `now` (e.g. `1_000_000_000`) with `60 days = 5_184_000` offsets; add a reverting `isQualifyingEvent` stub to `contracts/src/KiteScoring.sol`, run `forge test --root contracts --match-test testQualifying` → 6 FAILED (RED)
- [x] T011 [US3] Implement `isQualifyingEvent(uint256 lastEventAt, uint256 now, uint256 gross, uint256 principal) internal pure returns (bool)` in `contracts/src/KiteScoring.sol` with natspec citing PLAN §6.3/§6.2: the gap bar as the ADDITIVE form `lastEventAt == 0 || lastEventAt + MIN_EVENT_GAP <= now` (research.md D6 — subtraction would panic on clock inversion) AND the size bar `gross * 10000 >= principal * MIN_EVENT_BPS`; both boundaries inclusive
- [x] T012 [US3] GREEN gate: `forge test --root contracts --match-test Qualifying` → **6 passed; 0 failed** (quickstart §3 subset) — *verified: 6 passed; 0 failed*

**Checkpoint**: All three stories independently functional — the full 20-test suite exists.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Whole-feature acceptance before merge (constitution IX).

- [ ] T013 Complete the remaining tier tests in `contracts/test/KiteScoring.t.sol` with EXACT names from contracts/kite-scoring-api.md: `testBoundary_Score_Saturation_Consistency12_Volume6` (qualEvents ≥ 12 → Consistency 20, Volume 40), `testBoundary_Offer_Score100_1800` (`offerOf(100) == 1800e6`), `testFuzz_Score_WithinBounds_ValidProfile` (bound generators so `completed ≤ totalISAs`; assert score ∈ [0,100] and each component ≤ 40/20/40), `testFuzz_Offer_Monotonic(uint8 s1, uint8 s2)` with `vm.assume(s1 <= s2)` asserting `offerOf(s1) <= offerOf(s2)`; then run the full quickstart.md §1–§4 end-to-end: `forge build --root contracts` green, `forge test --root contracts` → **20 passed; 0 failed**, with the tiers matching: `--match-test testLiteral` → 6, `--match-test testBoundary` → 11, `--match-test testFuzz` → 3
- [ ] T014 Source-obligations review (research.md D1/D10, spec FR-005/FR-009): `contracts/src/KiteScoring.sol` has zero imports, all four functions are `internal pure` with natspec citing PLAN §6.2/§6.3, no storage/proxy/events, no floats, no clamps beyond the 13-cap; `contracts/src/` contains ONLY `KiteScoring.sol`; test names in `contracts/test/KiteScoring.t.sol` match contracts/kite-scoring-api.md exactly (diff the name table against `forge test --root contracts --json` output)
- [ ] T015 Feature-001 regression + merge (quickstart §5): `bun run health` → 9/9 exit 0 and `bun run build` green; commits land in-window one logical group per commit (constitution X); merge `002-kite-scoring-math` into `main` with `--no-ff`, then re-run `forge test --root contracts` and `bun run health` on `main`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: after T001; T002 ∥ T003 (different files); T003 blocks ALL story work
- **User Stories (Phases 3–5)**: each depends on T003. The three stories touch the SAME two files (`contracts/src/KiteScoring.sol`, `contracts/test/KiteScoring.t.sol`) → run SEQUENTIALLY in priority order US1 → US2 → US3; do NOT parallelize across stories
- **Polish (Phase 6)**: T013 after all stories (completes the tier inventory); T014 after T013; T015 last

### User Story Dependencies

- **US1 (P1)**: after T003 — creates the test file; no other-story dependencies
- **US2 (P2)**: after US1's tasks (same files, appends to the suite US1 created)
- **US3 (P3)**: after US2's tasks (same reason)
- Each story's internal order is strict: tests (RED) → implement → gate (GREEN)

### Parallel Opportunities

- T002 ∥ T003 (Phase 2, different files)
- Within a story, none — test file and library are each a single sequential file
- T015's two verification commands can run back-to-back in one shell

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1–2: branch, Counter gone, library skeleton compiles
2. Phase 3: the four literal score tests RED → implement → **4 passed**
3. **STOP and VALIDATE**: the constitution-IX core (score table 0/58/91 + 13-cap) is green — this alone is the PLAN §12 Day-2 gate
4. Continue US2 (split table) and US3 (qualifying gate) as time allows

### Incremental Delivery

1. Branch + clean unit → skeleton
2. US1 → score/offer literals (MVP)
3. US2 → split literals + conservation fuzz
4. US3 → qualifying gate boundaries
5. Polish → full 20-test quickstart pass, source review, regression + merge

---

## Notes

- [P] tasks = different files, no dependencies
- TDD convention here: a tier's tests are added together with reverting stubs so the suite COMPILES and fails (RED); implementing the function flips exactly that tier to GREEN. A compile error is not an acceptable RED state.
- Every test name comes verbatim from contracts/kite-scoring-api.md — do not rename, quickstart.md and the completion counts depend on them
- Expected final counts: 20 tests = 6 `testLiteral_*` + 11 `testBoundary_*` + 3 `testFuzz_*`
- All money literals in tests are AUSD base units (6 dp): 600e6, 780e6, 1500e6, 1296e6, 1692e6, 1800e6 (constitution VI)
- Frozen stack: no OZ, no remappings, no foundry.toml changes, no files outside `contracts/` except specs (plan.md Constraints)
