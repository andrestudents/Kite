# Implementation Plan: Backend — API, Relayer, Purchase Registry & Reconciliation

**Branch**: `005-backend-api-relayer` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-backend-api-relayer/spec.md`

## Summary

Deliver the PLAN §7 backend on the live Feature-004 testnet deployment: `apps/api`
(Hono per-screen read surface — `/api/health`, `/api/quote`, `/api/me`, `/api/p/:id` —
plus the §7.2 purchase registry with the `PENDING → PAID → SETTLED (+FAILED)` state
machine, webhook idempotency, and an append-only double-entry ledger), `apps/relayer`
(the four-job gasless queue: `activateWithPermit`, `transferWithAuthorization`,
`bindIdentity`, one-time MON drip — serialized per key, nonce-resynced, receipt-then-
read-back), and the daily reconciliation job that writes `recon_daily` and **exits
non-zero on mismatch, never silently repairing** (D16). Storage is Neon Postgres +
Drizzle with the §7.3 schema verbatim (research D3/D15); money is integers in AUSD
base units everywhere (constitution VI); the Envio indexer is NOT a dependency (chain
reads are direct; Envio swap-in is Feature 008). Acceptance is the spec's three
Done-when gates as user-run commands: a zero-MON gasless send, a purchase reaching
SETTLED after the onchain split, and a forced mismatch producing a mismatch row +
non-zero exit. All Phase-0 decisions are in [research.md](research.md) (D1–D18); the
interface contract is [contracts/http-api.md](contracts/http-api.md).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, ESM) on Bun 1.4.2 (repo pin). No Solidity
in this feature — the contracts are consumed via the Feature-004 artifacts.

**Primary Dependencies**: `hono` (both HTTP services, D1); `viem` ^2 (chain reads,
relayer txs, typed payloads — D2); `drizzle-orm` + `@neondatabase/serverless`
(Neon HTTP driver, D3); dev: `drizzle-kit` (schema push), `@electric-sql/pglite`
(in-memory Postgres for unit tests, D4), `@types/bun`. Internal: `@kite/contracts`
(`abis`, `KITE_DEPLOYMENT` addresses, Monad-measured `KITE_GAS_LIMITS` /
`MOCK_AUSD_GAS_LIMITS` — D10), `@kite/core` (money/FX/DTOs + the one Drizzle schema).

**Storage**: Neon Postgres (free tier) — §7.3 tables verbatim + auxiliary tables
(ledger entries, purchase transitions, drips, job_state) per research D15. Onchain
state is read-only input; the contract is the only authority (constitution IV).

**Testing**: `bun test` — unit suite over PGlite with the real Drizzle schema (state
machine, idempotency locks, ledger balance, quote TTL, recon math, integer-money
validation, banned-words payload scan, job read-back logic — D17/D18); plus three
live gate scripts against Monad testnet 10143 (quickstart §3–§5). `bun run health`
(9/9) and `turbo run typecheck` unchanged gates.

**Target Platform**: Bun locally (dev servers + job scripts); Vercel-shaped
(Hono + neon-http) for later hosting — deploying is out of scope (spec).

**Project Type**: Two web services + shared package additions + CLI jobs inside the
existing Bun/Turborepo workspaces (no new workspace).

**Performance Goals**: Demo scale — single relayer key, one job at a time, block-poll
watcher (≤ ~2 s settlement observation), recon over bounded day windows. No
throughput targets (PLAN §12 Day 5–6 gates are correctness gates).

**Constraints**: Constitution VI (integer AUSD base units — no floats in DB, API, or
computation); §7.2 rules 1–7 verbatim (idempotency, state machine, append-only
ledger, recon exit-non-zero, key custody, retry discipline, nonce/gas-on-limit);
constitution I (relayer pays fees invisibly; banned words in emitted strings);
roles never move user funds beyond §6.2 (relayer key = RELAYER_ROLE only); secrets
env-only, never printed.

**Scale/Scope**: ~2 services (routes/jobs/queue), 1 schema module, ~10 unit-test
files, 3 gate scripts, root `env.example`; no UI, no CRE, no indexer.

**Assumptions**: All spec Assumptions carry over (notably: framework = plan decision
→ Hono; `/api/me` demo identity = wallet header; `receiveIncome` submitter = Demo
Tool script until CRE WF-1; FAILED terminal per purchase_ref; FX rates integer +
scale). `/speckit-clarify` was not run for this feature — no NEEDS CLARIFICATION
markers existed at specify time; the judgment calls are research decisions D5, D8,
D11–D13, D15, each veto-able at review.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Invisible Blockchain | PASS | Gasless legs: sender signs, relayer pays (FR-016, D7/D10); drip is invisible one-time MON (FR-017); banned-words scan is a unit test on emitted payloads (D18). |
| II. Fairness Is Physics | N/A this feature | Contract-enforced in Feature 003; backend never re-decides bounds. |
| III. Atomic Settlement | PASS | Backend records what settled; it never splits, holds, or retries money movement itself — the ledger mirrors atomic onchain splits (FR-011). |
| IV. Contract Is Only Authority | PASS | `/api/me` values read from the proxy; watcher corrects the DB FROM `IncomeSettled` + `isaOf()`; isas is a labeled cache (FR-003/FR-009, D9). |
| V. Facts vs Decisions | PASS | Mill signature captured at creation; settlement observed from events, not asserted (D8/D9); submit-settlement is a labeled Demo Tool transport. |
| VI. Integer Money | PASS | bigint columns, integral JSON numbers, integer-validated writes; FX = integer rate + scale, display-only (D13/D14, FR-012). |
| VII. Humane by Design | N/A this feature | Pause/termEnd semantics live in the contract; backend observes. |
| VIII. Honesty Boundary | PASS | Demo Tool labels on submit-settlement + quote source; recon never repairs silently (FR-021); failures surfaced (`last_error`, exit codes). |
| IX. Gates Before Progress | PASS | The three Done-whens are user-run gate scripts (quickstart §3–§5); unit suite covers every §7.2 rule. |
| X. Honest Git History | PASS | One feature per merge on `005-backend-api-relayer`; window-dated commits. |

Hard Constraints check: backend money rules §7.2 verbatim (idempotency UNIQUEs,
state machine + logged transitions, append-only ledger, recon exit-non-zero) ✓;
gas = published fixed limits, charged-on-limit honored (D10) ✓; relayer key powers =
RELAYER_ROLE only, no user-fund movement beyond §6.2 ✓; no contract changes in this
feature (Foundry suite untouched) ✓.

Post-Phase-1 re-check (design artifacts): data-model reproduces §7.3 verbatim with
named, justified auxiliaries; http-api covers every FR-001..FR-021 surface incl.
all four job kinds with payloads + read-backs and recon exit-code semantics; the
three SC gates map 1:1 to quickstart commands. **GATE: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/005-backend-api-relayer/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0: decisions D1–D18
├── data-model.md        # Phase 1: §7.3 verbatim + aux tables, lifecycles
├── contracts/
│   └── http-api.md      # Phase 1: routes, job kinds, read-backs, exit codes
├── quickstart.md        # Phase 1: §0–§7 validation gates (the Done-when commands)
├── checklists/
│   └── requirements.md  # 16/16 PASS (from /speckit-specify)
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── index.ts                 # Hono app + serve (bun dev entry, :3000)
│   ├── env.ts                   # env guard — EnvMissing(<NAME>) pattern (Feature-004 style)
│   ├── routes/
│   │   ├── health.ts            # GET /api/health (FR-001)
│   │   ├── quote.ts             # GET /api/quote (FR-002)
│   │   ├── me.ts                # GET /api/me — chain read + DB merge (FR-003)
│   │   ├── profile.ts           # GET /api/p/:id — public, no personal data (FR-004)
│   │   └── purchases.ts         # POST intent · GET :id · POST :id/paid (FR-005..007)
│   ├── services/
│   │   ├── chain.ts             # viem publicClient + view wrappers over @kite/contracts
│   │   ├── income-sig.ts        # mill EIP-712 verification — SignIncome.s.sol encoding (D8)
│   │   ├── purchase-service.ts  # §7.2 registry: idempotent create, transitions, FAILED terminal
│   │   ├── quote-service.ts     # fx_quotes TTL lock (D13)
│   │   ├── me-service.ts        # merge + empty-state shapes
│   │   └── profile-service.ts   # history from observed events
│   └── jobs/
│       ├── sync-registry.ts     # channels + isas cache upsert from chain (projection bootstrap)
│       ├── watch-settlements.ts # IncomeSettled watcher: checkpoint, webhook lock, cache, ledger (D9); exports processNewLogs()
│       ├── submit-settlement.ts # Demo Tool: submit receiveIncome with stored millSig; FAILED terminal path (D8)
│       └── recon.ts             # daily recon — exits 0/1/2 (D16)
├── package.json                 # +hono +viem +@kite/core +@kite/contracts
└── *.test.ts colocated          # unit tier (PGlite)

apps/relayer/
├── src/
│   ├── index.ts                 # Hono server (:3001) + worker loop, one process (D5)
│   ├── env.ts
│   ├── queue.ts                 # claim FOR UPDATE SKIP LOCKED, serialize, backoff, client_ref
│   ├── send.ts                  # walletClient, fixed gas limits, nonce resync (D6/D10)
│   ├── caps.ts                  # daily outflow caps
│   └── jobs/{activate-with-permit,transfer-with-authorization,bind-identity,drip}.ts  # + read-backs (D7)
├── package.json                 # +hono +viem +@kite/core +@kite/contracts
└── *.test.ts colocated

packages/core/
├── src/
│   ├── money.ts                 # integer AUSD helpers, bps, progress (constitution VI)
│   ├── fx.ts                    # pairs, demo rates + scales, TTL constant (D13)
│   ├── types.ts                 # shared DTOs (Purchase, Me, Profile, Job — http-api shapes)
│   └── db/
│       ├── schema.ts            # THE Drizzle schema: §7.3 verbatim + aux (D3/D15)
│       └── client.ts            # neon-http factory + pglite factory (tests)
├── drizzle.config.ts
└── package.json                 # +drizzle-orm +neon driver; dev +drizzle-kit +pglite

scripts/
├── healthcheck.ts               # existing (9/9) — unchanged
└── gates/
    ├── gasless-send.ts          # SC-001
    ├── purchase-settled.ts      # SC-002
    └── recon.sh                 # SC-003 (clean + forced mismatch + infra + cleanup)

env.example                      # NEW (root) — backend env: names + non-secret defaults only
package.json                     # +db:push +dev:api +dev:relayer scripts
```

**Structure Decision**: Everything lands in existing workspaces (no new package —
PLAN §10's `packages/core` already owns shared types/money/FX and now the one Drizzle
schema; a `packages/db` would be unjustified complexity). Jobs live next to the
service that owns them: observation/settlement in `apps/api` (they own purchase
state), the tx queue in `apps/relayer`. Gate scripts sit in root `scripts/gates/`
beside `healthcheck.ts` because they validate cross-service behavior, not one
workspace.

## Complexity Tracking

No constitution violations to justify — table intentionally empty.
