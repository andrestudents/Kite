---
description: "Task list for Feature 005 — Backend: API, Relayer, Purchase Registry & Reconciliation"
---

# Tasks: Backend — API, Relayer, Purchase Registry & Reconciliation

**Input**: Design documents from `/specs/005-backend-api-relayer/`
(plan.md, spec.md, research.md, data-model.md, contracts/http-api.md, quickstart.md)

**Tests**: Unit tests ARE part of the deliverable (quickstart §2 gate, research D17):
`bun test` over PGlite with the real Drizzle schema — the §7.2 UNIQUE constraints must
actually fire. Tests are colocated with the code they cover (`*.test.ts` beside the
module); every implementation task below carries its test file. Live acceptance is the
three gate scripts (quickstart §3–§5) — SC-001 gasless send, SC-002 purchase → SETTLED,
SC-003 recon mismatch.

**Organization**: Grouped by user story (US1 purchase pipeline = MVP, US2 gasless
relayer, US3 read surface, US4 recon). Setup + Foundational block everything; stories
are independent of each other (US3's reads degrade gracefully without US1 data).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story (US1, US2, US3, US4)
- Exact file paths + verbatim constraints in every description

## Path Conventions

Bun/Turborepo workspaces at repo root (PLAN §10). Run from repo root:
`bun test`, `bun run dev:api` / `bun run dev:relayer`, `bun run db:push`,
`bun run scripts/gates/*.ts|sh`. Chain access is read/write Monad testnet 10143 via
viem; addresses/ABIs/gas limits come from `@kite/contracts` — never re-declared.
Env: root `.env` (gitignored; names in root `env.example`); secrets never printed.

---

## Phase 1: Setup

**Purpose**: Branch hygiene + workspace dependencies before any code (constitution X).

- [x] T001 Create feature branch `005-backend-api-relayer` from `main` (constitution X: one feature per merge; the stray spec-docs commit on `004-testnet-deploy-seed` stays where it is)

- [x] T002 [P] Add runtime deps to `apps/api/package.json` and `apps/relayer/package.json`: `hono`, `viem`, `@kite/core`, `@kite/contracts` + devDep `@types/bun`; add `"dev": "bun run --hot src/index.ts"`; keep `"typecheck": "tsc --noEmit"`. Gate: `bun install && bun run typecheck` green.

- [x] T003 [P] Add deps to `packages/core/package.json`: `drizzle-orm`, `@neondatabase/serverless`; devDeps `drizzle-kit`, `@electric-sql/pglite`, `@types/bun`; exports map `"."` and `"./db"`. Gate: `bun install && bun run typecheck` green.

- [x] T004 Create root `env.example` (backend section — names + non-secret defaults only, the Feature-004 convention): `DATABASE_URL`, `RPC_URL` (default https://testnet-rpc.monad.xyz), `ALCHEMY_RPC_URL` (optional), `RELAYER_KEY`, `ORCHESTRATOR_KEY`, `MILL_KEY`, `DEPLOYER_KEY`, `MITA_API_KEY`, `INTERNAL_API_KEY`, `API_PORT=3000`, `RELAYER_PORT=3001`, `DRIP_MON_WEI=50000000000000000`, `RELAYER_DAILY_CAP_MON_WEI=2000000000000000000`; verify root `.gitignore` ignores `.env`.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared money/FX/schema/auth/chain plumbing every story builds on.

- [x] T005 [P] Create `packages/core/src/money.ts` + `money.test.ts`: `assertMoneyInteger` (rejects non-integers/negatives with `MoneyMustBeInteger` — constitution VI), `capOf(principal, capMult)` = principal × capMult ÷ 100, `progressBps(remaining, cap)` = (cap − remaining) × 10000 ÷ cap; integer math only, safe at demo magnitudes.

- [x] T006 [P] Create `packages/core/src/fx.ts` + `fx.test.ts`: pairs `USD_IDR {rate: 16000, scale: 0}` and `USD_MYR {rate: 4150, scale: 3}` (demo constants), `QUOTE_TTL_MS = 60_000`, `lockQuote(pair, now)` → `{rate, scale, expiresAt}`; source label `"demo-fixed"`; tests use an injected clock (same lock inside TTL, renewal after).

- [x] T007 Create `packages/core/src/db/schema.ts` — every table of [data-model.md](data-model.md), §7.3 columns verbatim, money columns `bigint`: `users(wallet UNIQUE)`, `isas` (chain cache), `purchases` with **`purchase_ref` UNIQUE (channel_id, purchase_ref)** · status text `PENDING|PAID|SETTLED|FAILED` · `mill_sig` jsonb · aux `settled_at`/`failed_reason`, `channels`, `fx_quotes`, `relayer_jobs` (status `pending|sent|confirmed` only · aux `client_ref` UNIQUE NULL, `last_error`, `terminal_at`), `webhook_events` (**`provider_event_id` PK**), `recon_daily` (day PK, status `ok|mismatch`), aux `purchase_transitions`, `ledger_entries`, `drips` (**`wallet` PK** — the one-time lock), `job_state` (key PK). `users` is schema-only this feature — §7.3 mandates it verbatim; it is intentional scaffold for the app feature, with no read/write path yet.

- [x] T008 Create `packages/core/src/db/client.ts` (Drizzle factory: neon-http from `DATABASE_URL` for services; PGlite in-memory for tests) + `packages/core/drizzle.config.ts` + root script `db:push` (drizzle-kit push, then stamp `job_state['recon_baseline_ts'] = now` **only if absent** — research D15). Gate: `bun run db:push` succeeds against Neon; a second run is idempotent (baseline not restamped).

- [x] T009 [P] Create `packages/core/src/auth.ts` + `auth.test.ts`: `verifyApiKey(provided, expected)` via `crypto.timingSafeEqual` (length-mismatch safe, false on missing) — both services wrap it in their Hono middleware (research D11).

- [x] T010 Create `apps/api/src/env.ts` + `apps/relayer/src/env.ts`: the Feature-004 guard pattern — abort with `EnvMissing(<NAME>)` naming the variable, never printing any value; validate addresses implicitly via `KITE_DEPLOYMENT` (chainId 10143).

- [x] T011 Create `apps/api/src/services/chain.ts`: viem `publicClient` with RPC priority `ALCHEMY_RPC_URL → RPC_URL → KITE_DEPLOYMENT.rpcUrl`, JSON-RPC batching OFF (Foundation RPC rejects batches); typed wrappers from `@kite/contracts` ABIs: `isaOf`, `offerOf`/`scoreOf`/`profileOf`, `channelOf`, `identityOf`/`walletOfIdentity`, AUSD `balanceOf`, `minEventGap`; `getLogBlockTimestamp` for the watcher/recon.

- [x] T012 Create `apps/api/src/index.ts`: Hono app factory + error middleware (every error `{error:{code,message}}`, HTTP-mapped; no stack traces, no env/key echo) + route mounting; serve on `API_PORT`. Gate: `bun run dev:api` boots; `bun run typecheck` green.

**Checkpoint**: Foundation ready — `bun test` green so far, db pushable, api skeleton boots.

---

## Phase 3: User Story 1 — A purchase becomes money, then a record (Priority: P1) 🎯 MVP

**Goal**: The §7.2 purchase registry end to end: intent (mill signature captured at creation) → PENDING → PAID → onchain split observed and read back → SETTLED with balanced double-entry ledger — replay-proof on every path.

**Independent Test**: `bun run scripts/gates/purchase-settled.ts` (SC-002, quickstart §4) + `bun test` purchase/ledger/watcher suites — no relayer, no US2/US3/US4 code involved.

- [x] T013 [US1] Create `apps/api/src/services/income-sig.ts` + `income-sig.test.ts`: recompute the EIP-712 digest exactly as `contracts/script/SignIncome.s.sol` — typehash `IncomeEvent(uint64 channelId,uint256 isaId,bytes32 purchaseRef,uint256 gross,bytes32 salt)`, domain `("KiteCore","1",10143,KITE_DEPLOYMENT.kiteCore)`; recover the signer and compare to the channel's registered pubkey; test vector generated+verified with viem in-test.

- [x] T014 [US1] Create `packages/core/src/types.ts` (shared DTO module — Purchase/Job shapes from [contracts/http-api.md](contracts/http-api.md), imported by both services) and `apps/api/src/services/purchase-service.ts` + `routes/purchases.ts` (POST + GET /:id) + `purchases.test.ts` (PGlite): create `PENDING` storing `mill_sig {salt, v, r, s}` captured at creation; constraints verbatim — **`purchase_ref` UNIQUE per channel** (identical duplicate → 200 same purchase, no second row; same ref different payload → `409 purchase_ref_conflict`); non-integer/negative money → `422 money_must_be_integer`; signature (T013) must verify against an ACTIVE channel and an existing isa; `x-api-key` = MITA key; response = the purchase DTO of [contracts/http-api.md](contracts/http-api.md).

- [x] T015 [US1] Extend `routes/purchases.ts` + `purchase-service.ts` with `POST /api/channel/purchases/:id/paid` (**MITA key** — the http-api.md auth decision: the mill's console owns its payment transitions) and the append-only transition log: `purchase_transitions(from_status, to_status, actor, created_at)` row per change; **forward-only PENDING → PAID** (anything else → `409 invalid_transition`, attempt logged; the PAID → FAILED terminal transition is internal — submit-settlement/watcher only, T019 — never an HTTP route); no update/delete path exists for purchases or transitions (+tests).

- [x] T016 [P] [US1] Create `apps/api/src/services/ledger.ts` + `ledger.test.ts`: `writeSettlement(purchase, {gross, toBacker, toSeeker})` — one `in` row (`channel:<id>`, gross), `out` rows (`backer:<addr>` toBacker, `seeker:<addr>` toSeeker); per-purchase **Σ in == Σ out == gross** asserted by the writer and by tests; append-only (no update/delete path exists).

- [x] T017 [P] [US1] Create `apps/api/src/jobs/sync-registry.ts`: upsert `channels` (from `channelOf`) and `isas` cache rows (from `isaOf`) from chain — the projection-correctness bootstrap used by the watcher, `/api/me`, `/api/p/:id` (constitution IV). Runnable: `bun run apps/api/src/jobs/sync-registry.ts`.

- [x] T018 [US1] Create `apps/api/src/jobs/watch-settlements.ts` + `watch-settlements.test.ts`: poll `eth_getLogs(proxy, topic0 = IncomeSettled)` in bounded ranges (default 2,000 blocks per call; first checkpoint seeded from the deployment block) from checkpoint `job_state['settlements_block']`; export the processing pass as `processNewLogs()` so submit-settlement and the gates drive observation in-process (T019/T020 — SC-002 needs no separately-running watcher); claim each log via `webhook_events.provider_event_id = "10143:<block>:<logIndex>"` (**UNIQUE — a replayed/double-delivered log is a no-op**); match a PAID purchase by (channelId, indexed purchaseRef) → SETTLED with `tx_hash` + `settled_at` = block timestamp, ledger rows via T016, `isas` cache refreshed from `isaOf()` (the FR-009 read-back — DB corrected FROM chain, never the reverse); unmatched events increment `job_state['unmatched_settlement_events']`. Tests: settle path, double-delivery no-op, out-of-order checkpoint resume.

- [x] T019 [US1] Create `apps/api/src/jobs/submit-settlement.ts` + `submit-settlement.test.ts` — prints its **Demo Tool** banner (constitution VIII): loads the purchase's stored `millSig`, submits `receiveIncome(isaId, purchaseRef, gross, salt, v, r, s)` from a viem wallet on `ORCHESTRATOR_KEY` at `KITE_GAS_LIMITS.receiveIncome.fixedLimit` (gas charged on the limit — never estimate), then runs the watcher pass **in-process** (imports `processNewLogs()` from T018 — no separate watcher process) until the purchase is SETTLED. **FAILED terminal path (spec US1-AC4)**: a terminal revert (deal no longer Active / cap reached) marks the purchase FAILED with `failed_reason` and appends the PAID → FAILED transition row. `submit-settlement.test.ts` exercises exactly that: mocked walletClient reverting terminally → purchase FAILED + `failed_reason` set + transition row appended + exit 1. Exits 0 settled / 1 failed (research D8).

- [x] T020 [US1] Create `scripts/gates/purchase-settled.ts` (SC-002): fresh purchaseRef + salt, mill-signs via `MILL_KEY` in-process (T13 encoding), POST intent → paid → submit-settlement (drives the watcher pass in-process — the gate is self-contained; nothing else to start) → await SETTLED → assert txHash recorded, ledger Σ in == Σ out, and the DB deal copy equals onchain `isaOf()` (remaining/status). Prints every step's evidence (ids, tx hash, sums). Exit 0/1.

**Checkpoint**: US1 fully functional — `bun run scripts/gates/purchase-settled.ts` PASS on testnet.

---

## Phase 4: User Story 2 — Money moves with zero MON on the sender (Priority: P2)

**Goal**: The serialized relayer: enqueue → claim → send at published fixed gas → nonce resync → receipt → **onchain read-back** → confirmed; four job kinds; one-time drip; the sender of a gasless transfer never needs MON.

**Independent Test**: `bun run scripts/gates/gasless-send.ts` (SC-001, quickstart §3) + `bun test` queue/send/jobs suites — no US1/US3/US4 code involved.

- [x] T021 [US2] Create `apps/relayer/src/index.ts` (Hono on `RELAYER_PORT`, INTERNAL key via T009) + `queue.ts` + `queue.test.ts` (PGlite): `POST /jobs {kind, payload, clientRef?}` → `202 {jobId}` (**duplicate clientRef → 200 existing job — idempotent enqueue**; unknown kind → `400 unknown_kind`; whitelist EXACTLY `activate_with_permit | transfer_with_authorization | bind_identity | drip` per FR-015); `GET /jobs/:id` → `{id, kind, status, attempts, txHash, lastError, terminalAt}`; worker claims one `pending` job via `SELECT … FOR UPDATE SKIP LOCKED` — **one transaction in flight per key, always** (research D5); tests include the US2 restart scenario: a job left in `sent` by a simulated crash is re-claimed exactly once and never double-sent.

- [x] T022 [US2] Create `apps/relayer/src/send.ts` + `caps.ts` + `send.test.ts` (mocked walletClient): viem wallet on `RELAYER_KEY`; every tx carries `gas: fixedLimit` from `@kite/contracts` (never `estimateGas` — research D10); **nonce resync** against `eth_getTransactionCount(relayer, "pending")` before each send (research D6 — the same key is reused by hand in MANUAL-LOOP, drift is expected); capped backoff retry (`attempts`++, `last_error`), `terminal_at` when exhausted — **every resend is gated on a previous-job status check, never blind** (FR-013); tests include nonce drift after a simulated restart (the chain `pending` count wins) and the pre-resend status gate; `caps.ts` blocks the day's drip/native sends beyond `RELAYER_DAILY_CAP_MON_WEI`.

- [x] T023 [P] [US2] Create `apps/relayer/src/jobs/bind-identity.ts` + `drip.ts` (+ `jobs.test.ts`): bind → `bindIdentity(wallet, identityHash)` at the published limit, read-back `identityOf(wallet) == identityHash`; drip → **`drips` PK (wallet) guarantees exactly one transfer ever**, amount `DRIP_MON_WEI`, read-back `getBalance(wallet)` increased (FR-017; concurrent duplicates collapse on the PK).

- [x] T024 [P] [US2] Create `apps/relayer/src/jobs/transfer-with-authorization.ts` (+ case in `jobs.test.ts`): payload `{from, to, valueAusd, validAfter, validBefore, nonce, v, r, s}` → `transferWithAuthorization` at `MOCK_AUSD_GAS_LIMITS.transferWithAuthorization.fixedLimit`; read-back = receipt logs parse to the AUSD `Transfer(from, to, value)` event (MockAUSD has NO `authorizationState()` view — the event is the proof; a revert never emits it → retry, never confirm; research D7).

- [x] T025 [P] [US2] Create `apps/relayer/src/jobs/activate-with-permit.ts` (+ case in `jobs.test.ts`): payload `{isaId, deadline, v, r, s}` → `activateWithPermit` at `KITE_GAS_LIMITS.activateWithPermit.fixedLimit`; read-back `isaOf(isaId).status == 2` (Active).

- [ ] T026 [US2] Create `scripts/gates/gasless-send.ts` (SC-001): two throwaway viem accounts; fund the sender with AUSD from `DEPLOYER_KEY` (a plain ERC-20 transfer — the sender NEVER holds MON); sender signs EIP-3009 `TransferWithAuthorization` over `("AUSD","1",10143,ausd)`; enqueue with a clientRef; await `confirmed`; assert recipient balance increased, sender MON == 0 before and after, confirmation followed the read-back; `--replay` re-enqueues the same clientRef → the same job returns, exactly one transfer onchain. Exit 0/1.

**Checkpoint**: US1 + US2 both independently green.

---

## Phase 5: User Story 3 — One response per screen (Priority: P3)

**Goal**: The read surface: health tells the truth, quote locks 60 s, `/api/me` merges chain-authoritative state, `/api/p/:id` is public and personal-data-free — every payload integer-money and banned-words-clean.

**Independent Test**: `bun test` route suites + quickstart §6 curls (empty-state /me, TTL-locked quote, degraded health, public profile with no personal fields).

- [x] T027 [P] [US3] Create `apps/api/src/routes/health.ts` + `health.test.ts`: GET /api/health probes db (SELECT 1) and rpc (chainId/blockNumber); per-dependency `{ok, detail}` + top-level `ok|degraded` — **never a false ok** (FR-001; test flips a probe to down).

- [x] T028 [P] [US3] Create `apps/api/src/services/quote-service.ts` + `routes/quote.ts` + `quote.test.ts`: fx_quotes row per pair (`rate`, `expires_at` = now + 60 s); inside the TTL the SAME locked row returns; expired → new lock written; `?pair=USD_MYR` supported; unknown → `400 unknown_pair`; response `{pair, rate, scale, expiresAt, source: "demo-fixed"}` (FR-002, D13).

- [x] T029 [P] [US3] Create `apps/api/src/services/me-service.ts` + `routes/me.ts` + `me.test.ts` (mocked chain client): `x-kite-wallet` header identity; ONE merged response per [contracts/http-api.md](contracts/http-api.md) — `balanceAusd`, `profile {score, maxSupportAusd, …}` and `activeIsa {terms, remainingAusd, progressBps}` read from the proxy (constitution IV — values equal direct `isaOf`/`profileOf` reads), `recentPurchases` from DB; **empty state is a valid 200**: score 0, maxSupportAusd 600000000, activeIsa null (never an error).

- [x] T030 [P] [US3] Create `apps/api/src/services/profile-service.ts` + `routes/profile.ts` + `profile.test.ts`: `:id` accepts a 0x-bytes32 identityHash (`walletOfIdentity`) OR a wallet address (D12); response = reputation + deals[] with per-event history (from observed settlements + isas cache) + `explorerBaseUrl`; **the response shape contains NO personal-data fields** (no name/phone/documents — structural assert in the test); unknown id → `404 profile_not_found` identical for never- and once-existed.

- [x] T031 [US3] Create `apps/api/src/banned-words.test.ts` (research D18): render me/profile/quote fixtures and fail on any of `wallet | gas | chain | token | onchain transaction | seed | pending` in any human-readable string **value** — JSON keys and uppercase machine states are exempt (data, not copy — `/api/me` legitimately carries a `wallet` field name) (constitution I).

**Checkpoint**: All four stories independently functional.

---

## Phase 6: User Story 4 — Books that can fail loudly (Priority: P4)

**Goal**: Daily recon: backend settled totals vs chain IncomeSettled sums (post-baseline), one `recon_daily` row, exit 0/1/2 — never a silent repair.

**Independent Test**: `bun run scripts/gates/recon.sh` (SC-003, quickstart §5) + `recon.test.ts` (ok / mismatch / infra-no-row / zero-settlement day → ok with both totals 0).

- [x] T032 [US4] Create `apps/api/src/jobs/recon.ts` + `recon.test.ts`: default day = yesterday UTC (`--day YYYY-MM-DD` override); backend side = Σ `gross` over purchases SETTLED with `settled_at` in the day; chain side = Σ `gross` over IncomeSettled logs with block timestamp in the day AND **≥ `recon_baseline_ts`** (eth_getLogs + getBlock timestamps); upsert `recon_daily(day PK, backend_total, chain_total, status)`; **exit 0 ok · 1 mismatch (row written) · 2 infra (NO row)**; the job never writes to purchases/ledger/chain (FR-019..021, D16).

- [x] T033 [US4] Create `scripts/gates/recon.sh` (SC-003): (1) clean day → `{ok, totals equal}`, exit 0; (2) inject a fake SETTLED purchase → rerun → mismatch row with both totals, **exit 1, injection untouched** (nothing repaired); (3) dead RPC URL → exit 2, no verdict row; (4) cleanup of injected data. Exit 0/1 overall.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide gates, conformance, and the final Done-when pass.

- [x] T034 Wire + verify root tooling: `package.json` scripts (`dev:api`, `dev:relayer`, `db:push`, `test`) all present; `bun run health` → 9/9; `bun run typecheck` green; `bun run lint` (biome) clean.

- [x] T035 PLAN §7.3 conformance check: side-by-side of `packages/core/src/db/schema.ts` vs the §7.3 table sketch (8 tables, column-for-column) documented in the task completion note; aux tables match [data-model.md](data-model.md) exactly; any drift is fixed or flagged as a PLAN clarification — never a silent deviation (constitution: PLAN wins).
  - Completion note (T035): all 8 core tables column-for-column vs PLAN §7.3. MATCH: users(7), isas(9), channels(4), fx_quotes(4), recon_daily(4), purchases core(9). Two documented strengthenings, none silent: (1) purchases.purchase_ref is UNIQUE(channel_id, purchase_ref) per §7.2 rule 1 + data-model.md (PLAN sketch says bare UNIQUE — refinement recorded in the committed spec; raise a PLAN clarification if global uniqueness is wanted); (2) webhook_events.provider_event_id is the PK (implies UNIQUE). Aux columns match data-model.md exactly: relayer_jobs + client_ref/last_error/terminal_at (D5/D15), purchases + settled_at/failed_reason (D15); aux tables purchase_transitions/ledger_entries/drips/job_state column-for-column. No other drift.

- [x] T036 Full quickstart §0–§7 pass on Monad testnet (the feature Done-when, constitution IX): `bun test` green; `bun run scripts/gates/gasless-send.ts`, `purchase-settled.ts`, `recon.sh` all PASS with printed evidence; §6 replay/curl pokes verified; §7 secrets checklist reviewed (no key value in any committed file or log line).
  - Completion note (T036, 2026-10-11): one command runs everything — **`bash scripts/gates/run-all.sh`** (sources .env via the CRLF-safe `load-env.sh`, boots its own relayer, runs the four gates, prints a summary table, exits non-zero on any failure). Final full run: **T036: ALL GATES PASS, exit 0**.
    - Gate 1 `bun test`: 126 pass / 0 fail / 447 expects / 19 files (88.9s).
    - Gate 2 gasless-send (SC-001): job 4 confirmed tx `0x09a38dc07518b457cb2179e74992b91f042af6a67b658816c46f3b0bcdfbeca9`; sender `0x89527A…B40Ab` monWei=0 before and after; recipient `0x23354a…17d11` ausd=1000000; AUSD `Transfer` log present in the job tx receipt.
    - Gate 3 purchase-settled (SC-002): deal 3 (shareBps 2000), purchase `6e90b6d2-099b-4187-9045-02bf53d800df`, PENDING→PAID→SETTLED, settlement tx `0xa850f689672ba39ed59b82b033ea17af90dbf3443bdf55f71e6a71a4b2210df8`; ledger 3 rows in=out=1000000; remaining 479400000→479200000 = the toBacker slice (KiteScoring.divert); cached isas row == contract read.
    - Gate 4 recon (SC-003): clean day → exit 0 (`backend=0 chain=0 ok`); injected 500000000 → exit 1 mismatch with BOTH totals, injection untouched; dead RPC → exit 2 with NO verdict row; cleanup removed the injection + this gate's verdict rows.
    - Live-stack defects surfaced and fixed this pass (126 PGlite-backed tests could not catch them): (1) CRLF .env vs bash `source` → `scripts/gates/load-env.sh` parse loop (never executes a line); (2) `bun run <package-script>` does not inherit bun's dotenv (1.4.2) → `scripts/db-push.ts` passes the URL by argv; (3) drizzle 0.44.7 tags entityKind as a static SYMBOL — atomic.ts misrouted neon-http into `db.transaction` ("No transactions support") → `Symbol.for("drizzle:entityKind")` lookup + `atomic.test.ts` regression; (4) Alchemy free tier caps eth_getLogs at 10 blocks → chunked concurrent scan in chain.ts; range-scan gates pin `ALCHEMY_RPC_URL=""` (public RPC caps at 100, ~25 req/s); (5) hexToSignature's v is a bigint (JSON.stringify refuses) → gate sends v as a number; the uint256 wire contract (decimal strings at the edge, exact BigInts at the handler) is proven over HTTP in wire.test.ts with the gate's exact payload shape.
    - §7 secrets checklist: no key VALUE in any committed file or log line — .env inspected by NAME only (masked greps), never printed, never staged; recon prints totals only.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: immediate; T002/T003 parallel after T001.
- **Foundational (Phase 2)**: after T003 (core deps); T005/T006/T009 parallel; T007 → T008 sequential (schema before push); T010–T012 sequential (env → chain → app). **Blocks all stories.**
- **User Stories**: after Phase 2, independent of each other; build in priority order US1 → US2 → US3 → US4 (US3's reads degrade gracefully with empty DB, but its tests want US1's observed data for realistic fixtures).
- **Polish**: after all stories.

### User Story Dependencies

- **US1**: T013 → T014 → T015 sequential (same files); T016/T017 parallel alongside; T018 needs T014–T017; T019 needs T018; T020 needs all.
- **US2**: T021 → T022 sequential; T023/T024/T025 parallel job files; T026 needs T021–T025.
- **US3**: T027–T030 parallel route files; T031 after them.
- **US4**: T032 → T033.

### Parallel Opportunities

- Phase 2: T005 ∥ T006 ∥ T009, then T007 → T008, T010 → T011 → T012.
- US1: T016 ∥ T017 while T014/T015 land.
- US2: T023 ∥ T024 ∥ T025 (three job files, queue contract fixed by T021/T022).
- US3: T027 ∥ T028 ∥ T029 ∥ T030 (four route/service pairs, distinct files).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + 2 (setup, schema, chain, app skeleton).
2. Phase 3 (US1) — purchase → split → SETTLED.
3. **STOP and VALIDATE**: `bun run scripts/gates/purchase-settled.ts` PASS.
4. This alone proves the §7.2 money rules end to end (PLAN §12 Day 5–6 gate).

### Incremental Delivery

US2 adds the gasless legs (Agora/D11 claim) → US3 adds every screen's data → US4 adds the honesty backstop (D16). Nothing later rewrites anything earlier.

---

## Notes

- Commit after each task or logical group (constitution X: window-dated, one feature per merge).
- Every gate command must be runnable by the user unaided (constitution IX).
- Gas limits: always the published `fixedLimit`, never an estimate (Monad charges on the limit; 004's cold-state lesson is baked into the numbers).
- Secrets: env-only, never printed — `EnvMissing(<NAME>)` names the variable, nothing more.
