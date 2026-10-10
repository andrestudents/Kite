# Implementation Plan: Testnet Deployment + Demo Seed

**Branch**: `004-testnet-deploy-seed` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-testnet-deploy-seed/spec.md`

## Summary

Put Feature 003's contracts on the public Monad testnet and seed the exact §6.3/§11.3
demo state, all through real contract calls. Two enabling changes land first, in order:
(1) the PLAN amendment (rule F1, never code-before-PLAN) making `MIN_EVENT_GAP` a
governed `initialize()` parameter — protocol value 60 days, testnet demo value 60
seconds — with `KiteScoring` staying pure (gap as an argument); (2) the contract
refactor it describes, keeping the Feature-003 suite green (108 tests: unit/literal
tiers still assert the real 60-day value; the new `testGap_` tier proves the 60-second
demo deployment). Then `DeployKiteCore.s.sol` (asset per Q2/C — MockAUSD by default,
real AUSD behind a preflight — plus implementation, ERC-1967 proxy, roles from env,
mill channel, Monadscan verification) and the staged `SeedDemo.s.sol` + driver that
builds Budi's {2,2,4,2} → 58 and the active 600/780/480e6 ISA by sleeping out the
configured gap on the live chain (2 waits ≈ 2 min). Finally `addresses.ts` + generated
ABIs to `packages/contracts`, gas limits recalibrated from Monad receipts, and the
cast-only manual loop runbook (PLAN §12 Day-4 done-when). All Phase-0 decisions are in
[research.md](research.md) (D1–D14); the script/publish/runbook interface contract is
[contracts/deploy-seed-api.md](contracts/deploy-seed-api.md).

## Technical Context

**Language/Version**: Solidity ^0.8.20 → solc 0.8.36 (unchanged); Foundry 1.5.1
(`forge script`/`cast` for deployment); bash driver; TypeScript for published
artifacts (bun workspace `@kite/contracts`).

**Primary Dependencies**: unchanged contract stack (OZ 5.x pinned vendored, forge-std);
`ERC1967Proxy` now used in production script (was test-only). New externals: Monad
testnet (chain `10143`, RPC default `https://testnet-rpc.monad.xyz` per PLAN §11.1),
Monadscan explorer/verification (`https://testnet.monadscan.com`, API
`https://api-testnet.monadscan.com/api`, Etherscan-compatible — research D1), Monad
faucet `https://faucet.monad.xyz` (MON), optional real AUSD
`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` behind the Q2/C preflight (D6).

**Storage**: onchain only (fresh proxy deployment); published artifacts are code
(`addresses.ts`, `abis/*.json`) — no database in this feature.

**Testing**: `forge test --root contracts` — 108 tests after the gap refactor
(10 MockAUSD + 21 KiteScoring + 65 KiteCore + 12 invariants; contractual names in
[contracts/deploy-seed-api.md](contracts/deploy-seed-api.md)). Acceptance beyond tests
is the live-chain gate: `cast call` scoreOf(Budi)==58 and remaining==480e6, the manual
loop to `CompletedCapped`, explorer-verified sources, recalibrated gas limits
(quickstart §4–§7).

**Target Platform**: Monad testnet (production-shaped deployment; PLAN §11.1).
Gas is charged on the **limit**, not usage — deployment txs use a tight estimate
multiplier (`-g 115`), manual `cast` txs use explicit `--gas-limit` from published
values, and published limits are recalibrated from Monad receipts (research D7).

**Project Type**: deployment + seeding tooling and a parameterization refactor inside
the repo's `contracts/` unit, plus generated artifacts in `packages/contracts`.

**Performance Goals**: seed wall-clock ≤ ~10 min at the 60 s demo gap (2 waits + tx
latency); every script tx has a sane charged-limit (no 200% multiplier waste).

**Constraints**: constitution Hard Constraints unchanged (Foundry/OZ/UUPS, integer
AUSD, role confinement, asymmetric pause — untouched by this feature); secrets only
via env (`env.example` names values never; `.env*` already gitignored — hence the
undotted filename, D9); chain guard 10143; the asset is immutable at init so the
preflight aborts before proxy init on any doubt (D6).

**Scale/Scope**: 2 contract-source files touched (`KiteScoring.sol` pure-signature,
`Governed.sol`/`KiteCore.sol` init + storage, `Stream.sol` call-site) + 2 test files
touched + 6 new script files + 3 published artifacts + PLAN §6.2/§12/§3 amendments +
gas-limit recalibration.

**Assumptions**: all spec Assumptions carry over. Q1/A and Q2/C are user-approved
(spec Resolutions block); research D12 drafts the exact PLAN wording as the first
implementation task. The Agora faucet documented in their docs is Sepolia-only
(`requestFunds` → 10,000 AUSD) and Monad testnet is absent from that page — the
default MockAUSD path stands unless the user's faucet attempt at deploy time passes
the ~14,000 AUSD sufficiency preflight (D6, D14).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Invisible Blockchain | PASS | No UI in scope; secrets stay invisible (env-only, D9); deployment words never reach user screens. |
| II. Fairness Is Physics | PASS | Deal bounds (share/capMult/term/maxP/channel/no-second-active) untouched. The gap parameter does not relax any §6.2 bound — it moves one §6.2 *parameter's* provenance from constant to governed init value, PLAN-amended first (FR-015/D12). |
| III. Atomic Settlement | PASS | Settlement path unchanged; the seed exercises the real atomic `receiveIncome` only. |
| IV. Contract Is Only Authority | PASS | Seed state is produced ONLY by real contract calls on the public chain — no state writes, no shortcuts; anyone recomputes Budi's 58 from public history. |
| V. Facts vs Decisions | PASS | Every seed income event carries a real mill channel signature verified onchain (D5); the orchestrator transports, the contract decides. |
| VI. Integer Money | PASS | AUSD base units end-to-end; published artifacts are integers/addresses only. |
| VII. Humane by Design | PASS | Pause asymmetry and `completeAtTerm` untouched; the throwaway loop ends at cap, never trapping anything. |
| VIII. Honesty Boundary | PASS | The load-bearing principle here: demo gap (60 s vs protocol 60 d) disclosed in TRUST.md + `addresses.ts` + judge instructions (FR-018); MockAUSD labeled; throwaway ISA labeled; verification never marked done on trust (gate stays open while unverified, D1/D11). |
| IX. Gates Before Progress | PASS | Quickstart IS the Done-when (cast-call literals, manual loop, explorer hashes, committed addresses); §6.3 literals still tested at the real 60-day value (FR-017/D4); new `testGap_` tier pins the demo behavior. |
| X. Honest Git History | PASS | Window-dated commits, one feature per merge; zero secrets in tree/history (`env.example` carries names only, D9); generated ABIs committed with their generator command. |

Hard Constraints check: Foundry + Solidity 0.8.x + OZ 5.x + UUPS + ERC-7201 ✓ (gap
lives in Governed's existing ERC-7201 namespace — no new module, no layout shift,
fresh deployment anyway); **gas measured on Monad and published** ✓ — this feature IS
the promised recalibration (D7); RELAYER/ORCHESTRATOR fund-confinement ✓ — no new
privileged functions, the gap has NO setter after init (init-once, D3); integer money ✓.

Post-Phase-1 re-check (design artifacts): data-model's stage machine produces exactly
the FR-009 ledger with 2 sleeps; the interface contract carries every env name, every
command, the addresses.ts shape, and the 5 new contractual test names; quickstart §4–§7
map 1:1 to SC-001..SC-006. **GATE: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/004-testnet-deploy-seed/
├── plan.md                       # This file (/speckit-plan output)
├── research.md                   # Phase 0: decisions D1–D14
├── data-model.md                 # Phase 1: deployment/seed entities + stage machine
├── contracts/
│   └── deploy-seed-api.md        # Phase 1: scripts CLI, env matrix, artifacts, runbook contract
├── quickstart.md                 # Phase 1: §0–§7 validation gates (the Done-when commands)
├── checklists/
│   └── requirements.md           # all PASS (from /speckit-specify)
└── tasks.md                      # Phase 2 (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
PLAN.md                            # AMENDED FIRST (§6.2 clarification blockquote, §12 Day-4
                                   #   line, §3 step 6 — exact wording in research D12)
contracts/
├── script/                        # NEW directory
│   ├── DeployKiteCore.s.sol       # asset preflight/Q2-C → MockAUSD | real AUSD; impl; proxy
│   │                              #   init(…, minEventGap); roles asserted; channel; verify
│   ├── SeedDemo.s.sol             # SEED_STAGE 1..5, one qualifying event/stage (D5); multi-broadcaster; on-chain asserts
│   ├── seed-demo.sh               # driver: stage 1 → sleep DEMO_GAP+buffer → 2 → sleep → 3
│   ├── SignPermit.s.sol           # runbook helper — prints a signed ERC-2612 permit (no broadcast)
│   ├── SignIncome.s.sol           # runbook helper — prints the channel IncomeEvent sig (no broadcast)
│   ├── env.example                # variable NAMES + comments only (undotted: `.env*` is gitignored, D9)
│   ├── MANUAL-LOOP.md             # the cast-only throwaway runbook (PLAN §12 Day-4 done-when)
│   └── DEMO-ACCOUNTS.md           # public addresses of personas/operators only
├── src/
│   ├── KiteScoring.sol            # isQualifyingEvent(…, uint256 minGap) — stays pure, D3
│   ├── KiteCore.sol               # initialize(…, uint256 minEventGapSec) — 6th param, D3
│   └── modules/
│       ├── Governed.sol           # minEventGap in ERC-7201 namespace + view getter; NO setter, D3
│       └── Stream.sol             # passes the stored gap into isQualifyingEvent, D3
├── test/
│   ├── KiteCore.t.sol             # +3 testGap_*, testInitialize_ updated (65 total)
│   ├── KiteScoring.t.sol          # call sites + 1 testGap_ (21 total)
│   └── invariant/                 # untouched — still configures 60 days, D4
├── SLITHER.md                     # re-triaged rows for the two touched src files
└── .gas-snapshot                  # refreshed after the refactor

packages/contracts/
├── package.json                   # + "gen:abis" script (forge inspect → src/abis/, D8)
└── src/
    ├── addresses.ts               # NEW — chain, addresses, live-asset flag, channel, gap, explorer
    ├── abis/                      # NEW — kitecore.abi.json, mockausd.abi.json (generated, committed)
    ├── gasLimits.ts               # recalibrated: MONAD TESTNET MEASURED header (D7)
    └── index.ts                   # + export addresses + abis
```

**Structure Decision**: scripts live in `contracts/script/` (forge's default script
path for the existing `--root contracts` invocation style); published artifacts go to
the existing `@kite/contracts` bun workspace exactly as Feature 003 published
`gasLimits.ts` there (D8). No new workspaces, no new top-level dirs.

## Complexity Tracking

No constitution violations to justify — table intentionally empty.
