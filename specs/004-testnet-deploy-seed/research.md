# Research: Testnet Deployment + Demo Seed (Feature 004)

**Input**: spec.md FR-001..FR-018 · PLAN §3/§6.2/§6.3/§11/§12/§14 · constitution I–X
**Note**: both specify-time questions were answered by the user (spec Resolutions
block): **Q1/A** (governed `MIN_EVENT_GAP`, demo 60 s, PLAN amended first) and
**Q2/C** (env-switchable asset, MockAUSD default, strengthened preflight). Nothing
below re-opens them; D3/D12 encode their exact mechanics and PLAN wording, and D6
adds the preflight the user asked for. External facts verified 2026-10-10: Monad docs
(testnet essentials, block-explorers page), Monadscan API, forge 1.5.x `forge script
--help` (local), Agora docs (deployments page, llms.txt index, getting-testnet-tokens
page), Monad gas model (monskills:gas).

**The calendar wall, for the record (why Q1/A exists)**: score 58 = {2,2,4,2}; profiles
change only at completion; 4 qualifying events over 2 sequential ISAs (one Active per
seeker) = two 60-day gaps that cannot overlap → ≥ ~120 days of history at the protocol
value. The window (29 Sep → 14 Oct 2026) is 15 days. Hence a governed gap parameter
with a disclosed demo value — never a silent deviation.

---

## D1 — Explorer and verification: Monadscan, Etherscan-compatible

- **Decision**: Verify via forge's Etherscan verifier pointed at Monadscan's API:
  `--verifier etherscan --verifier-url https://api-testnet.monadscan.com/api`
  (+ `--verifier-api-key` from env; Monadscan is Etherscan-powered per Monad's
  block-explorers doc). Explorer base for links: `https://testnet.monadscan.com`.
  Verify the KiteCore implementation, the ERC1967Proxy (OZ source, constructor args),
  and MockAUSD when deployed. On failure: `forge verify-contract` retry with backoff;
  verification is never marked done on trust — the §14 row stays open (spec FR-004,
  SC-003).
- **Rationale**: Monad's docs list exactly this API endpoint for testnet verification;
  forge supports it natively, no new tooling.
- **Alternatives**: Sourcify via BlockVision (`sourcify-api-monad.blockvision.org`)
  (rejected as primary — extra surface; fine as a manual fallback if Monadscan
  verification is down on the day).

## D2 — RPC, chain guard, network facts

- **Decision**: Default RPC `https://testnet-rpc.monad.xyz` (PLAN §11.1; QuickNode —
  50 rps, 25 rps for `eth_call`/`eth_estimateGas`, batch ≤ 100), overridable via
  `RPC_URL`. Both scripts hard-revert unless `block.chainid == 10143` (spec FR-006).
  MON comes from `https://faucet.monad.xyz` (user-run, quickstart §0). Testnet was
  last reset from genesis 2025-12-16 — irrelevant to a fresh deployment but worth
  knowing if old artifacts are found.
- **Rationale**: PLAN names this RPC; QuickNode's limits comfortably cover a
  sequential deployment script; a chain guard makes an accidental mainnet/local run
  impossible.
- **Alternatives**: Foundation RPC `https://rpc-testnet.monadinfra.com` (20 rps, no
  batch requests — forge's batching would need `--batch-size 1`; kept as env fallback
  only); Ankr (no `debug_*`, no archive — rejected).

## D3 — The gap parameterization (exact diff; Q1/A mechanics)

- **Decision**:
  - `KiteScoring.isQualifyingEvent(uint256 lastEventAt, uint256 at, uint256 gross,
    uint256 principal, uint256 minGap)` — new 5th parameter; the `MIN_EVENT_GAP`
    constant is removed from the library (it now has no opinion); the library stays
    pure and stateless. `MIN_EVENT_BPS` stays a constant (Q1/A said nothing about the
    size bar, and 10% is not a calendar concept).
  - `Governed` ERC-7201 namespace gains `uint256 minEventGap`, set in
    `initialize(address admin, address relayer, address orchestrator, address pauser,
    address ausdToken, uint256 minEventGapSec)` — parameter appended last. A public
    view `minEventGap()` exposes the configured value (disclosure + asserts). **No
    setter exists**: the value is init-once, like the asset. `minEventGapSec` must be
    > 0.
  - `Stream.receiveIncome` passes the stored gap into `isQualifyingEvent`.
  - Storage safety: new field inside Governed's existing namespaced struct, fresh
    deployment, no migration; Feature-003's layout-collision test still passes.
- **Rationale**: user's fold-in #1 verbatim (governed parameter, pure library);
  init-once with no setter keeps the trust surface unchanged (constitution Hard
  Constraints: no new privileged functions) and keeps the disclosure story simple
  ("this deployment was born with 60 s; nothing can change it").
- **Alternatives**: a governed setter (`setMinEventGap`, ADMIN) (rejected: adds a
  mutable score-integrity knob — strictly worse for the anti-farming story);
  keeping the constant and warping a local chain (that was Q1/B — not chosen).

## D4 — Test strategy for the refactor (108 tests, names contractual)

- **Decision**:
  - `KiteScoring.t.sol` (20 → **21**): update `isQualifyingEvent` call sites to pass
    `60 days`; add `testGap_ArgumentControlsQualifyingWindow` (same inputs qualify at
    gap=1 day and fail at gap=60 days — proving the argument, not a constant, decides).
    All existing literal/§6.3 tests keep the real 60-day value.
  - `KiteCore.t.sol` (62 → **65**): `setUp` initializes with `60 days` — every
    existing test's behavior is unchanged. `testInitialize_SetsRolesAssetAndGap`
    (updated name) asserts the new parameter. New tier, exact names:
    `testGap_MinEventGap_SetAtInit_NoSetter` (init with 90 days; assert view returns
    it; assert no setMinEventGap selector exists),
    `testGap_Qualifying_At60Seconds_DemoDeployment` (a fixture initialized at 60 s:
    two events 60 s apart both qualify), `testGap_NonQualifying_At59Seconds_DemoDeployment`
    (59 s apart → splits, no credit).
  - Invariants (12): untouched — the handler still initializes at 60 days, so the
    inline ghost expectations (which use the 60-day literal) remain correct. "Invariants
    run at the configured value" is satisfied: the suite reads the deployment's
    configuration; here that configuration is the protocol value.
  - Totals: 10 MockAUSD + 21 KiteScoring + 65 KiteCore + 12 invariants = **108**.
    Refresh `.gas-snapshot` (initialize signature changed) and re-triage the two
    touched src files in `SLITHER.md`.
- **Rationale**: user fold-in #2 (unit tests at the real value; invariants at the
  configured value) with minimal churn; contractual names keep quickstart counts
  exact (constitution IX).
- **Alternatives**: initializing the whole KiteCore suite at 60 s (rejected: the §6.3
  literal journey then tests the demo gap, not the protocol value — weakens the
  anti-farming proof).

## D5 — Staged seed: why, and the exact stage machine

- **Decision** *(amended 2026-10-10 — user correction: the wait is per qualifying
  EVENT, not per ISA-first; supersedes the original 3-stage/2-sleep design)*:
  `SeedDemo.s.sol` reads `SEED_STAGE` (1..5) from env; `script/seed-demo.sh` drives:
  stage 1 → `sleep DEMO_GAP_SECONDS + 10` → stage 2 → sleep → stage 3 → sleep →
  stage 4 → sleep → stage 5 → summary. **One qualifying event per stage**, and the
  sleep lands BEFORE each qualifying event after the first (E2, E3, E4, E5 — four
  sleeps ≈ 5 min at 60 s). The script switches broadcasters with
  `vm.startBroadcast(<key from env>)` per role/persona (deployer, relayer, Budi,
  orchestrator) — forge supports multiple broadcast accounts keyed from inside the
  script. Each stage is independently simulated against the latest chain state and is
  **skip-idempotent**: it re-reads chain state (profile counters, ISA ids/status) and
  skips steps already visible, so a re-run after a partial failure never double-executes.
  Stage contents (mirrors FR-009 exactly):
  - **Stage 1 — fund + launch ISA-1 + E1**: AUSD out to Siti/Wati/Pak Haji + mill
    (mill also `approve(KiteCore, max)`); MON top-ups to relayer/orchestrator/personas
    from the deployer; `bindIdentity` ×4 (as relayer); ISA-1 draft (Budi→Siti,
    P 300e6, 20%, 130×) + activate (Siti permit) + **E1** (orchestrator, mill signs,
    gross 1500e6). *The permit here is the real-AUSD canary: if the attached asset
    lacks ERC-2612, the seed dies in minute 1, before any waiting.*
  - **Stage 2 — E2 completes ISA-1**: gross 450e6 → divert 90e6 → ISA-1
    CompletedCapped; profile {1,1,2,1}, score 29, maxP 948.
  - **Stage 3 — launch ISA-2 + E3**: ISA-2 draft (Budi→Wati, P 600e6 ≤ 948 ✓) +
    activate (Wati permit) + **E3** (gross 1500e6 → 300e6).
  - **Stage 4 — E4 completes ISA-2**: gross 2400e6 → divert 480e6 → ISA-2
    CompletedCapped; profile {2,2,4,2}, score 58, maxP 1296.
  - **Stage 5 — launch the demo ISA + E5**: ISA-3 draft (Budi→Pak Haji, P 600e6,
    20%, 130× → cap 780e6) + activate (Pak Haji permit) + **E5** (gross
    1500e6 → 300/1200, remaining 480e6); then the full assert block
    (scoreOf==58, isaOf literals, balances, minEventGap==configured) and a printed
    manifest. Any assert mismatch → non-zero exit with expected vs observed (FR-012).
  The driver prints the computed wall-clock expectation before starting (spec edge
  case: transparency at any configured gap) and refuses `DEMO_GAP_SECONDS = 0`.
  **Why per-event (the correction)**: qualifying status is decided per event, so the
  wait must precede every qualifying event — E3 and E5 included, not only the
  per-ISA seconds. 003's chain code tracks `lastEventAt` on the ISA
  (`contracts/src/modules/ISA.sol`; first-of-ISA events are gap-free there), which
  is what made the original two-sleep design look sufficient; the uniform
  four-sleep schedule is the conservative superset — correct under the shipped
  per-ISA semantics AND under any future per-seeker tightening — at the cost of
  ~2 extra minutes.
- **Rationale**: Solidity cannot sleep and a single forge run broadcasts at one
  point in real time — any two gap-separated qualifying events must live in
  different script invocations, which caps a stage at ONE qualifying event and
  makes 5 stages the minimal structure (E1 rides with setup; drafts/activates ride
  with their event's stage). Multi-broadcaster is the only way one script speaks as
  seeker, relayer, and orchestrator on a real chain (no `vm.prank` outside tests).
- **Alternatives**: three stages / two sleeps exploiting per-ISA firsts (the
  original design — rejected 2026-10-10 by user correction: the honest schedule
  waits before every qualifying event, and it must not depend on guard-granularity
  details of the shipped code); five separate stage scripts with shared helpers
  duplicated (rejected: one .s.sol is the deliverable); one script hoping `--slow`
  suffices (rejected: simulation of E2 at E1's timestamp reverts — non-qualifying
  diverges from expected state and the assert fails); cast-only seeding with no
  .s.sol (rejected: user's deliverable names SeedDemo.s.sol).

## D6 — Asset switch + the strengthened preflight (Q2/C mechanics)

- **Decision**: `AUSD_ADDRESS` unset → deploy MockAUSD (constructor mints 1,000,000e6
  to the deployer; distributions flow from there). Set → attach only after preflight
  passes, BEFORE the proxy is initialized (asset is immutable at init): (a) code
  exists at the address; (b) `decimals() == 6`; (c) funding-sufficiency — the
  deployer's AUSD balance ≥ `SEED_AUSD_MIN` (default 14,000e6, env-tunable: seed
  7,350 + finale 2×1,500 + throwaway loop + headroom); (d) interface canary — the
  stage-1 permit activation exercises ERC-2612 within minute 1 and fails loudly if
  absent; ERC-3009 presence is checked by the runbook's documented dummy
  `transferWithAuthorization` staticcall (custom-error revert = present; empty revert
  data = missing) before anyone builds on the real asset. Abort messages name the
  failed probe. `addresses.ts` records `ausdIsMock` so every consumer knows which
  rail is live (app code itself stays token-agnostic per D11-design).
- **Rationale**: user's Q2/C fold-in verbatim; the two-step (hard preflight +
  first-minute canary) catches everything checkable without over-fitting to Agora's
  bytecode.
- **Facts**: Agora's deployments page confirms testnet AUSD
  `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` (same address across listed testnets)
  and shows a faucet contract `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` — but the
  faucet documentation covers **Sepolia only** (`requestFunds(caller)` → 10,000 AUSD
  per call) and never mentions Monad. Neither page states ERC-2612/3009 for the
  Monad deployment. Net: the real path is plausible but unproven — exactly what the
  preflight decides at runtime; MockAUSD remains the default (PLAN Q1 fallback).
- **Alternatives**: trusting the address without probes (rejected: immutable-at-init
  makes a wrong asset a redeploy); probing permit by staticcall with dummy signature
  (rejected: indistinguishable reverts — the canary is the honest probe).

## D7 — Gas discipline on Monad (charged on the limit)

- **Decision**:
  - **Deploy/seed broadcasts**: `forge script … -g 115` (gas-estimate-multiplier
    1.15×). Forge script has NO per-tx fixed-gas flag (`--gas-limit` is an alias of
    `--block-gas-limit`, simulation-only — verified in `forge script --help`), so a
    tight multiplier is the correct knob; the 200% default doubles cost on Monad.
    Estimates are accurate on Monad (the node executes with repriced opcodes), and
    the Monad guidance is "buffer ≤ ~10–15%".
  - **Manual cast txs**: explicit `cast send … --gas-limit <value>` from the
    published table.
  - **Recalibration** (the promised Monad measurement): after deploy+seed, read each
    tx kind's `gasUsed` from receipts (`cast receipt <hash>`), take
    `observedMax = max(gasUsed on Monad)`, republish `fixedLimit =
    ceil(observedMax × 1.25 / 1000) × 1000`, and replace the header with
    `MONAD TESTNET MEASURED (chain 10143, 2026-10-…)`. Expect +20–40% vs local-EVM:
    cold SLOAD 8,100 (vs 2,100), cold account 10,100 (vs 2,600), `ecRecover` 6,000
    (vs 3,000) — `receiveIncome` and `activateWithPermit` both verify a signature.
- **Rationale**: spec FR-007 + constitution Hard Constraint ("gas measured on Monad");
  monskills:gas confirms charging-on-limit and the small-buffer rule. The published
  table's consumers are the future relayer/app + the cast runbook.
- **Alternatives**: keeping local-EVM numbers (rejected: they underestimate Monad);
  measuring with 200% multipliers (rejected: the receipt's gasUsed is the fact; the
  multiplier only affects what we paid to learn it).

## D8 — Published artifacts: addresses.ts + generated ABIs

- **Decision**: `packages/contracts/src/addresses.ts` exports a `KITE_DEPLOYMENT`
  const object: `{ chainId: 10143, network: "Monad Testnet", rpcUrl, explorerBaseUrl:
  "https://testnet.monadscan.com", kiteCore (proxy), kiteCoreImpl, ausd, ausdIsMock,
  channelId, minEventGapSec, deployedAt }` — `as const`. ABIs: `bun run gen:abis`
  (package.json script) shells `forge inspect KiteCore abi` /
  `forge inspect MockAUSD abi` into committed JSON files under
  `packages/contracts/src/abis/`, re-exported typed from `index.ts` alongside
  `addresses` and the recalibrated `gasLimits`. Generated files are committed (their
  consumers have no forge requirement); the generator is one command, documented.
- **Rationale**: spec FR-013; Feature 003 explicitly deferred ABI export to this
  feature; JSON-from-forge-inspect is byte-stable and dependency-free.
- **Alternatives**: importing forge `out/*.json` build artifacts directly (rejected:
  `contracts/out/` is gitignored and TS-hostile); a viem `as const` ABI codegen step
  (deferred: no consumer needs human-readable typings yet; JSON literal types
  suffice).

## D9 — Secrets and the env matrix

- **Decision**: every key enters via env only: `DEPLOYER_KEY` (default broadcaster),
  `RELAYER_KEY`, `ORCHESTRATOR_KEY`, `PAUSER_ADDR` (pauser needs no key this
  feature), `BUDI_KEY`, `PAKHAJI_KEY`, `SITI_KEY`, `WATI_KEY`, `MILL_KEY`
  (channel signer — its derived address is the registered pubkey), plus non-secret
  `RPC_URL`, `AUSD_ADDRESS` (optional), `EXPLORER_API_KEY` (optional),
  `DEMO_GAP_SECONDS` (default 60), `SEED_AUSD_MIN` (default 14000e6),
  `MON_TOPUP_OPERATOR`/`MON_TOPUP_PERSONA` (defaults in D13). Names+comments only in
  `contracts/script/env.example` — **undotted**, because `.env*` is gitignored and a
  dotted example would be silently uncommittable. Scripts preflight: any missing
  var → abort naming the variable, never a value; keys are never logged; public
  addresses only go to `contracts/script/DEMO-ACCOUNTS.md`. Gate: quickstart §7
  greps the diff for key patterns (SC-004).
- **Rationale**: spec FR-005 + constitution X; the gitignore interaction is a real
  trap caught during research (`.env.*` matches `.env.example`).
- **Alternatives**: `cast wallet` keystore accounts (fine for humans, awkward in
  CI/scripts; supported implicitly since keys can be swapped for `--account`).

## D10 — Manual loop helpers (PLAN Day-4 done-when, cast-only)

- **Decision**: `MANUAL-LOOP.md` walks the throwaway ISA draft → activate →
  receiveIncome → CompletedCapped using `cast send` with explicit `--gas-limit`
  values, plus two NON-broadcasting signer helpers (they only `console.log`
  signatures; no txs): `SignPermit.s.sol` (ERC-2612 over the asset's domain — chain
  10143) and `SignIncome.s.sol` (EIP-712 `IncomeEvent` over KiteCore's domain,
  signed with `MILL_KEY`). The runbook asserts the final `CompletedCapped`/remaining-0
  reads and collects tx hashes for the explorer (SC-002).
- **Rationale**: PLAN's done-when says "manual loop via cast"; EIP-712 signatures
  cannot be produced by bare `cast` one-liners, so the helpers keep the loop manual
  without fake shortcuts — and they double as the demo-day signing reference.
- **Alternatives**: a fully scripted throwaway (rejected: the point is proving the
  loop works with bare tools); printing signatures by hand from a notebook
  (rejected: error-prone).

## D11 — Verification fallback procedure

- **Decision**: `--verify` rides the deploy script; if Monadscan rejects (key
  required/none, API down, opcode-length mismatch), run `forge verify-contract
  --watch` per contract with the same verifier URL; final report lists any unverified
  contract loudly and the feature's SC-003 stays open until green. A Monadscan API
  key, if the user has one, is `EXPLORER_API_KEY`; otherwise the Etherscan-compatible
  endpoint commonly accepts placeholder keys — attempt, observe, record honestly.
- **Rationale**: spec FR-004/edge case; verification outages are explorer-side and
  must never block the on-chain work, only the done-gate.
- **Alternatives**: declaring verification best-effort with no gate (rejected:
  §14 checklist row and constitution VIII).

## D12 — PLAN amendment: exact wording, landing FIRST (rule F1)

- **Decision**: task #1 of implementation commits the PLAN amendment before any
  contract file is touched. Three edits:
  1. **§6.2**, after the existing 2026-10-10 clarification blockquote, append a
     blockquote: "**Clarification (2026-10-10, approved at Feature 004 specify —
     Q1/A; not a silent deviation:**) `MIN_EVENT_GAP` is set at `initialize()` as a
     governed parameter (no setter — init-once, like the asset). Protocol value
     **60 days**; the Monad-testnet demo deployment uses **60 seconds** so the §6.3
     seeded states are producible inside the hackathon window (they need ≥ ~120 days
     at 60 days — two sequential ISAs × one gap). Testnet→production note, precedent
     Matocard `minCycleDuration`: a production deployment passes 60 days and the
     anti-farming property is unchanged. Unit/literal tests keep 60 days; the demo
     value is disclosed in TRUST.md, `packages/contracts` addresses, and judge
     instructions. `KiteScoring` stays pure — the gap is an argument, not state."
  2. **§12 Day 4** row, append: "(demo deployment sets `MIN_EVENT_GAP` 60 s —
     compressed-gap seed, disclosed; PLAN §6.2 clarification)".
  3. **§3 step 6**, replace the "(prepared state)" prefix with "(live)": with the
     demo's compressed gap, panen 2 and panen 3 execute live on camera — the 🎉 and
     58 → 91 happen in real transactions. Step 7 (failed harvest) keeps its
     prepared-state label; a zero-gross event is also instantly demonstrable live.
- **Rationale**: CLAUDE.md ("PLAN wins — propose a PLAN change first, never deviate
  silently") + user fold-in #4/#5; the D4/D7 precedent blockquote from Feature 003 is
  the established format.
- **Alternatives**: bundling the PLAN edit with the code commit (rejected: rule F1
  says FIRST, and the ordering is the whole point).

## D13 — Deployment economics (MON amounts)

- **Decision**: defaults `MON_TOPUP_OPERATOR = 1 MON` (relayer, orchestrator),
  `MON_TOPUP_PERSONA = 0.3 MON` (Budi/Pak Haji/Siti/Wati + throwaway wallets), all
  env-tunable; deployer keeps ≥ 2 MON. Rationale: at ~100 gwei base fee a 300k-gas
  tx costs ~0.03 MON — the defaults fund dozens of txs each; faucet amounts are
  undocumented, so the preflight checks the deployer's MON balance ≥ a stated
  minimum (0.5 MON) with a clear message.
- **Alternatives**: exact-change funding (rejected: brittle against fee drift).

## D14 — Real-AUSD evolution path (unchanged, recorded)

- **Decision**: If the preflight fails at deploy time, MockAUSD is deployed and
  `ausdIsMock: true` is published — the app never branches (D11-design in 003 made
  the interfaces identical). A later real-asset migration is a redeploy of the proxy
  (asset immutable at init; PLAN Q1's fallback note), not a swap. If the user's
  faucet attempt on Monad succeeds (try `requestFunds(deployer)` on
  `0xd236…ee6C` — documented on Sepolia at 10,000 AUSD/call, undocumented on
  Monad — twice would clear the 14,000 bar), the same scripts re-run against the
  real asset with `AUSD_ADDRESS` set.
- **Rationale**: keeps Q2/C honest in both directions without new code paths.

---

## Needs-clarification residue

None. Q1/A and Q2/C were answered by the user at specify; every Technical Context
unknown is resolved above (D1–D14). The only runtime unknowns left (Monadscan key
leniency, Monad-side AUSD faucet behavior) are handled by explicit probe-or-abort
procedures, never by assumptions.
