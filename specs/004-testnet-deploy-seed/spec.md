# Feature Specification: Testnet Deployment + Demo Seed

**Feature Branch**: `004-testnet-deploy-seed`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Feature 004 — Testnet deployment + demo seed. Source of truth: PLAN §11.1/§11.3, §6.3 (seeded states), §12 day 4. Deliverables in contracts/: script/DeployKiteCore.s.sol — deploy MockAUSD (unless real AUSD with ERC-3009 + permit was confirmed in Q1/Q2), KiteCore implementation + ERC1967 proxy, grant RELAYER_ROLE and ORCHESTRATOR_ROLE to wallet addresses read from ENV, register the mill channel (name + pubkey from env), verify all on the explorer. script/SeedDemo.s.sol — produce the exact demo state, asserting on-chain: Budi profile {totalISAs 2, completed 2, qualEvents 4, distinctBackers 2} → score 58; active ISA P=600, cap=780, remaining=480 (38.5%); Pak Haji funded with AUSD; relayer + orchestrator wallets funded with MON from the deployer. Publish addresses + generated ABIs to packages/contracts (addresses.ts), commit. Rules: private keys ONLY via env vars / cast wallet — never in code, prompts, or git. Gas = measured snapshot values with headroom (§6.2). Done when: cast call shows scoreOf(Budi)==58 and remaining==480e6 on the proxy; a throwaway ISA completes draft→activate→receiveIncome→CompletedCapped manually; all txs on the Monad explorer; addresses committed."

**Implements**: PLAN §11.1 (Monad testnet network + real-AUSD address), §11.3 (accounts and credentials: deployer/relayer/orchestrator wallets funded with testnet MON, Mitra mill channel, seeded phones Budi + Pak Haji), §6.3 (the seeded demo states — score-58 prepared profile and the active ISA at 38.5%), §6.2 (gas is charged on the limit, not usage; testnet parameters), §12 Day 4 (deploy `KiteCore` + asset, seed channel + prepared accounts; done-when: manual `cast` loop draft → activate → receiveIncome → cap), §14 (submission rows: contracts verified on the explorer; the three seeded accounts). Resolves open questions Q1/Q2 (AUSD faucet / ERC-3009 + permit support) at deploy time; implements R6 (prepared states, honestly labeled — "the contract doesn't care about calendar time; the split logic filmed is real"). Constitution IV (contract state recomputable by anyone), VI (integer money), VIII (honesty labeling), IX (done-when gates with commands the user can run unaided), X (honest git history; no secrets in git) + Hard Constraints (gas measured on Monad itself; fixed limits published to `packages/contracts`). Builds on Feature 003 (`KiteCore` + `MockAUSD`, merged to `main`: 104/104 tests, all twelve §6.4 invariants green).

**Resolutions (2026-10-10, user-approved at specify)**: **Q1 → A** — compressed-gap demo deployment: `MIN_EVENT_GAP` becomes a governed `initialize()` parameter (protocol default 60 days; testnet demo value 60 seconds; Matocard `minCycleDuration` precedent), PLAN.md amended FIRST (rule F1), seed sleeps out each gap on the public chain, and the 58 → 91 finale becomes executable live (PLAN §3 step 6). **Q2 → C** — env-switchable asset defaulting to `MockAUSD`, with a strengthened real-AUSD preflight (interfaces + channel-balance sufficiency ~14,000 AUSD). Encoded in FR-001, FR-008, FR-015–FR-018.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - From merged repo to a live, verified deployment in one command (Priority: P1)

Everything Feature 003 proved in tests now exists on the public Monad testnet, produced by one repeatable script and nothing hand-typed: the settlement asset, the `KiteCore` implementation behind its ERC-1967 proxy initialized exactly once, the operator roles landing on the exact wallets named in environment variables (the relayer that will bind identities, the orchestrator that is the CRE simulate signer), and the mill's channel with its name and signing pubkey registered. Every deployed contract is verified on the explorer — a judge, with no prior context, can read the source at the proxy address and watch it execute. The addresses and generated ABIs are published to the shared contracts package, so every later feature (backend, relayer, frontend) imports one file instead of copying hex strings. Private keys exist only in environment variables or `cast wallet`; nothing secret ever appears in code, logs, prompts, or git history.

**Why this priority**: The deployment is the anchor every downstream feature points at (constitution IV: everyone recomputes from this chain state); PLAN §12 Day 4 gates the whole schedule on it, and §14's submission checklist requires verified contracts and stable addresses.

**Independent Test**: Run the deployment script against a funded deployer wallet on the Monad testnet; afterwards, one standard command set shows the proxy initialized, the two operator roles held by exactly the env-named wallets, the channel registered, and explorer URLs render verified source for every deployed contract — with `addresses.ts` committed and importable.

**Acceptance Scenarios**:

1. **Given** a funded deployer wallet and the documented environment variables, **When** the deployment script runs, **Then** the asset, implementation, and proxy are deployed, the proxy is initialized exactly once with the four named operator wallets, and re-running does not attempt a second initialization.
2. **Given** the deployed proxy, **When** role membership is read on-chain, **Then** RELAYER_ROLE and ORCHESTRATOR_ROLE are held by exactly the wallets the environment named (the orchestrator being the CRE simulate signer, §11.3/Q4) — and by no one else beyond the initializing admin.
3. **Given** the mill channel's name and pubkey from the environment, **When** registration completes, **Then** the channel exists, is active, and its registered pubkey matches — so later channel-signed income events verify on-chain.
4. **Given** the deployment finishes, **When** the committed addresses are opened on the Monad testnet explorer, **Then** every deployed contract shows verified source.
5. **Given** any required secret is missing, **When** the scripts preflight, **Then** they abort naming the missing variable — never its value, never an interactive prompt — and nothing has been deployed half-way.

### User Story 2 - Budi walks in already mid-season, honestly (Priority: P2)

The demo does not start from an empty chain (R6: two harvests a year makes live waiting impossible). A seed script produces the exact §6.3/§11.3 prepared state **through the real contract calls — no admin shortcuts, because none exist**: two completed historical ISAs with two different backers whose qualifying events built Budi's profile {totalISAs 2, completed 2, qualEvents 4, distinctBackers 2}, giving `scoreOf(Budi) == 58` and maxP 1,296; then the live demo ISA — Pak Haji funded 600 AUSD in, cap 780, panen 1 settled 1,500 gross → 300 to the backer, 1,200 to Budi, remaining 480 (38.5% mid-season, exactly the §3 step-6 starting point). Pak Haji and the historical backers hold AUSD; the mill's wallet holds enough AUSD to cover the seeded purchase grosses; the relayer and orchestrator wallets hold MON for fees, paid from the deployer. The script asserts every literal on-chain after seeding and exits non-zero on any mismatch. The calendar-deep history is produced with compressed qualifying gaps: the deployment's gap parameter is 60 seconds (protocol default 60 days — FR-016), and the seed script sleeps out each configured gap on the public chain — no time-warp, `block.timestamp` is real. Every artifact labels the demo value plainly — the prepared state is presented as prepared, never as spontaneous (constitution VIII). With the compressed gap, the 58 → 91 finale (panen 2, panen 3) becomes executable live on camera (PLAN §3 step 6, as amended).

**Why this priority**: The §3 demo script, the judges' seeded accounts (§14), and the 58 → 91 finish-line arc all stand on this state; without it the demo starts cold.

**Independent Test**: After seeding, the user runs one standard read command pair and sees `scoreOf(Budi) == 58` and the active ISA's `remaining == 480e6` (P 600e6, cap 780e6) — plus funded balances for Pak Haji, the relayer, and the orchestrator. Every intermediate split matches the §6.3 literals.

**Acceptance Scenarios**:

1. **Given** the deployed proxy and funded wallets, **When** the seed script completes, **Then** on-chain reads show Budi's profile exactly {2, 2, 4, 2} and `scoreOf(Budi) == 58` (History 26 + Consistency 6 + Volume 26).
2. **Given** the seeded profile, **When** the active ISA is read, **Then** its terms are principal 600e6 / share 20% / cap 780e6, backer Pak Haji, status Active, remaining 480e6 — panen 1 settled exactly 300/1,200.
3. **Given** the two historical ISAs, **When** their settlement history is replayed from public data, **Then** each completed at cap with exactly two qualifying events and distinct backers — the profile was built by real completions, not a state write.
4. **Given** the seed's funding leg, **When** balances are read, **Then** Pak Haji holds AUSD for the demo with headroom, the mill's wallet covers the seeded grosses, and the relayer + orchestrator hold MON transferred from the deployer.
5. **Given** any post-seed assertion fails, **When** the script checks, **Then** it exits non-zero printing expected vs observed — never "best effort".

### User Story 3 - The loop a judge can run by hand (Priority: P3)

A throwaway persona walks one full deal lifecycle on the public chain with nothing but `cast` and the committed instructions: draft → activate via permit (one transaction: principal pulled from the backer, paid to the seeker, Active) → a channel-signed income event settled (the split lands in that same transaction) → a final event that reaches the cap and completes the deal automatically — the 🎉 state, `CompletedCapped`, remaining 0, terminal. Every transaction hash is visible on the Monad explorer. This is PLAN §12 Day 4's done-when, and it is deliberately manual: it proves the product works with the UI, backend, and indexer all absent (constitution IV taken literally).

**Why this priority**: It is the honesty proof — the same loop the demo films, executed with bare tools on the public chain, checkable by anyone forever.

**Independent Test**: Following only the committed runbook, the user executes the four steps unaided and ends with on-chain reads showing status `CompletedCapped` and remaining 0; all transaction hashes resolve on the explorer.

**Acceptance Scenarios**:

1. **Given** the committed runbook and funded throwaway wallets, **When** the user runs the draft command, **Then** a Drafted ISA exists with terms inside §6.2 bounds and its intended backer named.
2. **Given** the draft, **When** activation runs with the backer's permit signature, **Then** exactly `principal` leaves the backer and reaches the seeker in one transaction and the ISA is Active.
3. **Given** the active ISA, **When** a channel-signed income event is submitted by the orchestrator, **Then** backer and seeker are paid their exact split in that transaction and remaining decreases by the diverted amount.
4. **Given** remaining below one full share slice, **When** the next income event arrives, **Then** the backer takes exactly the remainder, remaining reaches 0, the ISA completes at cap in that same transaction, and a further income event against it reverts (terminal means terminal).
5. **Given** all four transaction hashes, **When** each is opened on the Monad testnet explorer, **Then** every one resolves against the verified proxy.

### Edge Cases

- **Missing secret**: a required env var absent/empty → preflight aborts naming the variable, never its value; scripts never prompt interactively (FR on secrets).
- **Wrong chain**: RPC resolves to a chain other than Monad testnet 10143 → scripts refuse unless explicitly overridden (protects mainnet and stale local state).
- **Asset fitness (real-AUSD path)**: the configured asset fails a preflight probe (6 decimals, permit, ERC-3009 transferWithAuthorization) → abort **before** proxy init — the asset is immutable at init, so a wrong asset bricks the deployment (PLAN Q1/Q2).
- **Deployer underfunded / faucet rate-limited**: preflight balance check against a stated minimum with a clear message; MON top-up amounts configurable.
- **Verification lag or failure**: the explorer's verifier is slow/down → retry with backoff; deployment is not blocked, but the final report lists any unverified contract loudly (the §14 row stays open until green).
- **Partial seed failure**: one leg reverts mid-seed → the script reports exactly which steps committed (tx hashes) and is re-runnable, skipping steps already visible on-chain (idempotency by on-chain reads, not local files).
- **Seed assertion drift**: any observed ≠ expected literal (score, remaining, balances) → non-zero exit with both values printed; no partial-success reporting.
- **Gas on the limit**: Monad charges the submitted limit, not usage — every transaction carries a fixed limit from the published snapshot with headroom; auto-estimates are never used (§6.2).
- **The calendar blocker (resolved — Q1/A)**: the score-58 profile needs ≥ ~120 days at the 60-day protocol gap (two sequential ISAs × one gap each; they cannot overlap — one Active ISA per seeker). Resolution: the gap is a governed deployment parameter (demo 60 s; PLAN amended first — FR-015/FR-016) and the seed waits out each gap on the live chain. The seed script computes and prints the expected wall-clock duration from the configured gap before starting (at 60 s: four waits — one before each qualifying event after the first — ≈ 5 minutes; at 60 days it would say ~240 days and effectively refuse-by-transparency).
- **Throwaway residue**: the manual loop leaves a completed junk ISA visible on-chain forever → the persona is named/labeled throwaway in the committed docs; acceptable on a testnet, stated plainly.
- **Re-run over the same deployer**: fresh nonces vs used ones; scripts must not assume an empty nonce space and must not attempt re-initialization of an existing proxy.

## Requirements *(mandatory)*

### Functional Requirements

**Deployment (`contracts/script/DeployKiteCore.s.sol`)**

- **FR-001**: A single repeatable deployment script MUST put on-chain: the settlement asset — chosen by environment (Q2/C): unset → deploy `MockAUSD` (PLAN Q1 fallback); set → attach to the configured real testnet AUSD (`0xa9012…22dC`), and ONLY after a strengthened preflight passes on the asset and its funding source: 6 decimals, ERC-2612 `permit`, ERC-3009 `transferWithAuthorization`, and channel-balance sufficiency (~14,000 AUSD covering the full seed + live finale harvests + throwaway loop, with headroom) — aborting with a clear message otherwise, **before** proxy init (the asset is immutable at init); then the `KiteCore` implementation; and the ERC-1967 proxy initialized **exactly once** with the four operator wallets, the asset address, and the demo gap parameter, all sourced from environment variables (§11.1, §11.3, §6.1). `addresses.ts` records which asset is live; application code stays token-agnostic per D11.
- **FR-002**: After initialization, on-chain reads MUST confirm RELAYER_ROLE on the relayer wallet and ORCHESTRATOR_ROLE on the orchestrator wallet (the CRE simulate signer, §11.3/Q4), with the pauser set per its env var; the script asserts this before declaring success (§6.1 Governed).
- **FR-003**: The mill channel MUST be registered at deployment — name and signing pubkey from environment variables — and read back active with a matching pubkey (§6.1 Identity, §6.2 `registerChannel`).
- **FR-004**: Every deployed contract (implementation, proxy, and `MockAUSD` if deployed) MUST be verified on the Monad testnet explorer, using an explorer API key from the environment; the final report prints clickable explorer URLs, and verification failures retry with backoff and end loudly if unresolved (§14).
- **FR-005**: Secrets discipline (constitution X): all private keys and API keys MUST enter only via environment variables / `cast wallet`; scripts MUST NOT contain, log, echo, or prompt for secrets; the preflight MUST abort naming any missing variable by name only; the committed tree and history MUST contain no keys.
- **FR-006**: Scripts MUST refuse to run against any chain whose ID is not Monad testnet `10143` unless an explicit override is set (§11.1).
- **FR-007**: Every transaction MUST be submitted with a fixed gas limit taken from the published measured snapshot values with headroom — never an auto-estimate (Monad charges the limit, §6.2); after the live deployment, observed Monad gas figures MUST recalibrate the published limits in `packages/contracts` so the committed header reflects Monad-measured, not local-EVM, numbers (constitution Hard Constraints; Feature 003's `LOCAL-EVM BASELINE` note).

**Seeding (`contracts/script/SeedDemo.s.sol`)**

- **FR-008**: The seed script MUST produce the exact §6.3/§11.3 prepared state **through real contract calls** (draft → activate → settle → complete — no state-writing shortcuts exist) and assert on-chain afterwards: Budi profile {totalISAs 2, completed 2, qualEvents 4, distinctBackers 2} → `scoreOf(Budi) == 58`; active ISA principal 600e6, cap 780e6, remaining 480e6 (38.5%); the calendar-deep history is produced with the deployment's compressed qualifying gap (Q1/A — governed `MIN_EVENT_GAP` parameter, demo value 60 seconds, FR-016), the script sleeping out each configured gap on the public chain (real `block.timestamp`, no time-warp).
- **FR-009**: The seed ledger MUST be the exact §6.3-consistent one and every split literal asserted: historical ISA-1 (backer A) P 300e6/cap 390e6 with qualifying events gross 1,500e6 → divert 300e6, then gross 450e6 → divert 90e6 → CompletedCapped; historical ISA-2 (backer B, distinct) P 600e6/cap 780e6 with qualifying events gross 1,500e6 → divert 300e6, then gross 2,400e6 → divert 480e6 → CompletedCapped; then the active demo ISA (backer Pak Haji) P 600e6/cap 780e6, panen-1 gross 1,500e6 → 300e6 to backer / 1,200e6 to seeker, remaining 480e6 (every qualifying event after the first preceded by a wait ≥ the configured gap — four waits ≈ 5 minutes at the 60 s demo value; qualifying status is decided per event). Two distinct historical backers are structurally required (History caps at 13 with one backer; 58 needs distinctBackers 2).
- **FR-010**: The funding leg MUST leave: Pak Haji and the two historical backers holding AUSD sufficient for the demo with headroom; the mill's wallet holding AUSD covering all seeded grosses (~7,350e6 plus headroom) with the pull approval the plan phase selects; and the relayer + orchestrator wallets funded with MON transferred from the deployer (§11.3).
- **FR-011**: All amounts everywhere are integer AUSD base units (6 dp); no floating point (constitution VI).
- **FR-012**: Seed income events MUST be signed by the mill's registered key (from env, via `cast wallet`) and settle through the real on-chain verification path (D7) — the seed exercises the same signature checks judges will probe.

**Publishing + manual proof**

- **FR-013**: `packages/contracts` MUST publish `addresses.ts` — chain ID, asset address and **which asset is live** (`MockAUSD` deployed vs real AUSD attached), implementation, proxy, channel id, explorer base URL, and the deployment's configured qualifying gap — plus the generated ABIs for `KiteCore` (and `MockAUSD` if deployed) exported from build artifacts, typed and re-exported through the package index (PLAN §10; Feature 003 deferred ABI export to its first consumer — this is it).
- **FR-014**: A committed runbook MUST let the user execute, unaided and with `cast` only, the throwaway loop draft → activate (permit) → receiveIncome → CompletedCapped on the public testnet, asserting remaining == 0 and terminal status at the end, with all transaction hashes resolvable on the explorer (PLAN §12 Day 4 done-when).

**Governed demo-gap parameter (Q1/A resolution — PLAN first)**

- **FR-015**: PLAN.md MUST be amended FIRST, before any contract change (rule F1; Matocard `minCycleDuration` precedent): §6.2 — `MIN_EVENT_GAP` becomes a governed `initialize()` parameter with the 60-day protocol default and a testnet→production note recording the 60-second demo value; §12 Day 4 — the seed mechanism line; §3 step 6 — with compressed gaps the "3 panen kemudian" finale (58 → 91) executes live on camera instead of being a pre-prepared state.
- **FR-016**: `MIN_EVENT_GAP` MUST become a governed KiteCore parameter set in `initialize()` (demo testnet deployment: 60 seconds); `KiteScoring` stays PURE — `isQualifyingEvent` takes the gap as an argument, no state in the library. The §6.3 formula is unchanged; only the gap's provenance moves from compile-time constant to governed parameter.
- **FR-017**: The Feature-003 suite MUST stay green after the signature change: library-level unit tests keep asserting the real 60-day value (including the §6.3 literal tables), and the invariant suite runs at the configured value — invariants remain demonstrably able to fail (Feature 003 FR-020, unchanged).
- **FR-018**: The demo gap MUST be disclosed wherever a judge looks: TRUST.md, `addresses.ts`, and the judge instructions state the deployed value and that production deployments use 60 days (constitution VIII).

### Key Entities *(include if feature involves data)*

- **Deployment record** (`addresses.ts`): chain ID, asset, implementation, proxy (the Kite address), channel id, explorer base — the single import for every consumer.
- **Operator wallets** (§11.3): deployer (also initializing admin by default), relayer (identity binding), orchestrator (CRE simulate signer), pauser — addresses from env; MON-funded by the deployer.
- **Demo personas**: Budi (seeker, the prepared profile), Pak Haji (active backer), two distinct historical backers (working names Siti and Wati — renameable in plan), Mitra/the mill (channel owner + purchase signer), Throwaway (the manual-loop persona, discarded after).
- **Seed ledger**: the three ISAs of FR-009 with their exact gross/split/remaining sequences — the §6.3 tables instantiated as chain history.
- **Environment contract**: the documented variable names for every wallet, key, RPC, and explorer API key — names committed, values never.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the feature, one standard command the user runs unaided shows `scoreOf(Budi) == 58`, and a second shows the active ISA at principal 600e6 / remaining 480e6 — against the public Monad testnet proxy named in the committed addresses (Q1/A: everything lives on the public chain).
- **SC-002**: 100% of the manual-loop transactions (draft, activate, receiveIncome, cap-completing receiveIncome) resolve on the Monad testnet explorer against the verified proxy, ending in `CompletedCapped` with remaining 0.
- **SC-003**: Every deployed contract shows verified source at its explorer URL, and the URLs are committed.
- **SC-004**: Zero secrets in the repo: a scan of the committed tree and this feature's history finds no private keys or API keys; scripts read environment only and abort by variable name when anything is missing.
- **SC-005**: Published gas limits are recalibrated from Monad-measured observations with headroom, and the published header no longer claims local-EVM-only baselines.
- **SC-006**: A collaborator following only committed documentation (env var list + commands) can re-run the deployment and seed against a fresh funded deployer, or — for the one-shot public deployment — re-verify every SC-001..SC-005 claim with the committed commands.

## Assumptions

- Monad testnet per §11.1: chain ID 10143, RPC `https://testnet-rpc.monad.xyz`, explorer + faucet as documented there; the deployer wallet defaults to the initializing admin unless a separate admin env var is set.
- Persona and operator keys are generated with `cast wallet new` into a gitignored env file; their **public** addresses are recorded in committed seed documentation.
- `MockAUSD` mints its entire initial supply to the deployer at construction (Feature 003), so all AUSD seeding distributes from the deployer; under the real-AUSD resolution (Q2 = real), the faucet funds the deployer instead and MockAUSD is not deployed.
- The gap parameterization follows the approved Q1/A resolution: PLAN amended first (rule F1, Matocard `minCycleDuration` precedent), then a governed `initialize()` parameter — protocol default 60 days, demo testnet value 60 seconds. The 60-day anti-farming property remains proven by library-level unit tests at the real value regardless of what the demo deployment configures.
- The ~14,000 AUSD channel-balance bar covers seed grosses (~7,350) + live finale harvests (2 × 1,500) + the throwaway loop + headroom; the mill's wallet is funded to it before seeding. With the 60 s demo gap, panen 2/3 (the 58 → 91 finale) run live during filming — the seed leaves the chain at remaining 480e6, ready for them.
- The gross pull primitive and channel-signature payload encoding follow the Feature-003 plan decisions; the seed scripts produce mill signatures with the key from env via `cast wallet`, never committing signatures or keys.
- Relayer/orchestrator MON top-ups use modest default amounts overridable by env; persona wallets also receive small MON drips so the manual loop can pay for its own transactions (the relayer drip pattern, PLAN D3, arrives with the backend feature).
- Explorer verification availability is assumed good on demo day; failure is retried and documented, and the §14 "contracts verified" row stays open until green — it is never marked done on trust.
- The throwaway persona's completed ISA remains visible on-chain after the manual proof; docs label it as a smoke test, not demo data.
- Indexer (Envio), backend, relayer service, CRE workflows, and any UI are explicitly NOT part of this feature.

## Out of scope (this feature)

- Backend, relayer service, indexer, CRE workflows, frontend — later PLAN §12 days.
- Swapping the asset after initialization beyond what Q2's env-switchable deploy supports (asset is immutable at init; a later real-AUSD migration means a redeploy, per PLAN Q1's fallback note).
- Monad mainnet; anything requiring real money.
- TRUST.md's full trust narrative (this feature contributes only the rows it owes: the demo-gap disclosure, the live-asset record, the throwaway ISA).
- Demo video, phones, user testing (§12 Days 11–13).
