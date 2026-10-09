# Feature Specification: KiteCore Settlement Contract + MockAUSD

**Feature Branch**: `003-kitecore-mockausd`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "Feature 003 — KiteCore (UUPS proxy, ERC-7201 modules) + MockAUSD. Source of truth: PLAN.md §6.1 (contracts), §6.2 (state, functions, parameters, pause), §6.4 (invariants). Modules: Governed, Identity, ISA, Stream, Completion, flagMismatch. MockAUSD: ERC-20, 6 dp, ERC-3009 transferWithAuthorization + ERC-2612 permit. Tests: EVERY invariant in §6.4 as Foundry invariant tests; role tests; reentrancy on activateWithPermit and receiveIncome; the §6.3 numbers pass end-to-end through receiveIncome; Slither run with written triage of every finding; forge snapshot committed and published limits written to packages/contracts. Done when: forge test + invariant suite green, snapshot committed, Slither triage documented in contracts/SLITHER.md."

**Implements**: PLAN §6.1 (contract inventory), §6.2 (state, functions, testnet parameters, asymmetric pause), §6.3 (literal numbers through the real settlement path), §6.4 (all twelve invariants as acceptance tests), §10 (`packages/contracts` publishing), §12 Day 2–4. Design decisions D4 (identity binding), D5 (atomic split), D6 (fairness bounds), D7 (onchain channel signatures + replay registry), D8 (no default state), D10 (one UUPS proxy, ERC-7201 modules), D11 (gasless ERC-3009/permit funding). Constitution II, III, IV, V, VI, VII, IX, X. Builds on Feature 002 (`KiteScoring` library, merged).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The demo loop, end to end, onchain (Priority: P1)

The entire §3/§6.3 demo journey executes on the settlement contract with real transaction mechanics, no shortcuts: Budi is verified; Pak Haji funds 600 AUSD in ONE gasless transaction (his signed authorization pulls the principal and pays the seeker — activation and funding are the same event); the deal is live with a 780 AUSD cap. Harvest day: the mill's signed purchase event arrives, and in that single transaction the gross enters and leaves as an exact split — panen 1: backer +300, seeker +1,200; panen 2: 300/1,200 again; panen 3: 180/1,320 and the deal is finished forever, exactly at the cap. At the finish line the seeker's reputation jumps 58 → 91 precisely as the §6.3 table prints. The money rail is the testnet mock of the settlement asset: same 6-decimal unit, same permit and gasless-transfer authorizations as the real asset, so nothing changes when the real one is swapped in.

**Why this priority**: This IS the product claim (constitution III: the split lives inside settlement) and the constitution IX gate — the §6.3 numbers must pass through the real path, not a library call. Everything else in this feature exists to make this journey honest.

**Independent Test**: One end-to-end scenario with every literal number asserted: fund 600 → cap 780 → three time-separated harvests of 1,500 gross → splits 300/1200, 300/1200, 180/1320 → auto-finish at cap → reputation 58 → 91. Includes the mock asset's permit path being exercised for the funding leg.

**Acceptance Scenarios**:

1. **Given** a registered channel (the mill) and a verified seeker with prepared reputation {2,2,4,2} (score 58, maxP 1,296), **When** a backer activates a 600 AUSD / 20% / 1.3× deal via one signed authorization, **Then** exactly 600 leaves the backer, exactly 600 arrives at the seeker in the same transaction, the deal is Active, and its remaining cap is 780.
2. **Given** the active deal, **When** a channel-signed harvest event of 1,500 gross arrives, **Then** the backer receives 300 and the seeker 1,200 in that same transaction, and the deal's remaining is 480.
3. **Given** two harvests already settled (remaining 180), **When** the third channel-signed harvest of 1,500 arrives, **Then** the backer receives 180, the seeker 1,320, remaining becomes 0 and the deal completes at cap — automatically, in that transaction. The reputation jump to {3,3,7,3} → score 91 happens at this completion.
4. **Given** any of the three harvest events, **When** it settles, **Then** the settlement record carries gross, backer amount, seeker amount, and remaining — enough for any observer to replay the §6.3 table from public data alone (constitution IV).

### User Story 2 - Unwritable unfairness, unwipeable identity (Priority: P2)

A predatory deal cannot exist because it cannot be written: shares outside 10–20%, multipliers outside 1.2–1.5×, terms beyond 24 months, principals above the seeker's reputation-derived maximum, unknown channels, or a seeker who already has a live deal — every one reverts at creation, before any money can move (constitution II). And the reputation cannot be laundered: one identity, one account, both directions, forever — a finished-or-wiped actor cannot come back with a fresh account and a clean 600-limit (D4). Before activation, either party can still walk away (cancel); after, the deal's life is governed only by its terms.

**Why this priority**: Fairness-as-physics and identity permanence are the two properties every later feature (offers, profiles, public pages) assumes. They are independently testable as pure input matrices.

**Independent Test**: A bounds/identity matrix — every out-of-bounds term reverts, every boundary value (share exactly 1000/2000, cap exactly 120/150, term exactly 24 months, principal exactly maxP) is accepted; double identity bindings revert in both directions; a second live deal for the same seeker reverts; cancel works only pre-activation and only once.

**Acceptance Scenarios**:

1. **Given** a verified seeker (maxP 1,296 AUSD), **When** a draft is created with share 21% (or 9%, or cap 1.51×, or 1.19×, or term 24 months + 1 second, or principal 1,297), **Then** the creation reverts and no state changes.
2. **Given** the same seeker, **When** a draft is created with share exactly 10% or 20%, cap exactly 1.2× or 1.5×, term exactly 24 months, or principal exactly 1,296, **Then** the draft is accepted (boundaries inclusive).
3. **Given** an identity hash already bound to account A, **When** anyone attempts to bind that hash to account B — or bind a second hash to account A, **Then** both attempts revert (one-to-one, both directions, immutable).
4. **Given** a seeker with a live (Active) deal, **When** anyone attempts to draft a second deal for them, **Then** creation reverts; **When** the live deal completes, **Then** a new draft becomes possible.
5. **Given** a Drafted (not yet funded) deal, **When** either party cancels, **Then** it is Cancelled — permanently; cancellation of an Active or terminal deal reverts.

### User Story 3 - Nothing dishonest is possible (Priority: P3)

Every actor is confined to what the PLAN allows: the orchestrator can only feed signed facts, finish expired deals, and flag mismatches — it can never move funds by any other door; the relayer can only bind identities; the pauser can stop NEW risk but can never trap income or forgiveness (asymmetric pause, constitution VII). Forged income is impossible even if every offchain component is compromised: the mill's signature is verified onchain, and every fact is single-use — a replayed purchase (same reference, same amount, same salt) reverts forever. Terminal deals are terminal: no income settles against a finished or cancelled deal, and nothing resurrects them. A deal that outlives its term ends by forgiveness — anyone can trigger it, nobody can block it, and it never pays more than the cap. Reentrant calls during funding or settlement change nothing. Every finding from automated security analysis is triaged in writing — fixed, or justified — never ignored.

**Why this priority**: These are the §6.4 invariants — the trust boundary the judges and the TRUST.md narrative stand on. They gate "done" as hard as US1 does, but they harden a journey that US1 already proves possible.

**Independent Test**: The full invariant suite — all twelve §6.4 properties held across randomized sequences of legal and adversarial actions (invariant tests with deliberately hostile actors), plus a role matrix (relayer/orchestrator/pauser/upgraded-implementation each attempting every fund-moving door), plus reentrancy attack contracts, plus the pause-asymmetry checks — and a written triage of every static-analysis finding.

**Acceptance Scenarios**:

1. **Given** a compromised orchestrator key but an honest mill, **When** the orchestrator submits an income event with a forged or altered signature, **Then** the transaction reverts — the signature is checked onchain (D7), and this holds even while the system is paused.
2. **Given** a successfully settled purchase event, **When** anyone resubmits the identical event (or its signature), **Then** it reverts — each fact is usable exactly once, forever.
3. **Given** a Completed (capped or term-forgiven) or Cancelled deal, **When** any income event or state-changing operation targets it, **Then** it reverts — terminal means terminal.
4. **Given** a paused system, **When** someone tries to draft or activate, **Then** blocked; **When** income arrives or a term expires, **Then** settlement and forgiveness still execute (asymmetry).
5. **Given** the relayer, orchestrator, or pauser keys, **When** their holders attempt any fund movement not in the §6.2 function list, **Then** every attempt fails; the settlement contract never holds user money beyond the instant of an atomic pass-through.
6. **Given** a deal past its term end with remaining cap unfulfilled, **When** anyone calls the forgiveness function (even while paused, even twice), **Then** the remainder is forgiven, the deal is terminal, the second call does nothing, and the seeker's record updates once.

### Edge Cases

- Activation with an expired authorization deadline, a malformed signature, or insufficient balance/allowance → reverts with no partial state (no principal pulled, deal stays Drafted).
- Income event whose signature is valid but whose channel differs from the deal's channel → reverts.
- Zero-gross income event → settles 0/0, diverts nothing, never counts as qualifying (failed-harvest mechanics, D8) — permitted, not an error.
- Income event that qualifies on size but arrives < 60 days after the deal's last qualifying event → splits normally, adds no score credit.
- Income where the share slice exactly equals the remaining cap → backer takes exactly the remainder; completion fires in the same transaction.
- `completeAtTerm` before term end → reverts; after completion → no-op (idempotent).
- Backer's authorization (permit) replayed after activation → already consumed by nonce; reverts.
- Gasless-transfer authorization (ERC-3009) reused or expired → reverts; authorization is single-use by nonce.
- Upgrade to a new implementation → all storage and deal states survive exactly (namespaced storage); unauthorized upgrade attempts revert.
- `registerChannel` with a duplicate id → reverts; deactivating a channel (default, documented): blocks new drafts naming it, while its already-active deals run to term — plan may tighten.
- Seeker attempts to draft while their previous deal is Drafted but not active → allowed (only ACTIVE blocks), documented default.
- Principal exactly equals the seeker's maxP → accepted (≤ is inclusive).
- Score invariant under adversarial action sequences: stays in [0,100] and changes ONLY at completions (never mid-deal).

## Requirements *(mandatory)*

### Functional Requirements

**Governed (§6.1 modules/Governed)**

- **FR-001**: The system MUST define the four roles — ADMIN, RELAYER_ROLE, ORCHESTRATOR_ROLE, PAUSER — with ADMIN alone granting/revoking them; authorization to upgrade the proxy logic rests with ADMIN (§6.1, §6.2).
- **FR-002**: The pause MUST be asymmetric: `pause()` (PAUSER) blocks ONLY `createISADraft` and `activateWithPermit`; `receiveIncome` and `completeAtTerm` MUST remain callable while paused, always (§6.2 pause row, constitution VII, §6.4 #10).

**Identity (§6.1 modules/Identity)**

- **FR-003**: `bindIdentity(identityHash)` (RELAYER_ROLE) MUST enforce a one-to-one, immutable binding in both directions — one identity hash per account, one account per identity hash; any collision reverts (D4, §6.4 #5).
- **FR-004**: `registerChannel(id, name, pubkey)` MUST record the channel's identity and signing pubkey, with duplicate ids reverting (ADMIN-gated; the demo deployment grants this right to the demo relayer as configuration, not code).

**ISA (§6.1 modules/ISA)**

- **FR-005**: `createISADraft(terms)` (verified seeker) MUST revert unless ALL of: share ∈ [10%, 20%], cap multiplier ∈ [1.2×, 1.5×], term end ≤ now + 24 months, principal ≤ the seeker's score-derived maximum, the named channel exists, and the seeker has no Active deal (§6.2 parameters, D6, §6.4 #6). Boundaries are inclusive. An accepted draft starts with remaining = principal × capMult ÷ 100 exactly.
- **FR-006**: `activateWithPermit(isaId, deadline, v, r, s)` MUST complete in ONE transaction: verify the backer's signed authorization → pull exactly `principal` from the backer → pay exactly `principal` to the seeker → mark Active (§6.2, D11, §6.4 #9). Escrow conservation is exact — the contract retains nothing. The submitter can be the relayer carrying the backer's signature; the signature is the authorization.
- **FR-007**: `cancelDraft(isaId)` MUST be callable by either party ONLY while Drafted → Cancelled (terminal). Any later-phase cancellation reverts.

**Stream (§6.1 modules/Stream)**

- **FR-008**: `receiveIncome(channelSig, isaId, purchaseRef, gross, salt)` MUST require ORCHESTRATOR_ROLE and verify the channel's signature over the event payload ONCHAIN against the registered pubkey; the payload MUST bind at least (channel, purchase reference, gross, salt) — the tuple of the replay registry; a forged or altered event reverts even with a valid orchestrator (D7, §6.4 #3). The deal must be Active and belong to the signing channel (§6.4 #4).
- **FR-009**: The replay registry MUST make every income fact single-use: the event hash of (channel, purchase reference, gross, salt) can settle exactly once, ever — a duplicate (including the same purchase reference with a different salt) reverts (§6.2, §6.4 #2).
- **FR-010**: Settlement MUST be atomic: the full gross enters and the exact split leaves in the same transaction — backer receives min(gross × share, remaining), seeker receives the rest — computed by the Feature-002 rule; diverted MUST NEVER exceed remaining; income in == backer + seeker out, exactly (§6.2, D5, §6.4 #1, #9).
- **FR-011**: Qualifying-event bookkeeping MUST follow §6.3 bars (≥ 60-day gap since the deal's last qualifying event AND gross ≥ 10% of principal): qualifying events increment the deal's counter and timestamp; non-qualifying events split normally and count toward nothing (§6.3, §6.4 #8).
- **FR-012**: When remaining reaches 0, the deal MUST complete at cap automatically in the same settlement transaction, applying the completion bookkeeping of FR-014 (§6.2 `receiveIncome`).

**Completion (§6.1 modules/Completion)**

- **FR-013**: `completeAtTerm(isaId)` MUST be callable by ANYONE once term end has passed, from Active only; the remaining cap is forgiven (never collectable later); the result is terminal; the call is idempotent (repeat calls do nothing) and is NEVER pausable (§6.2, D8, constitution VII).
- **FR-014**: Deal completion — at cap or at term — MUST atomically update the seeker's reputation record: total deals +1, completed +1, qualifying events += the deal's accrued qualifying count, distinct backers +1 if this is the first completed deal with that backer. These are the ONLY moments the reputation inputs change (§6.2 Profile, §6.4 #7 — score changes only on completion, matching the §6.3 demo: 58 during the deal, 91 at the finish line).

**Honesty + views (§6.2)**

- **FR-015**: `flagMismatch(day, expected, actual)` (ORCHESTRATOR_ROLE) MUST emit a mismatch record and change NO state — ever (D13).
- **FR-016**: The view surface (`offerOf`, `scoreOf`, `profileOf`, `isaOf`) MUST let anyone recompute score, maximum, and deal state from public data alone (constitution IV).

**Architecture + money rail**

- **FR-017**: KiteCore MUST be one UUPS-upgradeable implementation behind an ERC-1967 proxy, composed of the five namespaced modules (Governed, Identity, ISA, Stream, Completion) whose storage slots are isolated so one module can change without shifting another's state; initialization happens exactly once; a module-storage-collision test MUST accompany the upgrade-path test (§6.1, D10).
- **FR-018**: MockAUSD MUST be an ERC-20 with 6 decimals plus ERC-2612 `permit` and ERC-3009 `transferWithAuthorization`, mirroring the real settlement asset's interface so application code is identical on both (D11); it is a labeled testnet stand-in, replaced when the real asset's faucet is confirmed (PLAN Q1).
- **FR-019**: All money is integers in AUSD base units (6 decimals) end to end; no floating point anywhere (constitution VI).

**Quality gates (constitution IX)**

- **FR-020**: EVERY invariant in §6.4 (all twelve) MUST have an automated test that passes on the delivered code and is demonstrably capable of failing (the protected property, when violated, breaks the test) — the invariant suite runs as part of the standard test command.
- **FR-021**: The §6.3 demo numbers MUST pass end-to-end through the real path (draft → activate → three settlements with ≥ 60-day gaps), asserting every literal: 600 in / 600 out, cap 780, splits 300/1200, 300/1200, 180/1320, auto-completion at cap, reputation 58 → 91 (constitution IX).
- **FR-022**: Reentrancy on `activateWithPermit` and `receiveIncome` MUST be impossible — demonstrated by attack contracts in the suite (§6.4 #11).
- **FR-023**: Automated static analysis MUST be run over the contracts and EVERY finding triaged in writing at `contracts/SLITHER.md` — fixed, or justified with rationale; zero untriaged findings at done.
- **FR-024**: A gas snapshot MUST be committed, and the fixed transaction limits published to the shared contracts package (`packages/contracts`), clearly labeled as local-EVM baselines pending Monad recalibration at deployment (constitution Hard Constraints: gas is charged on the limit on Monad).

### Key Entities *(include if feature involves data)*

- **Terms** (§6.2): principal (AUSD base units), share (bps), cap multiplier (÷100), term end (timestamp), channel id. Immutable once the deal is drafted.
- **ISA** (§6.2): terms + seeker + backer + remaining (cap at activation, decreasing) + activatedAt + lastEventAt + qualifying-event count + status. Lifecycle: **Drafted → Active → {CompletedCapped | CompletedAtTerm} | Drafted → Cancelled** — Completed* and Cancelled are terminal, no resurrection (§6.4 #4).
- **Profile** (§6.2): totalISAs, completed, qualEvents, distinctBackers — updates ONLY at deal completion (FR-014); feeds the Feature-002 score.
- **Channel**: id → name, signing pubkey, active flag (§6.1 Identity).
- **Identity binding**: account ↔ identityHash, one-to-one both directions, immutable (D4).
- **Event-hash registry**: (channel, purchaseRef, gross, salt) → used; single-use forever (D7).
- **Roles**: ADMIN, RELAYER_ROLE, ORCHESTRATOR_ROLE, PAUSER (§6.1 Governed).
- **MockAUSD**: the 6-decimal money rail with permit + gasless-transfer authorizations (D11).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The §6.3 demo journey runs onchain end-to-end with 100% of its literal numbers matching (fund 600/cap 780; splits 300/1200, 300/1200, 180/1320; reputation 58 → 91), verifiable by one standard command run unaided.
- **SC-002**: All twelve §6.4 invariants hold under randomized legal-and-adversarial action sequences — 0 invariant violations across the suite.
- **SC-003**: 0 of the attempted unauthorized fund movements succeed across the full role matrix (relayer, orchestrator, pauser, and unauthorized upgrade paths) — roles confined exactly to the §6.2 function list.
- **SC-004**: While paused: 100% of draft/activate attempts blocked, 100% of settlement and forgiveness calls still succeed (asymmetric pause).
- **SC-005**: Static analysis completes with every finding dispositioned in `contracts/SLITHER.md` — 0 untriaged findings.
- **SC-006**: A gas snapshot is committed and fixed limits are published to the shared contracts package, labeled as pre-Monad baselines; the full test + invariant suite is green from a fresh clone in one command.

## Assumptions

- **Reputation updates only at completion** (derived from §6.4 #7 + the §8 "reputation jump at finish line" screen): during an Active deal, only the deal's own remaining / qualifying-counter / lastEventAt change; the Profile (and thus score) is untouched until completion applies FR-014 atomically. This makes "score changes only on completion" literally true.
- "Verified" seeker/backer (§6.2 "Who" column) = their account has a bound identity hash (D4). The relayer submitting `activateWithPermit` is authorized by the backer's signature itself (D11: relayer tx), not by msg.sender.
- The gross funding leg: the settlement contract pulls `gross` from the channel's (mill's) funded balance in the same transaction it splits; the channel's signing pubkey doubles as its funding account for the MVP (koperasi/mill device). The exact pull primitive (classic allowance vs. gasless authorization) is a plan-phase decision.
- Channel signatures are EVM-native recoverable signatures over a structured payload binding at least (channel, purchaseRef, gross, salt); exact payload encoding and signing scheme is a plan-phase decision verified by tests.
- `completeAtTerm` counts as completion for reputation purposes (CompletedAtTerm applies FR-014 too, with the deal's accrued qualifying count).
- Drafts are unrestricted in count; only ACTIVE blocks a new draft (one active deal per seeker, MVP).
- Upgrades are ADMIN-authorized with no timelock in the MVP (timelock = roadmap); initialization is a one-time event at proxy deployment.
- MockAUSD mints its initial supply to the deployer at construction; there is no later owner-mint (mirrors the immutable real asset); demo distribution happens in tooling, not contract code.
- Zero-gross income events are permitted, settle 0/0, and never qualify (failed-harvest mechanics, D8).
- Static analysis runs on the standard Python toolchain available in the build environment; if the primary tool cannot run, the attempted run and the fallback used are documented in the triage file.
- Full generated-ABI/typed-constant export to `packages/contracts` lands with its first consumer (the relayer feature, PLAN §12 Day 5–6); this feature publishes the gas limits only, per its Done-when.
- A deactivated channel's existing deals run to their term (income continues on already-active deals; new drafts naming the channel are blocked); plan may tighten after review.

## Out of scope (this feature)

- Deployment to Monad testnet and seeded demo state (PLAN §12 Day 4 — next feature).
- Backend, relayer service, indexer, CRE workflows, any UI.
- Swapping MockAUSD for the real asset (contingent on the Agora faucet, Q1/Q2).
- Buyout/stake modules, channel reputation, timelocked upgrades (§15 roadmap).
