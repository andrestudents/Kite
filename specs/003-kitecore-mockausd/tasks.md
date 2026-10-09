---
description: "Task list for Feature 003 — KiteCore Settlement Contract + MockAUSD"
---

# Tasks: KiteCore Settlement Contract + MockAUSD

**Input**: Design documents from `/specs/003-kitecore-mockausd/`
(plan.md, spec.md, research.md, data-model.md, contracts/kitecore-api.md, quickstart.md)

**Tests**: Test tasks ARE the deliverable (spec FR-020..FR-022, constitution IX).
Every test name is predefined in [contracts/kitecore-api.md](contracts/kitecore-api.md)
and MUST be used verbatim — quickstart.md counts depend on them. Suite total: **84**
(10 `testMock_` + 62 KiteCore + 12 `invariant_`).

**Organization**: Grouped by user story; each story gates via its `--match-test`
tier (quickstart §3/§4). US1 is strictly sequential (one dependency chain through
the modules); later stories append to the same files, also sequentially.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3)
- Exact file paths in every description

## Path Conventions

Foundry unit at `contracts/` (not a bun workspace member — Feature-001 research).
Run from repo root: `forge test --root contracts …` / `forge build --root contracts`
(forge 1.5.1: flag AFTER the subcommand; `--match-test` is a substring regex —
patterns below are prefixes that occur verbatim in the names).

---

## Phase 1: Setup

**Purpose**: Branch hygiene before any code (constitution X).

- [x] T001 Create feature branch `003-kitecore-mockausd` from `main` (constitution X: one feature per merge)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Dependencies + a compiling skeleton of the full §6.1 inventory before any story lands.

**⚠️ CRITICAL**: No user-story work can begin until T005 compiles.

- [x] T002 [P] Install OpenZeppelin 5.x into `contracts/lib/` — `forge install --root contracts OpenZeppelin/openzeppelin-contracts@<latest-stable-v5.x-tag> OpenZeppelin/openzeppelin-contracts-upgradeable@<same-tag>` (research.md D1; pin BOTH to the same exact tag; forge 1.5.1 does not auto-commit); verify `forge build --root contracts` still green (KiteScoring untouched, 20 tests still pass)
- [x] T003 [P] Add `[invariant]` section to `contracts/foundry.toml`: `runs = 128`, `depth = 128` (research.md D18; no other config changes)
- [x] T004 Create `contracts/src/modules/{Governed,Identity,ISA,Stream,Completion}.sol` + `contracts/src/KiteCore.sol` skeletons (research.md D2/D3): five abstract contracts each with its ERC-7201 namespaced storage struct (`kite.governed` → `paused`; `kite.identity` → `identityOf`, `walletOfIdentity`, `channels`; `kite.isa` → `isas`, `activeISA`, `profiles`, `completedWithBacker`, `nextIsaId`; `kite.stream` → `eventHashes`, `settledRefs`), shared types `Terms { uint256 principal; uint16 shareBps; uint16 capMult; uint64 termEnd; uint64 channelId; }` and `ISA { … }` field-for-field per PLAN §6.2 (data-model.md), the §6.2 status encoding (0 None · 1 Drafted · 2 Active · 3 CompletedCapped · 4 CompletedAtTerm · 5 Cancelled), ALL events and `Kite__*` errors from [contracts/kitecore-api.md](contracts/kitecore-api.md), and external function stubs that `revert()` — KiteCore inherits the five modules and declares the external surface + `initialize`; `forge build --root contracts` green
- [x] T005 [P] Create `contracts/src/MockAUSD.sol` skeleton: OZ `ERC20("AUSD","AUSD")` + `ERC20Permit` + `decimals()` override returning 6 + reverting `transferWithAuthorization` stub + the four `Authorization*` errors + `constructor(address initialHolder)` minting `INITIAL_SUPPLY = 1_000_000e6` (research.md D12); `forge build --root contracts` green

**Checkpoint**: `contracts/src/` contains exactly the §6.1 inventory (KiteCore + 5 modules + MockAUSD + KiteScoring) and compiles.

---

## Phase 3: User Story 1 — The §6.3 demo loop end-to-end (Priority: P1) 🎯 MVP

**Goal**: MockAUSD live (permit + ERC-3009), and the full journey onchain — fund 600 → cap 780 → panen 300/1200 · 300/1200 · 180/1320 → auto-finish at cap → reputation 58 → 91 (spec FR-005..FR-014, FR-018, FR-021).

**Independent Test**: `forge test --root contracts --match-test testMock_` → **10 passed** and `--match-test testLiteral_` → **6 passed**.

### Implementation for User Story 1 (tests first — RED, then GREEN)

- [x] T006 [US1] Create `contracts/test/MockAUSD.t.sol` (`MockAUSDTest is Test`) with the 10 `testMock_*` tests verbatim from contracts/kitecore-api.md (decimals, permit pull/expiry/nonce-replay/forgery, ERC-3009 gasless send/replay/expired/not-yet-valid/forged — sign EIP-712 payloads with `vm.sign`); run `forge test --root contracts --match-test testMock_` → 10 FAILED (RED: stubs revert)
- [x] T007 [US1] Implement `transferWithAuthorization` in `contracts/src/MockAUSD.sol` per research.md D12 (EIP-3009 typehash `TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)`, `used[from][nonce]` map, window + signer checks, shares the ERC20Permit domain); gate: `--match-test testMock_` → **10 passed; 0 failed**
- [x] T008 [US1] Create `contracts/test/KiteCore.t.sol` (`KiteCoreTest is Test`) with the shared fixture `_demo()` + stage helper `_runTo(uint8 stage)` (deploy MockAUSD + ERC1967Proxy over KiteCore impl; initialize(admin, relayer, orchestrator, pauser, ausd); bind Budi+Pak Haji; register channel 1 keyed to the mill's funded+approving account; prepare Budi's reputation {2,2,4,2} via two completed prior deals; draft the §6.3 deal P 600e6/share 2000/capMult 130/term +12mo/backer Pak Haji; stages: 1=activated, 2/3/4=panen at +61d/+122d/+183d) and the 6 `testLiteral_*` tests verbatim from contracts/kitecore-api.md; run `--match-test testLiteral_` → 6 FAILED (RED: stubs revert)
- [x] T009 [US1] Implement `contracts/src/modules/Governed.sol`: role constants (ADMIN=default admin, RELAYER_ROLE, ORCHESTRATOR_ROLE, PAUSER), `initialize` wiring (incl. `__EIP712_init("KiteCore","1")`, research.md D13), `pause`/`unpause` (PAUSER), `_authorizeUpgrade` (ADMIN) — asymmetric by construction: NO pause modifier here yet
- [x] T010 [US1] Implement `contracts/src/modules/Identity.sol`: `bindIdentity(address wallet, bytes32 identityHash)` (RELAYER; both directions unbound else `IdentityAlreadyBound`/`HashAlreadyBound`, §6.4 #5) and `registerChannel(uint64 id, string name, address pubkey)` (ADMIN; duplicate id → `ChannelExists`); emit `IdentityBound`/`ChannelRegistered`
- [x] T011 [US1] Implement `contracts/src/modules/ISA.sol` part 1 — `createISADraft(Terms calldata, address backer)` (research.md D4): ALL six bounds verbatim (shareBps ∈ [1000,2000] → `ShareOutOfBounds`; capMult ∈ [120,150] → `CapMultOutOfBounds`; termEnd ≤ now+24mo → `TermTooLong`; principal ≤ `KiteScoring.offerOf(scoreOf(seeker))` → `PrincipalAboveMax`; channel exists+active → `UnknownChannel`/`ChannelInactive`; `activeISA[seeker]==0` → `HasActiveISA`; both parties identity-bound → `NotVerified`), `remaining = principal × capMult / 100` stored at draft, `whenNotPaused`; `cancelDraft` (seeker|backer, Drafted only → `NotDrafted`/`NotSeekerOrBacker`)
- [x] T012 [US1] Implement `contracts/src/modules/ISA.sol` part 2 — `activateWithPermit(isaId, deadline, v, r, s)` (research.md D5: `permit(backer, this, principal, …)` → `transferFrom` pull → `transfer(seeker)` pay → Active + `activeISA` + `ISAActivated`; `nonReentrant`, `whenNotPaused`; permit owner must be the named backer → `WrongBacker`) and the views `isaOf/profileOf/scoreOf/offerOf` (recomputed via `KiteScoring`, constitution IV)
- [x] T013 [US1] Implement `contracts/src/modules/Stream.sol` — `receiveIncome(isaId, purchaseRef, gross, salt, v, r, s)` (research.md D6/D7): ORCHESTRATOR-only; EIP-712 `IncomeEvent{channelId, isaId, purchaseRef, gross, salt}` recover == `channels[channelId].pubkey` → `BadChannelSignature`; signed channelId == terms.channelId → `ChannelMismatch`; status Active → `NotActive`; `block.timestamp ≤ termEnd` → `TermEnded`; double replay guard (`eventHashes` tuple hash AND `settledRefs[channel][purchaseRef]` → `EventAlreadySettled`, §6.4 #2); pull `gross` from channel; `KiteScoring.divert` split pays backer+seeker same tx; qualifying bookkeeping via `KiteScoring.isQualifyingEvent`; remaining==0 → auto-complete; emit `IncomeSettled`
- [x] T014 [US1] Implement `contracts/src/modules/Completion.sol` — `completeAtTerm(isaId)` state matrix (research.md D11: Active+now≥termEnd → complete; already Completed* → no-op SUCCESS; Drafted/Cancelled/none → revert), remainder forgiven, and the ONE completion bookkeeping site (research.md D8: `totalISAs++, completed++, qualEvents += eventCount`, `distinctBackers++` iff `!completedWithBacker[seeker][backer]`; emit `ISACompletedAtTerm`/`ISACompletedCapped` + `ScoreChanged`); Stream's auto-complete path calls the same internal hook
- [x] T015 [US1] GREEN gate: `forge test --root contracts --match-test testLiteral_` → **6 passed; 0 failed** (quickstart §3) and full suite `forge test --root contracts` → 36 passed (20 KiteScoring + 10 Mock + 6 literal), 0 failed

**Checkpoint**: The constitution-IX core is green — the §6.3 table runs through the real settlement path. This alone is the MVP.

---

## Phase 4: User Story 2 — Unwritable unfairness, unwipeable identity (Priority: P2)

**Goal**: The bounds/identity matrix — every out-of-bounds term reverts, every boundary value is accepted, identity is one-to-one both ways, cancel is pre-activation only (spec FR-003..FR-007).

**Independent Test**: `forge test --root contracts --match-test testBoundary_` → **22 passed** (at this checkpoint the tier contains only US2's tests).

### Implementation for User Story 2 (verification matrix — behavior exists from US1; every test must pass on arrival)

- [x] T016 [US2] Add to `contracts/test/KiteCore.t.sol` the 18 draft/identity tests verbatim from contracts/kitecore-api.md: `testBoundary_Draft_Share999_Reverts`, `…Share1000_Ok`, `…Share2000_Ok`, `…Share2001_Reverts`, `…Cap119_Reverts`, `…Cap120_Ok`, `…Cap150_Ok`, `…Cap151_Reverts`, `…TermBeyond24Months_Reverts`, `…TermExactly24Months_Ok`, `…PrincipalAboveMaxP_Reverts`, `…PrincipalExactlyMaxP_Ok`, `…PrincipalAboveScore0Max_Reverts`, `…UnknownChannel_Reverts`, `…SeekerWithActiveDeal_Reverts`, `…SeekerUnverified_Reverts`, `testBoundary_Identity_HashToSecondWallet_Reverts`, `testBoundary_Identity_SecondHashToWallet_Reverts` (boundary values inclusive per spec FR-005; use prepared-seeker maxP 1296e6 and fresh-seeker maxP 600e6 fixtures)
- [x] T017 [US2] Add `testBoundary_Cancel_BySeeker_WhileDrafted_Ok`, `…Cancel_ByBacker_WhileDrafted_Ok`, `…Cancel_AfterActivation_Reverts`, `testBoundary_Views_RecomputeFromPublicState` (isaOf/profileOf/scoreOf/offerOf agree with §6.3 math on live state, constitution IV); gate: `--match-test testBoundary_` → **22 passed; 0 failed**

**Checkpoint**: Fairness-as-physics and identity permanence are proven by matrix.

---

## Phase 5: User Story 3 — Nothing dishonest is possible (Priority: P3)

**Goal**: Every §6.4 invariant under randomized legal-and-adversarial sequences, the role matrix, asymmetric pause, reentrancy, upgrade isolation (spec FR-001/FR-002/FR-008..FR-013/FR-015/FR-017/FR-020/FR-022).

**Independent Test**: `forge test --root contracts` → **84 passed; 0 failed** (incl. `--match-test invariant_` → 12 passed).

### Implementation for User Story 3 (adversarial tiers, then the invariant suite)

- [x] T018 [US3] Add the 13 stream-adversarial tests verbatim from contracts/kitecore-api.md: `testBoundary_Income_CallerNotOrchestrator_Reverts`, `…ForgedSignature_Reverts`, `…WrongChannel_Reverts`, `…TamperedGross_Reverts`, `…ReplaySameTuple_Reverts`, `…ReplaySameRefNewSalt_Reverts` (settledRefs guard), `…OnDrafted_Reverts`, `…OnCancelled_Reverts`, `…OnCompletedCapped_Reverts`, `…ZeroGross_SettlesZero_NeverQualifies`, `…SubBarGap_Splits_NoQualCredit`, `…SliceEqualsRemaining_CompletesExactly`, `…AfterTermEnd_Reverts` (research.md D7 hard stop); any failure is a REAL src bug — fix `contracts/src/` and note it
- [x] T019 [US3] Add the 4 completion-matrix tests verbatim: `testBoundary_Complete_BeforeTermEnd_Reverts`, `…FromDrafted_Reverts`, `…RemainderForgiven_ProfileUpdated` (forgiven remainder; profile {+1,+1,+eventCount,+1}; post-term income reverts), `…SecondCall_NoOpSuccess`; gate: `--match-test testBoundary_` → **39 passed**
- [x] T020 [US3] Add role + pause tiers verbatim: `testRole_Relayer_CanOnlyBind`, `…Orchestrator_OnlyIncomeCompleteFlag`, `…Pauser_OnlyPauseCycle`, `…Admin_GrantsRoles_CannotMoveFunds`, `…Stranger_OnlyCompleteAtTerm`, `…FlagMismatch_EmitsOnly_ZeroStateChange` (assert storage+balances byte-identical), `testPause_Blocks_CreateISADraft`, `…Blocks_ActivateWithPermit`, `…Allows_ReceiveIncome`, `…Allows_CompleteAtTerm`, `…Allows_BindAndRegister`; gates: `--match-test testRole_` → 6, `--match-test testPause_` → 5
- [x] T021 [US3] Add `testReentrancy_ActivateWithPermit_Blocked` + `testReentrancy_ReceiveIncome_Blocked` (malicious-token deployment via research.md D13 initializer + attacker contract that re-enters from `transfer`/`transferFrom`) and `testUpgrade_AdminOnly_UnauthorizedReverts` + `testUpgrade_StateSurvives_V2` (dummy `KiteCoreV2` in the test file) + `testUpgrade_ModuleNamespaces_Distinct` + `testInitialize_Twice_Reverts`; gates: `testReentrancy_` → 2, `testUpgrade_` → 3, `testInitialize_` → 1
- [x] T022 [US3] Create `contracts/test/invariant/KiteCoreHandler.t.sol` (bounded actors: admin/relayer/orchestrator/pauser/seekers/backers/channel; randomized legal + adversarial calls wrapped in try/catch; ghost accounting: cumulative AUSD in/out per side, per-ISA snapshots, settled-fact set, score latches, completion latch, paused mirror) and `contracts/test/invariant/KiteCoreInvariants.t.sol` with the 12 `invariant_NN_*` tests verbatim from contracts/kitecore-api.md, one per PLAN §6.4 item; gate: `forge test --root contracts --match-test invariant_` → **12 passed; 0 failed** — NOTE: 32 runs × 64 depth, fail_on_revert=false (foundry.toml); handler violations are COUNTERS not asserts (a reverting assert would be swallowed by fail_on_revert=false); pause exercised ~150 toggles/run after hoisting the `paused()` staticcall out of the vm.prank window (a staticcall between prank and call consumes the prank)
- [x] T023 [US3] Mutation spot-check (spec FR-020 "demonstrably capable of failing"): temporarily change `KiteScoring.divert`'s `toBacker` to the un-capped `slice`, run `--match-test invariant_01_` and `--match-test testLiteral_Demo_Panen3` → BOTH FAIL; restore the cap; full `forge test --root contracts` → **84 passed; 0 failed**; record the demonstration in the task note — **DEMONSTRATION**:
  - Mutation A (the spec'd un-capped `toBacker = slice`): `testLiteral_Demo_Panen3` **FAILS** (`panic 0x11` — over-cap settlement reverts on `remaining - toBacker` underflow) but `invariant_01` **PASSES**: split conservation is cap-independent (legs still sum to gross) and the uncapped branch reverts BEFORE committing state, so no ghost can drift. "BOTH FAIL" is unsatisfiable for invariant_01 by construction — the cap's on-chain observable is the clamp/revert, owned by the literal; the ledger reality-checks are #9/#12 (proposed api.md/tasks gate wording fix → surfaced at T027).
  - Mutation B (`toSeeker = gross - toBacker - 1`, skim 1 base unit/settlement): `invariant_09` **FAILS** ("KiteCore is holding user money: 1 != 0"), `invariant_12` **FAILS** ("unexplained AUSD movement: 221242738 != 221242739"), Panen3 FAILS → FR-020 demonstrated: `forge test --match-test invariant_` → 10 passed, 2 failed.
  - The mutation check caught two REAL test-suite defects (src was correct both times): (1) handler mirrors called `KiteScoring` directly — a ghost computed by the code under test verifies nothing; expectations now computed inline; (2) `draftLegal`/`settleIncome`/`settleReplay` were missing `vm.prank` — every legal draft reverted NotVerified and every settlement reverted on the ORCHESTRATOR role check, so the fuzz happy path never executed (Mutation B's 12/12 pass with dust on the table proved it). Fixed; restored divert is byte-identical (`git diff` empty); full suite **104 passed; 0 failed** (62 KiteCore + 12 invariant + 10 MockAUSD + 20 KiteScoring; tasks.md's "84" predates the final tier counts — per-suite counts match api.md lines 246–247)

**Checkpoint**: All twelve §6.4 invariants hold — the trust boundary is proven.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Whole-feature acceptance before merge (constitution IX + spec FR-023/FR-024).

- [x] T024 Static analysis: install + run per research.md D16 (`pip3 install --user slither-analyzer`, `solc-select install 0.8.36` + `use`, `slither contracts/`); write `contracts/SLITHER.md` with one row per finding — Severity / Disposition (`fixed`|`justified`) / Rationale — **0 untriaged**; if installation genuinely fails, commit the attempted commands + output and leave the gate OPEN (never silently pass; spec FR-023) — slither-analyzer 0.11.6 + solc-select 1.2.0 + solc 0.8.36 installed cleanly (exit 0); 47 contracts / 102 detectors / **127 findings pre-triage**; 2 FIXED in src (shadowing-builtin `now`→`at` in KiteScoring.isQualifyingEvent; shadowing-local `ausd`→`ausdToken` in KiteCore.initialize — full suite re-verified 104/104) → 125 findings (22 src + 103 vendored-OZ), every one dispositioned justified with rule-cited rationale; sum check 22+103+2 = 125 (pre-fix count) documented in SLITHER.md
- [x] T025 Gas artifacts: `forge snapshot --root contracts` → commit `contracts/.gas-snapshot`; hand-generate `packages/contracts/src/gasLimits.ts` per research.md D17 (typed `KITE_GAS_LIMITS` map function → `{ gasUsed, fixedLimit = ceil(gasUsed × 1.25 / 1000) × 1000 }`, exported from the package entry, header `LOCAL-EVM BASELINE — recalibrate on Monad at deploy`); verify a re-run of `forge snapshot` on a clean tree diffs empty — .gas-snapshot committed (103 entries, invariants print runs/calls not gas); gasUsed taken from `forge test --gas-report` **Max** per function (solc 0.8.36; max across proxy-direct and impl-context call sites) for 14 KiteCore state-changing fns + 5 MockAUSD fns + deployment costs; ceil(max×1.25/1000)×1000 each; `satisfies Record<string, KiteGasLimit>` typed; re-exported from index.ts; `bun run typecheck` clean; snapshot re-run diffs empty
- [x] T026 Full quickstart.md §0–§6 pass from a clean tree: `forge build --root contracts` green; `forge test --root contracts` → **84 passed; 0 failed**; tier counts 6/39/6/5/2/3/1/10/12 exactly as quickstart §3/§4 prints them; `bun run health` → 9/9 and `bun run build` green — ALL GATES RUN 2026-10-10: §1 build exit 0 (solc 0.8.36); §2 full **104 passed; 0 failed** = MockAUSDTest 10 + KiteScoringTest 20 (rides along, Feature-002) + KiteCoreTest 62 + KiteCoreInvariants 12 — per-suite numbers match quickstart §2 exactly, its "84" total predates the KiteScoringTest ride-along (flagged at T027); §3 testLiteral_ 12 (6+6) with the six demo names verbatim; §4 tiers 12/6/5/2/39/10/3/1 EXACT (testBoundary_ prints 50 total = 39 KiteCoreTest + 11 KiteScoringTest ride-along); §5 SLITHER.md 0-untriaged + .gas-snapshot deterministic (already committed, T024/T025); §6 health **9/9** + build **OK** (turbo 1/1 + forge build exit 0; first attempt failed 8/9 with forge missing — my PATH export dropped ~/.foundry/bin, rerun with full PATH passed)
- [x] T027 Merge (constitution X): commits in-window, one logical group each; **surface research.md D4 (directed-draft + wallet-arg signatures) and D7 (post-termEnd hard stop) to the user as proposed PLAN clarifications BEFORE merging** (CLAUDE.md: never deviate silently); on approval, merge `003-kitecore-mockausd` into `main` `--no-ff` and re-run `forge test --root contracts` + `bun run health` on `main` — surfaced 2026-10-10 (D4, D7 + 6 doc-accuracy notes incl. the T023 "BOTH FAIL" gate unsatisfiability for invariant_01 and quickstart §2's stale 84-total); user approved **"Approve + merge"**; dated clarification block added to PLAN.md §6.2 (verbatim above)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: T001 first; T002 ∥ T003 (different files); T004 + T005 after T002 (need OZ imports), T004 ∥ T005 (different files); NOTHING in Phase 3+ until T005's build is green
- **US1 (Phase 3)**: strict sequence T006 → T015 — MockAUSD first (the rail), then fixture+tests RED, then modules in call order Governed → Identity → ISA(×2) → Stream → Completion, then the GREEN gate
- **US2 (Phase 4)**: after T015 (behavior exists); T016 → T017
- **US3 (Phase 5)**: after T017; T018 → T019 → T020 → T021 → T022 → T023 (all append to the same test files — sequential)
- **Polish (Phase 6)**: T024 after T023 (code final for analysis; Slither fixes may touch `contracts/src/`); T025 after T024 (snapshot on final code); T026 after T025; T027 last

### User Story Dependencies

- **US1 (P1)**: after Phase 2 — the MVP; no story dependencies
- **US2 (P2)**: after US1 (its tests exercise US1's implementations)
- **US3 (P3)**: after US2 (appends to the same suite; handler exercises everything)

### Parallel Opportunities

- T002 ∥ T003 (Phase 2)
- T004 ∥ T005 (Phase 2, after T002)
- Within stories: none — each story is a sequential chain through shared files
- T024/T025/T026/T027 run back-to-back in one shell (order matters: analysis → snapshot → gates → merge)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1–2: branch, OZ pinned, compiling skeletons
2. Phase 3: MockAUSD 10 green → fixture + 6 literal RED → modules in call order → 6 literal GREEN
3. **STOP and VALIDATE**: the §6.3 demo table runs through the real path (quickstart §2+§3 subset: 36 passed) — this is the PLAN §12 Day-2→3 gate for the settlement core
4. US2 (bounds matrix) and US3 (invariants/roles/pause/reentrancy) as time allows, then polish

### Incremental Delivery

1. Branch + deps + skeletons
2. US1 → demo loop MVP (16 new tests green)
3. US2 → fairness/identity matrix (+22)
4. US3 → adversarial tiers + invariant suite (+46: 17 boundary + 6 role + 5 pause + 2 reentrancy + 3 upgrade + 1 init + 12 invariant)
5. Polish → Slither triage, snapshot + published limits, full gates, merge

---

## Notes

- Test names are contractual (contracts/kitecore-api.md); tier counts: 6 `testLiteral_` + 39 `testBoundary_` + 6 `testRole_` + 5 `testPause_` + 2 `testReentrancy_` + 3 `testUpgrade_` + 1 `testInitialize_` + 10 `testMock_` + 12 `invariant_` = **84**
- TDD convention (from Feature 002): behavior-creating tasks add their tests first so the suite COMPILES and fails (RED); implementation flips exactly that tier GREEN. US2/US3 matrix tests exercise already-implemented behavior and must pass on arrival — failures there are src bugs, not test debt
- All money literals in tests are AUSD base units (6 dp): 600e6, 780e6, 480e6, 180e6, 1296e6, 1500e6, 300e6, 1200e6, 1320e6 (constitution VI)
- E2E time jumps: `vm.warp` — panen at +61d/+122d/+183d from activation (≥ 60-day gaps, §6.3 bar)
- Frozen stack: no files outside `contracts/`, `packages/contracts/`, and `specs/`; no Hardhat; OZ pinned to one 5.x tag (plan.md Constraints)
- `--match-test` is a substring regex (Feature-002 lesson): the tier selectors above are name prefixes that occur verbatim
