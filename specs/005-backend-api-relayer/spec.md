# Feature Specification: Backend — API, Relayer, Purchase Registry & Reconciliation

**Feature Branch**: `005-backend-api-relayer`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Feature 005 — Backend: api + relayer + purchase registry + recon. Source of truth: PLAN §7.1–7.4, §5, §12 day 5–6. apps/api (route handlers): /api/health · /api/quote (fixed 16000, 60s TTL structure) · /api/me (chain read + DB merge, one response per screen) · /api/p/:id · /api/channel/purchases (POST intent; GET :id for WF-1 validation, API-key auth). apps/relayer (HTTP service, framework chosen in plan): serialized jobs via relayer_jobs (one tx at a time per key, local nonce, retry with backoff, READ BACK state after receipt — a receipt is not success); jobs: activateWithPermit, ERC-3009 transferWithAuthorization (gasless send), bindIdentity, one-time MON drip per identity. Neon Postgres + Drizzle, schema exactly per §7.3; money = integers only; purchases state machine PENDING→PAID→SETTLED, transitions logged never deleted; purchase_ref UNIQUE + webhook idempotency; append-only ledger. Daily recon (cron): backend settled totals vs chain IncomeSettled sums (direct Alchemy RPC now; Envio swap-in lands in Feature 008) → write recon_daily → EXIT NON-ZERO on mismatch. Never silently repair. Done when: a gasless ERC-3009 send moves AUSD between two wallets with zero MON on the sender; a purchase intent reaches SETTLED after the onchain split; forcing a ledger mismatch makes the cron job exit non-zero and write a mismatch row."

**Implements**: PLAN §7.1 (services), §7.2 (money-handling rules 1–7), §7.3 (data model), §7.4 (FX display-only), §5 (architecture), §12 Day 5–6. Design decisions D3 (invisible fees + drip), D11 (all transfers gasless ERC-3009/permit), D12 (transport moves facts, contract decides), D13 (daily reconciliation, never silently repair). Constitution I (invisible fees, banned words), IV (the contract is the only authority), V (facts vs decisions), VI (integer money), VIII (demo components labeled), IX (gates before progress). Builds on Feature 003 (KiteCore + MockAUSD, merged) and Feature 004 (Monad testnet deployment + seeded demo state).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A purchase becomes money, then a record (Priority: P1)

The harvest-day pipeline, offchain half. An authorized Mitra-side caller registers a purchase intent against a channel and a live deal: reference, gross in whole AUSD base units, and the mill's signature — captured at creation, not later. The row is PENDING. The mill's payment is recorded → PAID. The signed fact then settles onchain (`receiveIncome` — submitted in this feature by any orchestrator-key holder; the CRE workflow becomes the transport in a later feature, and the contract does not care who carries the fact); the backend observes the confirmed settlement event, reads the deal's state back from the contract, records the transaction hash, writes balanced double-entry ledger rows, and only then → SETTLED. Replay-proof everywhere: the same reference twice yields one purchase; a replayed webhook does nothing; every transition is appended to a log that is never edited or deleted.

**Why this priority**: This is the money pathway the whole product rides on. Constitution III/V: the split happens in the contract; everything here is transport plus an honest record. The Mitra console (later feature) and WF-1 (later feature) are just front doors onto this registry — they are only as good as the state machine underneath.

**Independent Test**: One scripted run against the testnet deployment: create intent → record payment → submit the channel-signed split with the seeded mill key → poll the purchase to SETTLED with tx hash → assert the ledger balances (purchase-in == split-out, recomputable from entries alone) → then replay the intent, the webhook, and the settlement event and assert zero additional effects.

**Acceptance Scenarios**:

1. **Given** a registered channel and an Active seeded deal, **When** an authorized caller POSTs a purchase intent {channel, deal, purchase_ref, gross, mill signature}, **Then** exactly one PENDING purchase exists with the signature stored, and POSTing the identical intent again returns the same purchase — no second row, ever.
2. **Given** a PENDING purchase, **When** the payment is recorded by an authorized caller, **Then** the purchase is PAID with the transition logged; any attempt to skip states (PENDING → SETTLED) or move backwards is rejected and the attempt is logged.
3. **Given** a PAID purchase whose channel-signed fact has settled onchain, **When** the backend processes the confirmed settlement, **Then** the purchase becomes SETTLED carrying the settlement tx hash, the ledger gains balanced entries for gross-in and split-out, and the backend's copy of the deal (remaining, status) equals the contract's — read back, not assumed.
4. **Given** a purchase whose settlement cannot happen onchain (e.g., the deal reached a terminal state first), **When** processing completes, **Then** the purchase ends FAILED with the reason logged — and nothing settles twice on any path.

---

### User Story 2 - Money moves with zero MON on the sender (Priority: P2)

The gasless legs. A backer funds a deal and any user sends AUSD to another account using only a signature: the relayer receives the signed authorization as a job, submits the transaction, pays its fee, and — before calling the job confirmed — reads the onchain state back to verify the intended change actually happened, because a receipt is not success. Jobs run strictly one at a time per signing key with locally tracked nonces; failures retry with backoff but never resend blindly (previous status checked first, nonce resynced from the chain after any restart or gap). When an identity is verified, the relayer drips a little MON to the account exactly once — invisibly, so fees are never the user's problem (constitution I). The relayer key lives in secret storage, never in the repository, and its power is bounded onchain by minimum roles and offchain by daily amount caps.

**Why this priority**: The zero-MON property is the Agora bounty leg and PLAN D11/D3 — "sender never needs MON" — and this is the most operationally dangerous code in the backend (a real key moving real money), so its serialization, nonce, and read-back discipline are hard gates, not nice-to-haves.

**Independent Test**: With two funded testnet wallets, drain the sender's MON to exactly 0, sign a gasless-transfer authorization, submit the job, and assert: the AUSD arrived, the sender's MON balance is still 0, the job reached confirmed only after the read-back — then kill and restart the worker mid-job and assert no double send ever occurs.

**Acceptance Scenarios**:

1. **Given** a wallet holding AUSD and exactly 0 MON, **When** its signed gasless-transfer authorization is submitted and processed, **Then** the recipient receives the AUSD, the sender's MON balance remains 0, and the fee was paid by the relayer's key.
2. **Given** a drafted deal and the backer's signed funding authorization, **When** the relayer processes the activation job, **Then** one transaction pulls the principal from the backer, pays the seeker, and the deal is Active — the signature is the authority (§6.2, D11).
3. **Given** two jobs queued for the same signing key, **When** the worker runs, **Then** they execute strictly serially with monotonically increasing nonces — no overlap, no gap, no replacement race.
4. **Given** a transaction that was mined but did not produce its intended state change (reverted inside), **When** the worker reads back, **Then** the job is NOT confirmed — it retries with backoff or fails loudly; a receipt alone never marks success.
5. **Given** a newly verified identity, **When** the drip job runs twice (including concurrently), **Then** MON is transferred exactly once.
6. **Given** the same authorization submitted twice (double-click or replay), **Then** exactly one transfer happens — the job is idempotent by client reference.

---

### User Story 3 - One response per screen (Priority: P3)

The read surface. The app (next feature) opens Home and makes ONE call: `/api/me` merges the contract's authoritative state — active deal, remaining cap, progress, reputation, offer — with the backend's records (profile, purchase history), with every chain-authoritative value read from the contract, because the indexer is a projection and projections never decide (constitution IV). A visitor opens the public record `/api/p/:id`: reputation, completed count, per-deal settlement history with explorer links — and no name, no phone, no documents. `/api/quote` returns the display rate, fixed at 16,000 for the demo and clearly labeled as the demo source, with a 60-second lock structure so a quoted amount stays quoted. `/api/health` tells the truth about the database and the chain RPC — it never fakes an ok. Every monetary field is an integer; every human-readable string in these payloads honors the banned-words list (constitution I).

**Why this priority**: The screens are the next feature's dependency; this story makes each screen possible with a single round-trip and carries the contract-is-authority discipline into the backend before any UI exists to violate it.

**Independent Test**: Against the seeded accounts: GET `/api/me` for the mid-season wallet and assert progress, remaining, and reputation equal direct contract reads for the same address; GET `/api/p/:id` and assert history with links and zero personal fields; GET `/api/quote` twice inside the TTL and assert the same lock; break the RPC URL and assert `/api/health` reports it.

**Acceptance Scenarios**:

1. **Given** the seeded mid-season account (progress 38.5%), **When** GET `/api/me` for that wallet, **Then** deal progress, remaining, and reputation in the response match direct contract reads exactly, and every monetary field is an integer in base units.
2. **Given** an account with completed deals, **When** GET `/api/p/:id`, **Then** the response contains reputation, completed count, and per-deal settlement history with explorer links, and structurally contains NO personal data fields.
3. **When** GET `/api/quote`, **Then** the rate is 16,000 (IDR per AUSD, demo-labeled) with an expiry ≤ 60 s ahead; a second call within the TTL returns the same locked quote.
4. **When** GET `/api/health` with the database reachable and the chain RPC unreachable, **Then** the response reports the RPC as down — a dependency failure is visible, never masked.

---

### User Story 4 - Books that can fail loudly (Priority: P4)

The honesty backstop. Once a day, a job sums the backend's settled purchases (the ledger) and sums the chain's settlement events over the same window — read directly from the chain RPC in this feature — and writes one `recon_daily` row: day, backend total, chain total, status. If the totals agree: status ok, exit code 0. If they diverge: status mismatch, the process exits non-zero, and nothing is repaired silently (D13). If either side cannot be fetched, the job exits non-zero without writing a verdict at all — a comparison is never made from half the data.

**Why this priority**: It hardens the other three stories and is a stated trust property (D13), but it is meaningless until money flows, so it rides last.

**Independent Test**: Run the job on a clean settled day → row {ok, totals equal}, exit 0. Inject a divergence (e.g., an extra settled purchase the chain never saw) → rerun → row status=mismatch with both totals recorded, exit non-zero, zero data modified. Point the job at a dead RPC → non-zero exit, no verdict row written.

**Acceptance Scenarios**:

1. **Given** a day where ledger and chain agree, **When** the recon job runs, **Then** one `recon_daily` row {status ok, backend_total == chain_total} is written and the process exits 0.
2. **Given** a forced divergence, **When** the recon job runs, **Then** the row is written with status mismatch and both totals, the process exits non-zero, and no purchase, ledger, or chain state was touched to force agreement.
3. **Given** the chain side unreachable, **When** the recon job runs, **Then** it exits non-zero with the fetch error surfaced and writes NO verdict row for that run.
4. **Given** the same day re-run, **When** the job completes, **Then** the day's row reflects the latest completed run (one row per day).

### Edge Cases

- Duplicate `purchase_ref` within the same channel → idempotent return of the existing purchase; a different payload reusing a live ref → rejected.
- Replayed webhook (same `provider_event_id`) → recorded once, processed once, second delivery is a no-op.
- Transition calls that skip states or run backwards → rejected, attempt logged.
- Relayer restart mid-job → resumes from recorded nonce/tx state; never enqueues a duplicate send for the same client reference.
- Transaction mined but reverted → read-back catches it; retry with backoff up to the cap; beyond the cap the job surfaces as failed with its reason — never silently confirmed.
- Local nonce drifts from the chain (reorg, stuck tx) → resync from the chain before the next send; one tx in flight per key at all times.
- Drip requested twice concurrently → exactly one MON transfer (one-time per identity enforced atomically).
- Authorization expired, malformed, or balance insufficient → job fails with a precise reason; no partial effects anywhere.
- Settlement event observed for an already-SETTLED purchase → no double processing (settlement observation is idempotent).
- Recon window containing zero settlements → ok with both totals 0.
- `/api/me` for a wallet with no history → valid empty state (score 0, maxP 600, no active deal) — not an error.
- `/api/p/:id` for an unknown id → not-found response that leaks nothing.

## Requirements *(mandatory)*

### Functional Requirements

**API surface (§7.1)**

- **FR-001**: `/api/health` MUST report service status and the reachability of each dependency (database, chain RPC) — a failing dependency MUST be visible in the response; a false ok is a defect.
- **FR-002**: `/api/quote` MUST return the display conversion (demo: fixed 16,000 IDR per AUSD, labeled as the demo source; MYR display pair supported) with a lock expiry ≤ 60 s ahead (§7.4, constitution VI/VIII). Quotes are display-only — no stored or moved amount may be derived from them.
- **FR-003**: `/api/me` MUST return one merged response per screen — profile, balance context, active deal (terms + progress derived from remaining), reputation and current offer, purchase history — where every chain-authoritative value (deal state, remaining, reputation, limits) is read from the contract in this feature (constitution IV: projections may lag, never decide).
- **FR-004**: `/api/p/:id` MUST expose the public record — reputation, completed count, per-deal settlement history with explorer links — and MUST NOT expose personal data (name, phone, documents); human-readable strings in the payload MUST honor the banned-words list (constitution I).
- **FR-005**: POST `/api/channel/purchases` (API-key authenticated) MUST create a PENDING purchase capturing channel, deal, `purchase_ref`, gross in integer AUSD base units, and the mill's signature at creation (§7.1 channels); `purchase_ref` MUST be unique per channel; duplicate submission of an identical intent MUST be idempotent.
- **FR-006**: GET `/api/channel/purchases/:id` (API-key authenticated) MUST return the purchase's full state — status, recorded signature, settlement tx hash — for downstream ingest validation (WF-1, later feature).
- **FR-007**: An authenticated transition call MUST move PENDING → PAID (payment recorded); every state transition MUST be appended to an immutable, never-deleted log; backward or skipping transitions MUST be rejected.

**Money-handling rules (§7.2, constitution Hard Constraints)**

- **FR-008**: The purchase lifecycle MUST be exactly PENDING → PAID → SETTLED (+ FAILED) (§7.2 rule 2); purchases and their transitions are never deleted or edited.
- **FR-009**: A purchase MUST become SETTLED only after its onchain settlement is confirmed AND read back from the contract (settlement event observed; deal state reconciled) — a transaction receipt hash alone MUST NOT settle a purchase (§7.2 rule 6).
- **FR-010**: Every inbound webhook/event MUST record its `provider_event_id` under a UNIQUE constraint; a replayed event MUST be a no-op and MUST NEVER produce a second split, transfer, or state change (§7.2 rule 1).
- **FR-011**: The ledger MUST be append-only, simple double-entry: every settled purchase's gross-in entry balances its AUSD split-out entries; entries are immutable and totals are recomputable from entries alone (§7.2 rule 3).
- **FR-012**: All monetary values in the database and API MUST be integers in AUSD base units (6 dp) — floats are forbidden anywhere money is stored, moved, or computed (constitution VI); the schema MUST cover the §7.3 tables exactly as printed.

**Relayer (§7.1 relayer, §7.2 rules 5–7)**

- **FR-013**: The relayer MUST execute jobs strictly serialized per signing key — one transaction in flight at a time — with locally tracked nonces, resyncing from the chain after any restart or gap; it MUST never resend without first checking the previous job's status (§7.2 rules 6–7).
- **FR-014**: Failures MUST retry with backoff up to a cap; a receipt MUST be treated as success only after reading back the onchain state the transaction was meant to change — a receipt is not success (§7.2 rule 6).
- **FR-015**: The relayer MUST support exactly these job kinds, each mapping 1:1 to its PLAN §6.2/§7.1 function: `activateWithPermit` (deal funding), `transferWithAuthorization` (gasless AUSD send), `bindIdentity`, and the MON drip — HTTP wire values are the snake_case identifiers `activate_with_permit`, `transfer_with_authorization`, `bind_identity`, `drip` (the camelCase above names the contract functions); jobs arrive via an authenticated HTTP interface.
- **FR-016**: The gasless property MUST hold end to end: a sender holding zero MON completes an AUSD transfer and a backer completes funding using only their signature — all fees paid by the relayer's key (D11, D3, constitution I).
- **FR-017**: The MON drip MUST fire exactly once per verified identity (concurrent or repeated requests collapse to one transfer), in a fixed small amount, under daily caps on total relayer outflow (§7.2 rule 5).
- **FR-018**: The relayer MUST send transactions with the fixed gas limits published by the shared contracts package (gas is charged on the limit on Monad) and MUST hold its signing key in environment/secret storage — never in the repository — with onchain roles minimum-privilege (§7.2 rule 5, constitution Hard Constraints).

**Reconciliation (§7.1 recon, §7.2 rule 4, D13)**

- **FR-019**: A daily job MUST compare the backend's settled totals (sum over SETTLED purchases / ledger entries) with the chain's settlement-event totals over the same window, read directly from the chain RPC endpoint (Alchemy) — the Envio indexer is NOT a dependency of recon correctness in this feature.
- **FR-020**: Each completed run MUST write exactly one `recon_daily` row (day as primary key): backend_total, chain_total, status ∈ {ok, mismatch} (§7.3).
- **FR-021**: On divergence: status mismatch AND the process MUST exit non-zero; on agreement: status ok and exit 0. The job MUST NEVER modify purchase, ledger, or chain state to force agreement (never silently repair, D13). If either side cannot be fetched, it MUST exit non-zero without writing a verdict row.

### Key Entities *(include if feature involves data)*

All §7.3 tables, exactly as printed (integer money throughout):

- **users**: id, wallet (UNIQUE), phone, kyc_status, identity_hash, locale, created_at.
- **isas** (chain cache): isa_id PK, seeker, backer, principal, share_bps, cap_mult, remaining, status, term_end — a projection of the contract; on disagreement the contract wins and the cache is corrected (constitution IV).
- **purchases**: id PK, channel_id, isa_id, purchase_ref (UNIQUE), gross_ausd, status, mill_sig, tx_hash, created_at — lifecycle PENDING → PAID → SETTLED (+ FAILED).
- **channels**: id PK, name, pubkey, active.
- **fx_quotes**: id, pair, rate, expires_at — display-only locked quotes (§7.4).
- **relayer_jobs**: id, kind, payload_json, status [pending → sent → confirmed], tx_hash, nonce, attempts.
- **webhook_events**: provider_event_id (UNIQUE), processed_at — the idempotency lock for every inbound event.
- **recon_daily**: day PK, backend_total, chain_total, status [ok | mismatch].
- **Auxiliary records** (see Assumptions): an append-only purchase state-transition log, the double-entry ledger entries, and one-time drip records — implementing §7.2 rules not drawn in the §7.3 sketch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A gasless AUSD send between two wallets completes with the sender's MON balance exactly 0 before and after — verifiable by one user-run command.
- **SC-002**: A purchase intent reaches SETTLED after the onchain split with the settlement tx hash recorded and ledger entries balanced (gross-in == split-out, recomputable from entries); duplicate intent + replayed webhook + replayed settlement event produce zero additional effects — 100% idempotent under replay.
- **SC-003**: A forced ledger/chain divergence makes the recon job exit non-zero with a mismatch row written; a clean day exits 0 with ok — and zero data repairs in either case.
- **SC-004**: Every gate above is demonstrable by commands the user can run unaided from a fresh checkout (constitution IX).

## Assumptions

- The HTTP framework for `apps/api` and `apps/relayer`, and the process layout (Vercel functions vs. always-on service for the job queue), are plan-phase decisions — the spec fixes behavior, not runtime (per the feature description: "framework chosen in plan"). PLAN §5/§11.2 note Vercel hosting for app + relayer + cron triggers.
- Persistence is Neon Postgres with Drizzle per PLAN §7.3 — fixed by the PLAN, restated in plan.md; this spec adds no schema beyond §7.3 plus the auxiliary records named below.
- Auxiliary tables implement §7.2-mandated behavior not sketched in §7.3: purchase state-transition log (rule 2), double-entry ledger entries (rule 3), one-time drip records (rule 5). They are additions around the §7.3 core, which stays exactly as printed.
- `/api/me` caller identity for the demo: the wallet address identifies the caller (plan decision: the `x-kite-wallet` header). Mera passkey session auth arrives with the app feature (PLAN §12 Day 7); swapping the identity check later must not change the response shape.
- API keys are static demo keys held in environment/secret storage for the Mitra-side caller and the future WF-1 caller — labeled demo components (constitution VIII).
- The settlement transaction (`receiveIncome`) in this feature is submitted by any orchestrator-key holder (seeded script or `cast`); CRE WF-1 (later feature) becomes the transport. The backend marks SETTLED from confirmed chain state regardless of the submitter (PLAN Q3 fallback: the contract doesn't care who transports).
- FAILED is terminal for a purchase record; a corrected retry is a new purchase_ref (plan may refine with a retry window).
- `relayer_jobs` status per §7.3 is pending → sent → confirmed; the representation of a permanently failed job (beyond the attempts counter) is a plan decision surfaced visibly either way.
- FX rates are stored as integers with an explicit scale (e.g., basis points) — never floats (constitution VI); the demo fixes IDR at 16,000, MYR at a plan-chosen demo constant, both labeled demo source.
- Deployed testnet contracts, seeded accounts/channel, and the published `@kite/contracts` gas limits from Features 003–004 are available in environment configuration; Feature 004's deployment artifacts are the source for addresses.
- Recon reads chain settlement events directly via Alchemy RPC (log queries over the settlement event); the Envio swap-in is Feature 008 and must not change recon's verdict semantics.
- The Envio indexer, backend caches, and every derived view are projections (constitution IV): on mismatch with the contract, the contract is truth and the projection is corrected — never the reverse.

## Out of scope (this feature)

- CRE workflows WF-1/2/3 (apps/orchestration, later feature) — including the onchain `flagMismatch` call on recon mismatch (WF-3's job; this feature's recon stops at the mismatch row + non-zero exit, per its Done-when).
- Envio indexer and GraphQL reads (Feature 008 — the swap-in point for recon's chain-side source).
- Mera passkey signup, signing sessions, and all UI screens (PLAN §12 Day 7–9 features); the Mitra console UI.
- Production hosting and scheduling wiring (Vercel deployment, hosted cron) — gates run from the repository against the real testnet and real database; hosting may be pulled into plan if trivial.
- Swapping MockAUSD for the real asset (contingent on the Agora faucet, PLAN Q1/Q2), production FX source, and any KYC beyond demo auto-approve.
