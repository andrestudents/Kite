---
description: "Task list for Feature 004 — Testnet deployment + demo seed"
---

# Tasks: Testnet Deployment + Demo Seed

**Input**: Design documents from `/specs/004-testnet-deploy-seed/` (spec.md, plan.md,
research.md D1–D14, data-model.md, contracts/deploy-seed-api.md, quickstart.md §0–§7)

**Prerequisites**: PLAN §11.1/§11.3/§6.2/§6.3, §12 Day 4 · constitution I–X ·
Feature 003 merged on `main` (104 tests green). Every task cites its source doc.

**Tests**: included — spec FR-017 makes the suite part of the gate (108 contractual
names in [contracts/deploy-seed-api.md](contracts/deploy-seed-api.md)).

**Organization**: by user story. **(live)** marks tasks that need a funded Monad
testnet wallet from the user's env — the implementer pauses there for secrets or a
user-run command (secrets never enter code, prompts, or git — spec FR-005).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on incomplete tasks)
- **[Story]**: US1 = live verified deployment (P1) · US2 = seeded demo state (P2) ·
  US3 = manual proof loop (P3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: script scaffolding and the two committed docs every later task reads.

- [x] T001 Create `contracts/script/env.example` — every variable name from the
  data-model env matrix (RPC_URL, DEPLOYER_KEY, RELAYER_KEY/ADDR,
  ORCHESTRATOR_KEY/ADDR, PAUSER_ADDR, ADMIN_ADDR, BUDI_KEY, PAKHAJI_KEY, SITI_KEY,
  WATI_KEY, MILL_KEY, MILL_CHANNEL_NAME, AUSD_ADDRESS, EXPLORER_API_KEY,
  DEMO_GAP_SECONDS=60, SEED_AUSD_MIN=14000e6, MON_TOPUP_OPERATOR=1e18,
  MON_TOPUP_PERSONA=0.3e18) with comments only — names, never values; file is
  UNDOTTED because `.env*` is gitignored (research D9)
- [x] T002 [P] Create `contracts/script/DEMO-ACCOUNTS.md` scaffold — public-addresses
  -only manifest (personas, operators, proxy/asset/channel) + the standing
  disclosure header: demo `minEventGap` 60 s vs protocol 60 days (FR-018)

**Checkpoint**: scaffolding committed; no secrets anywhere (names only).

---

## Phase 2: Foundational (Blocking Prerequisites — Q1/A lands here)

**Purpose**: PLAN amended FIRST (rule F1), then the governed-gap refactor with the
suite green. Blocks US1 and US2. **⚠️ No story work before this phase is done.**

- [x] T003 Amend `PLAN.md` BEFORE any contract change (rule F1, research D12 exact
  wording): §6.2 clarification blockquote (MIN_EVENT_GAP → governed initialize()
  parameter, protocol 60 d, testnet demo 60 s, Matocard `minCycleDuration`
  precedent, disclosure obligations), §12 Day-4 line, §3 step 6 → live finale;
  commit the amendment alone
- [x] T004 Refactor `contracts/src/KiteScoring.sol` — `isQualifyingEvent(uint256
  lastEventAt, uint256 at, uint256 gross, uint256 principal, uint256 minGap)`; delete
  the `MIN_EVENT_GAP` constant (library stays pure/stateless); `MIN_EVENT_BPS`
  unchanged (research D3)
- [x] T005 Refactor `contracts/src/modules/Governed.sol` (+`contracts/src/KiteCore.sol`,
  `contracts/src/modules/Stream.sol`): `minEventGap` in the `kite.governed` ERC-7201
  namespace, `initialize(…, uint256 minEventGapSec)` as 6th param (must be > 0),
  `minEventGap()` view, **no setter**; `Stream` passes the stored gap into
  `isQualifyingEvent` (research D3; storage-append only, fresh deployment)
- [x] T006 [P] Update `contracts/test/KiteScoring.t.sol` — all `isQualifyingEvent`
  call sites pass `60 days`; add `testGap_ArgumentControlsQualifyingWindow`
  (same inputs qualify at minGap=1 day, fail at 60 days) → 21 tests
- [x] T007 [P] Update `contracts/test/KiteCore.t.sol` — `setUp` initializes with
  60 days (existing 62 tests unchanged in behavior); rename
  `testInitialize_SetsRolesAssetAndGap`; add `testGap_MinEventGap_SetAtInit_NoSetter`,
  `testGap_Qualifying_At60Seconds_DemoDeployment`,
  `testGap_NonQualifying_At59Seconds_DemoDeployment` → 65 tests; invariants untouched
  (handler still configures 60 days, research D4)
- [x] T008 Gate: `forge test --root contracts` → **108 passed** (10+21+65+12,
  quickstart §1–§2); refresh `contracts/.gas-snapshot`; re-triage the touched src
  files in `contracts/SLITHER.md` (0 untriaged); commit the refactor

**Checkpoint**: PLAN amendment committed first; protocol value 60 d AND demo value
60 s both proven by tests; foundation ready for the stories.

---

## Phase 3: User Story 1 — Live, verified deployment in one command (Priority: P1) 🎯 MVP

**Goal**: DeployKiteCore.s.sol puts asset (Q2/C), implementation, proxy, roles,
channel on Monad testnet, verified on Monadscan; addresses + ABIs published.

**Independent Test**: quickstart §3 — deploy exits 0, manifest prints addresses,
every Monadscan URL shows verified source, roles/minEventGap read back correctly.

- [x] T009 [US1] Create `contracts/script/KiteScriptCommon.s.sol` — shared preflight
  helpers: required-env check aborting by NAME (`EnvMissing`), chain guard
  (`block.chainid == 10143` else `WrongChain`), deployer MON ≥ 0.5e18
  (`DeployerUnderfunded`), asset probe (code + `decimals()==6` +
  balance ≥ SEED_AUSD_MIN → `AssetDecimals`/`AssetFundingShort`), manifest printing
  (deploy-seed-api abort table)
- [x] T010 [US1] Write `contracts/script/DeployKiteCore.s.sol` — Q2/C asset switch
  (unset → deploy MockAUSD; set → preflight first, asset immutable at init);
  KiteCore impl + ERC1967Proxy with `initialize(admin, relayer, orchestrator,
  pauser, ausd, DEMO_GAP_SECONDS)`; post-init on-chain asserts (RELAYER_ROLE,
  ORCHESTRATOR_ROLE exactly on env wallets; `minEventGap()==DEMO_GAP_SECONDS`);
  `registerChannel(1, MILL_CHANNEL_NAME, mill)`; Monadscan verification wiring
  (`--verifier etherscan --verifier-url https://api-testnet.monadscan.com/api`,
  retry + loud `VerificationIncomplete`, research D1/D11); manifest output
- [x] T011 [US1] **(live)** Run the deployment (quickstart §3 command, `-g 115
  --slow`); record the manifest into `contracts/script/DEMO-ACCOUNTS.md`; gate:
  all contracts verified on `https://testnet.monadscan.com` (SC-003)
  (all three VERIFIED 2026-10-10; the monadscan native V1 endpoint is deprecated —
  working path is Etherscan V2 multichain + `--constructor-args-path`; recipe in
  DEMO-ACCOUNTS.md §Source verification)
- [x] T012 [US1] Publish to `packages/contracts`: `src/addresses.ts` (KITE_DEPLOYMENT
  shape from deploy-seed-api — chainId, addresses, `ausdIsMock`, channelId,
  `minEventGapSec`, deployedAt, `as const`), `"gen:abis"` package.json script +
  generated `src/abis/{kitecore,mockausd}.abi.json` (`forge inspect`), exports in
  `src/index.ts` (research D8); `bun run typecheck` green
- [x] T013 [P] [US1] Disclosure rows (FR-018): append-or-create `TRUST.md` section
  "Demo deployment disclosures" — minEventGap 60 s vs protocol 60 d (PLAN §6.2
  clarification reference), which asset is live (`ausdIsMock`), the throwaway ISA
  note; mirror the gap line in `contracts/script/DEMO-ACCOUNTS.md` header and the
  judge note in `contracts/script/MANUAL-LOOP.md` intro (that file is written in
  T020 — carry the note into it there)
- [x] T014 [US1] Commit US1 artifacts (scripts, addresses.ts, abis, TRUST.md rows) —
  quickstart §6 artifact lines green; no secrets (§7 scan dry-run)
  (commit 8e4e8ae; §7 scan over the committed tree: clean)

**Checkpoint**: MVP — the deployment exists on the public chain, verified, published.

---

## Phase 4: User Story 2 — Budi walks in already mid-season, honestly (Priority: P2)

**Goal**: SeedDemo.s.sol produces the exact FR-009 ledger via real calls; asserts
every literal on-chain; skip-idempotent re-runs.

**Independent Test**: quickstart §4 — `bash contracts/script/seed-demo.sh` (~5 min at
60 s gap — 4 sleeps, one before each qualifying event after E1); stage-5 asserts
all-PASS; `cast call scoreOf(Budi)` → 58 and the ISA-3
read → P 600e6 / remaining 480e6 / Active (SC-001).

- [x] T015 [US2] Write `contracts/script/SeedDemo.s.sol` stage 1 — funding leg
  (AUSD to Siti/Wati/Pak Haji + mill with finale headroom; mill
  `approve(KiteCore, max)`; MON top-ups per D13), `bindIdentity` ×4 as relayer,
  ISA-1 draft (Budi→Siti, P 300e6/2000/130) + activate (Siti permit) + E1 (gross
  1500e6); multi-broadcaster `vm.startBroadcast(<env key>)` per role; skip-idempotent
  precondition reads (data-model stage machine; FR-009 literals)
- [x] T016 [US2] Write stages 2–5, ONE qualifying event per stage (per-event gap
  rule, research D5): stage 2 — E2 (gross 450e6 → ISA-1 CompletedCapped, profile
  {1,1,2,1} score 29 maxP 948e6); stage 3 — ISA-2 draft (P 600e6 ≤ 948) + activate
  (Wati permit) + E3 (1500e6); stage 4 — E4 (2400e6 → divert 480e6 → ISA-2 capped,
  profile {2,2,4,2} **score 58**); stage 5 — ISA-3 draft + activate (Pak Haji
  permit) + E5 (1500e6 → remaining 480e6) + the full assert block
  (`SeedAssert(expected, observed)` aborts, FR-012) + persona manifest print; write
  `contracts/script/seed-demo.sh` driver — prints computed wall-clock first
  (4 sleeps ≈ 5 min at gap 60), sleeps `DEMO_GAP_SECONDS + 10` BEFORE EACH
  qualifying event after the first (i.e. before stages 2–5 — qualifying status is
  decided per event, so every one of E2–E5 gets its wait), refuses gap = 0
  (research D5)
- [x] T017 [US2] **(live)** Run `bash contracts/script/seed-demo.sh` against the T011
  deployment; gate: stage-5 asserts PASS + quickstart §4's two cast reads return
  58 and 480e6 (SC-001); fill real persona addresses into
  `contracts/script/DEMO-ACCOUNTS.md`
- [x] T018 [US2] Commit seed artifacts (SeedDemo.s.sol, seed-demo.sh, DEMO-ACCOUNTS)

**Checkpoint**: the §6.3 prepared state lives on the public testnet, honestly built.

---

## Phase 5: User Story 3 — The loop a judge can run by hand (Priority: P3)

**Goal**: cast-only throwaway runbook draft → activate → receiveIncome →
CompletedCapped, with signer helpers that broadcast nothing.

**Independent Test**: quickstart §5 — follow `contracts/script/MANUAL-LOOP.md`
unaided; final reads status 3 / remaining 0; every tx hash on Monadscan (SC-002).

- [x] T019 [P] [US3] Write `contracts/script/SignPermit.s.sol` (ERC-2612 over the
  live asset's domain, chain 10143) and `contracts/script/SignIncome.s.sol`
  (EIP-712 `IncomeEvent` over KiteCore's domain) — read keys from env, print only
  v/r/s, never broadcast, never log keys (research D10)
- [x] T020 [US3] Write `contracts/script/MANUAL-LOOP.md` — runbook: generate two
  throwaway wallets (`cast wallet new`), fund MON + AUSD from the deployer,
  `bindIdentity` via RELAYER_KEY, draft → `SignPermit` → `cast send
  activateWithPermit --gas-limit <published>` → `SignIncome` → `cast send
  receiveIncome --gas-limit <published>` → cap-out event → assert
  `CompletedCapped`/remaining 0 → replay attempt reverts (terminal) → collect
  explorer hashes (FR-014; disclosure note from T013 in the intro)
- [x] T021 [US3] **(live)** Execute the runbook unaided; gate: final state
  CompletedCapped, remaining 0, duplicate income reverts, all hashes resolve on
  Monadscan against the verified proxy (SC-002); note the throwaway ISA id in
  DEMO-ACCOUNTS.md
  (ISA id 10; found the cold-state OOG that killed earlier runs — activate
  limit 256k → 346k from live estimate 276,644; see gasLimits.ts + DEMO-ACCOUNTS.md)
- [x] T022 [US3] Commit runbook + helpers
  (commit af9243c: MANUAL-LOOP.md, SignPermit/SignIncome, ledger note)

**Checkpoint**: PLAN §12 Day-4 done-when satisfied with bare tools.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: the recalibration the constitution promised, and the full validation.

- [x] T023 Recalibrate gas from Monad receipts (quickstart §6): per function,
  `observedMax = max gasUsed` across deploy/seed/runbook receipts; rewrite
  `packages/contracts/src/gasLimits.ts` — `fixedLimit = ceil(observedMax × 1.25 /
  1000) × 1000`, header `MONAD TESTNET MEASURED (chain 10143, 2026-10-…)` replacing
  `LOCAL-EVM BASELINE` (research D7, SC-005)
  (activate 346k from live cold estimate 276,644 — the T021 discovery; income
  observedMax corrected to 194,009, limit kept at the measured cold pass 502k)
- [x] T024 Final validation (quickstart §1–§7 all green): 108-test suite, §2 gap +
  PLAN-first gates, §3–§5 live gates re-confirmed, §6 artifacts + `bun run health &&
  bun run build` (9/9), §7 secrets scan of the whole branch diff (no 64-hex keys,
  `env.example` names only); commit and report — feature done when the user has run
  every gate unaided (constitution IX)
  (user ran §1–§7 unaided, confirmed 2026-10-10; my dry-run side: branch diff clean
  — 0 secrets, 0 env files, only the 5 known ERC-7201 constants. Feature COMPLETE)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: none — start immediately.
- **Phase 2 (Foundational)**: after Phase 1; T003 (PLAN) strictly FIRST, then
  T004/T005 (src), then T006/T007 (parallel, different files), then T008 gate.
  **Blocks all stories** — US1's initialize and US2's compressed gaps both need it.
- **Phase 3 (US1)**: after Phase 2. T009 → T010 → T011 (live) → T012 → T014; T013
  parallel anywhere after T010.
- **Phase 4 (US2)**: after T011 (needs the live deployment). T015 → T016 → T017
  (live) → T018.
- **Phase 5 (US3)**: after T011; T019 can run in PARALLEL with Phase 4 (different
  files); T020 after T019; T021 (live) STRICTLY after T017 — the seed must land
  first so Budi's demo ISA is id 3 (quickstart §4 reads `isaOf(3)`) and concurrent
  broadcasts don't tangle nonces.
- **Phase 6**: after T021 — receipts from deploy + seed + runbook feed T023.

### User Story Dependencies

- **US1 (P1)**: Phase 2 only. MVP alone = a verified, published deployment.
- **US2 (P2)**: Phase 2 + US1's live deployment (T011). Independently testable via
  quickstart §4 once the proxy exists.
- **US3 (P3)**: Phase 2 + T011; helpers (T019) parallel with US2; the live loop
  (T021) after US2's stage-1 funding.

### Within Each Story

Preflight/common before script; script before live run; live run before publishing
what it produces; gates (quickstart sections) are the arbiter, not task checkboxes.

### Parallel Opportunities

- T002 ∥ T001 (Phase 1) · T006 ∥ T007 (Phase 2, after src lands) · T013 ∥ T012
  (US1) · T019 ∥ Phase 4 (US3 helpers vs seed scripts)

---

## Parallel Example: Phase 2 after T005

```bash
Task: "Update contracts/test/KiteScoring.t.sol call sites + testGap_ArgumentControlsQualifyingWindow"
Task: "Update contracts/test/KiteCore.t.sol testInitialize_ + testGap_ trio"
# then the single gate: forge test --root contracts → 108 passed
```

---

## Implementation Strategy

### MVP First (Phase 2 + User Story 1)

1. Phase 1 → Phase 2 (PLAN amendment FIRST, refactor, 108 green).
2. Phase 3 → **STOP and VALIDATE**: quickstart §3 unaided — verified deployment,
   published addresses. That alone unblocks every later PLAN §12 day (relayer,
   app, indexer all point at `addresses.ts`).

### Incremental Delivery

3. Phase 4 → validate §4 (score 58 mid-season state) → 4. Phase 5 → validate §5
   (judge loop) → 5. Phase 6 → validate §6–§7 (recalibrated gas, secrets clean).

### Live-chain tasks (T011, T017, T021)

The implementer executes everything local; live tasks pause for the user's funded
env (`contracts/script/env.example` → private `.env`) or run the quickstart command
together with the user — keys never enter code, prompts, or git (FR-005, SC-004).

---

## Notes

- [P] = different files, no dependency on incomplete tasks. [Story] maps to spec.md
  user stories. **(live)** = needs funded testnet env.
- Commit after each task or logical group (folded into gate tasks T003/T008/T014/
  T018/T022/T024); honest window-dated history, one feature per merge (constitution X).
- Gates are quickstart sections — a task is done ONLY when its gate passes with
  commands the user can run (constitution IX).
- Avoid: touching invariant handler expectations (inline 60-day ghosts stay correct
  at the 60-day config), any `setMinEventGap`, any dotted env file, any secret in a
  committed file.
