# Research: Backend — API, Relayer, Purchase Registry & Reconciliation (Feature 005)

**Input**: spec.md FR-001..FR-021 · PLAN §5, §7.1–§7.4, §12 Day 5–6 · constitution I, IV, V, VI, VIII, IX
**Facts on disk**: Feature 004 published `@kite/contracts` (`abis/`, `addresses.ts` `KITE_DEPLOYMENT`, Monad-measured `gasLimits.ts`), the live proxy `0x3B6C…C0fD`, seeded personas (`contracts/script/DEMO-ACCOUNTS.md`), and the signing helpers `SignPermit.s.sol` / `SignIncome.s.sol` whose payload encodings this feature reproduces in TypeScript, byte-exactly.

---

## D1 — HTTP framework: Hono for both services

- **Decision**: `hono` for `apps/api` and `apps/relayer` (each a `Hono()` app). Dev entry: `bun run --hot src/index.ts`; both run on Bun 1.4.2 (repo pin) and are deployable to Vercel functions later without rewrite.
- **Rationale**: Zero-dep, ESM-first, first-class Bun support, middleware (auth/error) shared via `packages/core`; the smallest surface that satisfies "framework chosen in plan" without locking out PLAN §5's Vercel target.
- **Alternatives**: Express (CommonJS legacy, heavier), Fastify (Node-optimized plugin model), Elysia (Bun-only — breaks the Vercel path).

## D2 — Chain library: viem (read + write + typed payloads)

- **Decision**: `viem` ^2 everywhere chain is touched. One `publicClient` (read) in `apps/api`, one `walletClient` over `RELAYER_KEY` in `apps/relayer`, plus throwaway in-memory accounts in gates/scripts. ABIs imported from `@kite/contracts/abis` (never re-declared).
- **Rationale**: ESM + Bun-native, tree-shakeable, exact ABI typing against the published artifact; `parseEventLogs` gives the read-back and watcher primitives.
- **Alternatives**: ethers v6 (larger, class-heavy), web3.js (rejected outright).

## D3 — Drizzle + Neon HTTP driver; schema lives in `packages/core`

- **Decision**: `drizzle-orm` with the Neon serverless HTTP driver (`drizzle-orm/neon-http` + `@neondatabase/serverless`), `DATABASE_URL` from a free Neon project. The full schema (§7.3 tables verbatim + auxiliary tables of D8/D9/D15) is declared ONCE in `packages/core/src/db/schema.ts`; `apps/api` and `apps/relayer` import it (`@kite/core/db`). `drizzle-kit` config sits in `packages/core`; `bun run db:push` applies it.
- **Rationale**: PLAN §7.3 fixes "Neon Postgres, Drizzle". One schema module prevents drift between the two consumers; neon-http needs no TCP pool, matching serverless/Vercel and Bun equally. No new workspace package — `packages/core` already exists for shared types (PLAN §10), and adding a package would need constitution justification.
- **Alternatives**: schema duplicated per app (drift risk); a new `packages/db` (unjustified complexity beyond PLAN §10); `pg` over TCP (pool management, no serverless fit).

## D4 — Unit-test database: PGlite in-memory Postgres

- **Decision**: State-machine, ledger, idempotency, quote-TTL, recon-math, and banned-words unit tests run under `bun test` against an in-memory Postgres (`@electric-sql/pglite` + `drizzle-orm/pglite`) with the exact same Drizzle schema. No Docker, no network, no DB fixtures to clean.
- **Rationale**: The money rules (§7.2) are the feature's core risk; they need fast, exhaustive tests against real SQL semantics (UNIQUE constraints are the idempotency lock — they must actually fire). PGlite is real Postgres in WASM; Drizzle supports it directly.
- **Alternatives**: tests against a Neon branch (network-flaky, slower, shared-state hazards); mocked repository layer (would NOT test the UNIQUE constraints — rejected).

## D5 — Relayer shape: one process, HTTP enqueue + in-process worker

- **Decision**: `apps/relayer/src/index.ts` starts the Hono server (`POST /jobs`, `GET /jobs/:id` — INTERNAL_API_KEY) AND the worker loop in the same process. The loop claims one `pending` job at a time via `SELECT … FOR UPDATE SKIP LOCKED`, executes it to completion (submit → receipt → read-back → `confirmed`), then continues. `client_ref` (nullable UNIQUE) makes duplicate submissions return the existing job.
- **Rationale**: One key ⇒ one in-flight transaction ⇒ serialization is structural (FR-013), not a lock ballet. SKIP LOCKED keeps the invariant true even if a second worker is started accidentally or on Vercel later. Smallest honest queue: the §7.3 `relayer_jobs` table IS the queue — no Redis, no BullMQ.
- **Alternatives**: separate worker process (two things to run per gate — friction); Redis/BullMQ (new infra, unjustified); fire-and-forget HTTP handlers (violates serialization).

## D6 — Nonce discipline: local nonce + pending-count resync, one in flight

- **Decision**: The worker records each sent tx's nonce in `relayer_jobs.nonce`. Before each send it verifies its expected nonce against `eth_getTransactionCount(relayer, "pending")` and adopts the chain's number when they drift (restart, stuck tx, manual `cast send` from the same key during the manual loop). Only after a job reaches `confirmed` (or terminally fails) does the next job start — a gap or a replacement race is impossible by construction.
- **Rationale**: FR-013/§7.2 rule 7 verbatim. The same relayer address is also used by hand in `MANUAL-LOOP.md`, so drift WILL happen in practice — resync-before-send is not optional.
- **Alternatives**: trusting a local counter blindly (the manual loop breaks it); queuing multiple txs with consecutive nonces (violates one-at-a-time and breaks read-back ordering).

## D7 — A receipt is not success: per-kind onchain read-backs

- **Decision**: After the receipt, the worker reads back the exact state the tx was meant to change; only then `confirmed`:
  - `activateWithPermit` → `isaOf(isaId).status == 2 (Active)`.
  - `transferWithAuthorization` → the receipt's logs parse to the AUSD `Transfer(from, to, value)` event (MockAUSD exposes no `authorizationState()` view, so the event is the exact proof; a reverted call never emits it).
  - `bindIdentity` → `identityOf(wallet) == identityHash`.
  - `drip` → `getBalance(wallet)` after > before (plus the D8 one-time row).
- **Rationale**: FR-014. A mined-but-reverted tx (Monad charges the full limit on a revert) must retry, not confirm; the read-back is the only honest signal.
- **Alternatives**: trusting `status: 1` receipts (reverts also return status 1 semantics at the RPC layer unless revert data is checked); double-fetching balances for everything (weaker proof for 3009).

## D8 — Purchase mill signature captured at creation; Demo-Tool submitter

- **Decision**: `POST /api/channel/purchases` requires the mill's EIP-712 signature over `IncomeEvent(uint64 channelId,uint256 isaId,bytes32 purchaseRef,uint256 gross,bytes32 salt)` (domain `KiteCore`/`1`/10143/proxy — exactly `SignIncome.s.sol`'s encoding); `purchases.mill_sig` stores `{salt, v, r, s}`. The settlement submitter in this feature is `apps/api/src/jobs/submit-settlement.ts` — labeled **Demo Tool** — which loads the stored signature and submits `receiveIncome` with `ORCHESTRATOR_KEY` at the published gas limit. CRE WF-1 replaces the submitter later; the registry doesn't change.
- **Rationale**: §7.1 "mill signature captured at creation" is the anti-collusion record: the mill attests the purchase BEFORE settlement exists, so a forged registry entry cannot split (constitution V). Reusing the orchestrator key (already funded, already ORCHESTRATOR_ROLE from Feature 004) keeps the gate one command. Signing server-side happens ONLY in the Demo Tool (which signs what the registry stored — not what an operator types at settle time).
- **Alternatives**: sign at settle time with a live prompt (weakens the captured-at-creation record); adding a `receiveIncome` relayer job kind (spec FR-015 fixes the kind list at four; orchestration is WF-1's job).

## D9 — Settlement observation: log watcher + webhook idempotency + chain cache

- **Decision**: `apps/api/src/jobs/watch-settlements.ts` polls `eth_getLogs(proxy, topic0 = IncomeSettled)` from a checkpoint in `job_state` (`settlements_block`), stepping by bounded ranges. Each log is claimed via `webhook_events.provider_event_id = "10143:<block>:<logIndex>"` (UNIQUE — the replay lock). A matching PAID purchase (channel + purchaseRef) transitions to SETTLED with `tx_hash` + `settled_at` (block timestamp), writes the D15 ledger rows, and refreshes the `isas` cache from `isaOf()`. Unmatched events (e.g., the seed story, which predates the backend) are counted and skipped — they belong to recon via the baseline (D15).
- **Rationale**: FR-009/FR-010 — the chain is the only authority (constitution IV); the DB is corrected FROM events, never the reverse. `IncomeSettled(isaId, channelId, purchaseRef, gross, toBacker, toSeeker, remaining, qualifying)` carries everything needed: the purchase link (indexed `purchaseRef`), the ledger amounts, and the cache refresh.
- **Alternatives**: lazy on-read reconciliation (a purchase can only settle once observed — polling without a GET keeps the state machine honest even when nobody is looking); parsing `cast receipt` output (bash-shaped, fragile).

## D10 — RPC + gas: published addresses/limits from `@kite/contracts`; Alchemy optional

- **Decision**: Contract addresses come from `KITE_DEPLOYMENT` (no env duplication). RPC: `ALCHEMY_RPC_URL` if set (bounty touchpoint — relayer + watcher + recon), else `RPC_URL`, else the published `rpcUrl`. Every relayer tx carries `gas: BigInt(fixedLimit)` from `KITE_GAS_LIMITS` / `MOCK_AUSD_GAS_LIMITS`. Batch JSON-RPC is OFF by default (the Foundation RPC rejects batches — recorded in `contracts/script/env.example`).
- **Rationale**: Constitution Hard Constraint (gas charged on the limit; fixed limits published). The 004 recalibration already bakes cold-state headroom into every `fixedLimit` — the relayer must not re-estimate (warm estimates under-publish; the manual-loop OOG lesson).
- **Alternatives**: `eth_estimateGas` per tx (the exact failure mode 004 documented); env-duplicated addresses (drift).

## D11 — Auth: static API keys, constant-time; `/api/me` demo identity header

- **Decision**: Two static keys in env: `MITA_API_KEY` (purchase registry read/write) and `INTERNAL_API_KEY` (job enqueue, transition calls). Checked in Hono middleware via `crypto.timingSafeEqual`; missing/incorrect → 401 with no key echo. `/api/me` identifies the caller by the `x-kite-wallet` header (validated 0x-address) for the demo — Mera session auth swaps in behind the same route (spec Assumption).
- **Rationale**: Demo-scale auth with the right SHAPE for later; the response is public-chain data + own records, so the header is identification, not authorization of funds.
- **Alternatives**: JWT (no user store yet — theater); per-user keys (arrive with Mera feature).

## D12 — `/api/p/:id` resolves identityHash or wallet

- **Decision**: `:id` accepts a `0x`-bytes32 identity hash (`walletOfIdentity`) or a wallet address; both resolve to the same public profile. Human slugs (`/p/budi`) arrive with the web feature (a slug map is presentation, not data).
- **Rationale**: The contract's two-way binding (D4 of Feature 003) makes both keys first-class; supporting both now costs one branch and avoids inventing a third identifier the chain doesn't know.
- **Alternatives**: only identityHash (deep-links from the app carry the wallet more often); a DB slug table now (pre-UI guesswork).

## D13 — FX representation: integer rate + per-pair scale; TTL row in `fx_quotes`

- **Decision**: `packages/core/src/fx.ts` defines the demo pairs: `USD_IDR {rate 16_000, scale 0}` and `USD_MYR {rate 4_150, scale 3}` (4.150 MYR — demo constant, labeled). `fx_quotes` stores one row per pair with `expires_at = now + 60s`; reads inside the TTL return the same row (the lock), expired rows are replaced. `/api/quote` returns `{pair, rate, scale, expiresAt, source: "demo-fixed"}`. No float exists anywhere in the path (constitution VI): display conversion = `amountAusd × rate / 10^scale`, computed in the UI, never stored.
- **Rationale**: §7.4 + spec FR-002. The TTL structure is what the app's "≈" quotes lock onto; the fixed source is labeled (constitution VIII).
- **Alternatives**: float rates (forbidden); a real FX API now (out of scope, PLAN §7.4).

## D14 — Money on the wire: integral JSON numbers, integer-validated on write

- **Decision**: AUSD amounts serialize as JSON numbers, always integral base units (max realistic value ≈ 10^9 ≪ 2^53). Every write path validates `Number.isInteger(v) && v >= 0` and rejects otherwise; bigint literals never appear in API payloads.
- **Rationale**: Constitution VI with a wire format that stays human-checkable with `curl` (the gates read these numbers aloud).
- **Alternatives**: strings everywhere (curl-hostile, and JS BigInt JSON support in Bun is still footgun-shaped); floats (forbidden).

## D15 — Aux tables: ledger, transitions, drips, job_state, settled_at; recon baseline

- **Decision**: Around the §7.3 core (which stays verbatim): `purchase_transitions` (append-only log), `ledger_entries` (double-entry: per settled purchase one `in` row `channel:<id>` gross + `out` rows `backer:<addr>` toBacker, `seeker:<addr>` toSeeker; per-purchase sum(in) == sum(out) asserted), `drips` (UNIQUE wallet — the one-time lock), `job_state` (watcher checkpoint + counters + `recon_baseline_ts`). `purchases` gains `settled_at`/`failed_reason`; `relayer_jobs` gains `last_error`/`terminal_at` (status stays pending→sent→confirmed — a job is "failed" iff `terminal_at` is set, visible without a fourth state).
  **Recon baseline**: the chain already carries Feature-004's seed settlements, which no backend purchase backs. `db:setup` records `recon_baseline_ts = now`; recon compares only IncomeSettled events with block timestamp ≥ baseline. Anything settled after baseline without a backend record is a genuine mismatch (correct, honest).
- **Rationale**: §7.2 rules 2/3/5 mandated behaviors that §7.3's sketch doesn't draw; spec Assumptions pre-authorized additions around the verbatim core. Without the baseline, recon would flag the seed story forever — noise that hides real drift.
- **Alternatives**: back-filling fake purchases for the seed (lying in the ledger — rejected); day-PK-only windows with no baseline (SC-003 unfalsifiable-by-demo).

## D16 — Recon semantics: UTC day, integer sums, exit codes 0/1/2

- **Decision**: `recon.ts [--day YYYY-MM-DD]` (default: yesterday UTC — completed days only). Backend side: `SUM(gross)` over purchases `SETTLED` with `settled_at` in the day. Chain side: `eth_getLogs` IncomeSettled in the day's blocks (timestamp ≥ baseline, block timestamps via batched `getBlock`) summed on `gross`. Write/refresh `recon_daily` (day PK). Equal → `ok`, exit 0; divergent → `mismatch`, both totals written, exit 1; either side unfetchable → exit 2, NO row. The job never writes to purchases/ledger/chain (never silently repair — D13 of PLAN).
- **Rationale**: FR-019..FR-021 + the Done-when. Exit 2 ≠ exit 1 keeps "infra broken" distinguishable from "books disagree" in cron alerts.
- **Alternatives**: comparing counts instead of sums (a wrong-amount settlement would pass); running on the partial current day (numbers move under the job).

## D17 — Testing tiers: unit (PGlite) vs live gates (testnet)

- **Decision**: Unit (`bun test`): purchase state machine + transitions log, idempotency under duplicate POST and replayed webhook event-ids, ledger balance, quote TTL, recon math (ok/mismatch/incomplete), banned-words scan of every human-readable field the public endpoints emit, job read-back logic against mocked receipts. Live gates (the quickstart): SC-001 gasless send, SC-002 purchase → SETTLED, SC-003 recon ok + forced mismatch — each one `bun run` script, each printing PASS/FAIL and exiting 0/1.
- **Rationale**: Constitution IX — gates the user can run unaided; unit tests make the money rules exhaustively checkable without burning testnet txs.
- **Alternatives**: only live gates (slow, non-deterministic edges); only unit tests (would not prove the zero-MON property).

## D18 — Banned-words enforcement is a test, not a promise

- **Decision**: A unit test walks every response shape of `/api/me`, `/api/p/:id`, `/api/quote` (rendered against seeded fixtures) and fails on any occurrence of the constitution-I banned words in any human-readable string value (labels, sources, statuses destined for screens). Field NAMES are data, not copy — the web feature owns visible strings, but the API must not hand it banned ones.
- **Rationale**: Constitution I is testable at this layer cheaply; the alternative is discovering a "pending" status string in the UI feature with two days left.
- **Alternatives**: a lint rule (wrong layer — it would flag source code, not emitted payloads).
