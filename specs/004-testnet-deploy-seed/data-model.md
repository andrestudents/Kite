# Data Model: Testnet Deployment + Demo Seed (Feature 004)

**Source**: spec.md Key Entities + FR-001..FR-014 · research.md D3 (gap storage), D5
(stage machine), D6 (preflight), D7 (gas observations), D8 (published artifacts), D9
(env matrix). Onchain state is Feature 003's, unchanged except one governed field
(D3); everything here is the **deployment/seed layer around it**. Money is integers
in AUSD base units (constitution VI).

## Onchain delta (the only contract-state change — research D3)

| Namespace | Field | Type | Rules |
|---|---|---|---|
| `kite.governed` | `minEventGap` | uint256 | set once in `initialize(…, minEventGapSec)`, `> 0`, **no setter**; read by `Stream` for the §6.3 qualifying bar; exposed via `minEventGap()` view |

Everything else (Terms, ISA, Profile, Channel, bindings, registries, roles, pause) is
Feature 003's model verbatim — see
[../003-kitecore-mockausd/data-model.md](../003-kitecore-mockausd/data-model.md);
ISA state machine and completion bookkeeping are untouched.

## Deployment record (published as `packages/contracts/src/addresses.ts` — research D8)

| Field | Type | Validation / source |
|---|---|---|
| chainId | 10143 | hard guard in both scripts (spec FR-006) |
| network / rpcUrl / explorerBaseUrl | strings | `Monad Testnet` / env `RPC_URL` (default PLAN §11.1) / `https://testnet.monadscan.com` |
| kiteCore | address | ERC-1967 proxy — THE Kite address for all consumers |
| kiteCoreImpl | address | UUPS implementation (verified source) |
| ausd | address | MockAUSD (deployed) or real AUSD (attached behind preflight) |
| ausdIsMock | boolean | recorded so consumers/TRUST.md state which rail is live (FR-001) |
| channelId | uint64 | the mill channel registered at deploy |
| minEventGapSec | uint256 | the configured gap — the disclosure artifact (FR-018) |
| deployedAt | uint256 | block timestamp of proxy init |

All fields `as const`; the file is hand-written once per deployment from the script's
printed manifest.

## Environment matrix (names committed, values never — research D9)

| Variable | Secret | Used by | Default |
|---|---|---|---|
| RPC_URL | no | deploy, seed, runbook | `https://testnet-rpc.monad.xyz` |
| KITE_CORE_ADDRESS | no | seed, runbook helpers | — (copy from the deploy manifest; the settlement asset is read from the contract, `kite.ausd()`, never from env) |
| DEPLOYER_KEY | yes | deploy (broadcast), seed (funding leg) | — |
| RELAYER_KEY / RELAYER_ADDR | yes / no | seed `bindIdentity` ×4 | — |
| ORCHESTRATOR_KEY / ORCHESTRATOR_ADDR | yes / no | seed `receiveIncome` ×5 | — |
| PAUSER_ADDR | no | deploy init arg | — |
| ADMIN_ADDR | no | deploy init arg (defaults to deployer) | deployer |
| BUDI_KEY / PAKHAJI_KEY / SITI_KEY / WATI_KEY | yes | seed (drafts, permits) | — |
| MILL_KEY / MILL_CHANNEL_NAME | yes / no | channel registration + income signatures | — |
| AUSD_ADDRESS | no | Q2/C asset switch | unset → MockAUSD |
| EXPLORER_API_KEY | yes | Monadscan verification | placeholder attempted |
| DEMO_GAP_SECONDS | no | seed waits, printed wall-clock | 60 |
| SEED_AUSD_MIN | no | sufficiency preflight | 14000e6 |
| MON_TOPUP_OPERATOR / MON_TOPUP_PERSONA | no | MON funding leg | 1e18 / 0.3e18 |

Preflight contract: missing var → abort naming it (never a value); MON balance
< 0.5e18 → abort; wrong chain → abort. `contracts/script/env.example` documents the
names; `contracts/script/DEMO-ACCOUNTS.md` records the derived **public** addresses
only.

## Seed ledger (the FR-009 exact sequence — every split a §6.3 literal)

Persona wallets: Budi (seeker), Siti + Wati (two DISTINCT historical backers —
structurally required for History 26), Pak Haji (active backer), Mill (channel signer
AND funding account of every gross, research D6 of 003).

| # | ISA | Terms | Event | Gross | Divert→backer | To seeker | Remaining after | Qualifies? | Profile after |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ISA-1 Budi→Siti | P 300e6 · 2000 bps · 130× → cap 390e6 | E1 | 1,500e6 | 300e6 | 1,200e6 | 90e6 | YES (first) | — |
| 2 | | | E2 (+gap) | 450e6 | 90e6 | 360e6 | 0 → **CompletedCapped** | YES | {1,1,2,1} · score 29 · maxP 948e6 |
| 3 | ISA-2 Budi→Wati | P 600e6 (≤948 ✓) · cap 780e6 | E3 | 1,500e6 | 300e6 | 1,200e6 | 480e6 | YES (first) | — |
| 4 | | | E4 (+gap) | 2,400e6 | 480e6 | 1,920e6 | 0 → **CompletedCapped** | YES | {2,2,4,2} · **score 58** · maxP 1296e6 |
| 5 | ISA-3 Budi→Pak Haji | P 600e6 · cap 780e6 (the demo ISA) | E5 | 1,500e6 | 300e6 | 1,200e6 | **480e6 (38.5%)** | YES (first; score unchanged while Active) | stays 58 |

The driver waits ≥ `DEMO_GAP_SECONDS + 10` before EVERY qualifying event after the
first — four sleeps (E2, E3, E4, E5) ≈ 5 min at 60 s. Qualifying status is decided
per event (user correction 2026-10-10), so no qualifying event fires without its
preceding wait; see the stage machine below. Post-seed asserts (stage 5,
FR-008/FR-012):
`scoreOf(Budi)==58`, ISA-3 literals (P/cap/remaining/status Active/backer), balances
(Pak Haji ≥ threshold, mill ≥ finale headroom, relayer/orchestrator MON > 0),
`minEventGap()==DEMO_GAP_SECONDS`.

## Stage machine (research D5 — `SEED_STAGE` 1..5, one qualifying event per stage, skip-idempotent)

```text
S1 ──(sleep gap+10s)──► S2 ──(sleep gap+10s)──► S3 ──(sleep gap+10s)──► S4 ──(sleep gap+10s)──► S5 ──► ASSERTS+MANIFEST
```

The sleep lands BEFORE each qualifying event after the first (E2–E5) — four sleeps.
A forge run broadcasts at one point in real time, so no stage may contain two
qualifying events; 5 stages is the minimal structure (E1 rides with setup,
drafts/activates ride with their event).

| Stage | Precondition reads (skip if already true) | Broadcasts (as) |
|---|---|---|
| 1 | balances < targets; identities unbound; no ISA-1 | deployer: AUSD/MON funding, mill approve · relayer: bindIdentity ×4 · Budi: draft ISA-1 · deployer: activateWithPermit (Siti sig) · orchestrator: receiveIncome **E1** |
| 2 | ISA-1 Active; E1 settled | orchestrator: **E2** → ISA-1 CompletedCapped, profile {1,1,2,1} score 29 |
| 3 | profile {1,1,2,1}; no ISA-2 | Budi: draft ISA-2 (P 600e6 ≤ 948) · activate (Wati sig) · orchestrator: **E3** |
| 4 | ISA-2 Active; E3 settled | orchestrator: **E4** → ISA-2 CompletedCapped, profile {2,2,4,2} **score 58** |
| 5 | profile {2,2,4,2}; no ISA-3 | Budi: draft ISA-3 · activate (Pak Haji sig) · orchestrator: **E5** → assert block |

(003's chain code tracks `lastEventAt` per ISA — `contracts/src/modules/ISA.sol` —
so E3/E5 are first-of-ISA and gap-free there; the uniform per-event wait is the
conservative superset, correct under any guard granularity. Research D5.)

Every stage re-derives its world from chain reads; a re-run resumes at the first
incomplete step (spec edge case). The bash driver prints the expected wall-clock
duration (4 sleeps ≈ 5 min at 60 s) before starting and refuses
`DEMO_GAP_SECONDS = 0`.

## Gas observation (research D7 — feeds the recalibrated `gasLimits.ts`)

| Field | Rule |
|---|---|
| observedMax | max `gasUsed` across Monad receipts for that function (deploy+seed+runbook) |
| fixedLimit | `ceil(observedMax × 1.25 / 1000) × 1000` |
| header | `MONAD TESTNET MEASURED (chain 10143, <date>)` — replaces `LOCAL-EVM BASELINE` |
| deploy-time policy | `forge script -g 115`; runbook `cast send --gas-limit <published>` |

## ABI artifacts (research D8)

`packages/contracts/src/abis/{kitecore,mockausd}.abi.json` — generated by
`forge inspect <Contract> abi` via `bun run gen:abis`, committed, re-exported from
`@kite/contracts` (index). Byte-stable; no forge dependency for consumers.

## Relationships

Deployment record 1—1 proxy deployment (asset, impl, channel); personas N—1
deployment (all env-sourced wallets); seed ledger 5 events → 3 ISAs → 1 profile;
stage machine 1—N broadcasts, each referencing only onchain state (constitution IV —
no local files carry authority).

## Volume assumptions

One deployment, one seed run (+ idempotent re-runs), one throwaway loop. Sequential
nonce management per broadcaster; `forge script --resume` available for interrupted
broadcasts. No indexer, DB, or retention in this feature.
