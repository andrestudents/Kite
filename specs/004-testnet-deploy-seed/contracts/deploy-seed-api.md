# Contract API: Deployment + Seed (Feature 004)

The interface contract of this feature is the **script/publish/runbook surface**, not
new Solidity API (the only contract-interface change is one appended parameter,
below). Test names remain contractual (Feature-002/003 convention): quickstart counts
and tasks gates reference them verbatim. Suite after this feature = **108 tests**
(10 MockAUSD + 21 KiteScoring + 65 KiteCore + 12 invariants). All money literals are
AUSD base units (6 dp). Sources cite PLAN §11.1/§11.3/§6.2/§12 Day-4.

---

## Contract-interface delta (research D3)

```solidity
// KiteCore — one appended parameter (sixth), everything else unchanged (003 API):
function initialize(address admin, address relayer, address orchestrator,
                    address pauser, address ausdToken, uint256 minEventGapSec)
function minEventGap() view returns (uint256)   // NEW — disclosure + seed asserts

// KiteScoring — stays pure; constant becomes an argument (5th):
function isQualifyingEvent(uint256 lastEventAt, uint256 at, uint256 gross,
                           uint256 principal, uint256 minGap) pure returns (bool)
```

No new privileged functions. No setter for `minEventGap` (init-once, like the asset).

## New contractual test names (the 104 → 108 delta)

```text
KiteScoringTest:      testGap_ArgumentControlsQualifyingWindow
KiteCoreTest:         testInitialize_SetsRolesAssetAndGap            (updated in place)
KiteCoreTest:         testGap_MinEventGap_SetAtInit_NoSetter
KiteCoreTest:         testGap_Qualifying_At60Seconds_DemoDeployment
KiteCoreTest:         testGap_NonQualifying_At59Seconds_DemoDeployment
```

Count check: 20+1 KiteScoring = 21 · 62+3 KiteCore = 65 · MockAUSD 10 · invariants 12
(untouched — handler still initializes at 60 days) = **108**.

## Script CLI contract

All invocations from repo root; forge 1.5.x flag order (flags after subcommand).
Env per the matrix in [../data-model.md](../data-model.md); `env.example` documents
names only.

**Deploy** (spec FR-001..FR-007):

```sh
forge script contracts/script/DeployKiteCore.s.sol --root contracts \
  --rpc-url "$RPC_URL" --broadcast --slow -g 115 \
  --verify --verifier etherscan --verifier-url https://api-testnet.monadscan.com/api
```

Behavior, in order: preflight (chain 10143 · required env present by name · deployer
MON ≥ 0.5e18 · if `AUSD_ADDRESS` set: code + `decimals()==6` + balance ≥
`SEED_AUSD_MIN`, else deploy MockAUSD) → deploy impl → deploy ERC-1967 proxy with
`initialize(admin, relayer, orchestrator, pauser, ausd, DEMO_GAP_SECONDS)` →
assert roles/channel on-chain (`registerChannel(1, MILL_CHANNEL_NAME, mill)`) →
print manifest (all addresses + explorer URLs) → verify. Exit non-zero naming the
first failed probe; verification failure lists loudly and exits non-zero (gate stays
open, research D11).

**Seed** (spec FR-008..FR-012) — never run stages out of order; the driver owns timing:

```sh
bash contracts/script/seed-demo.sh          # = stage1 → (sleep gap+10s → stage2..5), one qualifying event per stage
# each stage, equivalently:
SEED_STAGE=1 forge script contracts/script/SeedDemo.s.sol --root contracts \
  --rpc-url "$RPC_URL" --broadcast --slow -g 115
```

Stage contents and skip-idempotency per the stage machine in
[../data-model.md](../data-model.md). Stage 5 prints the assert block results
(expected vs observed per FR-012) and the persona manifest for `DEMO-ACCOUNTS.md`.
The driver prints computed wall-clock duration first (four sleeps ≈ 5 min at 60 s —
one before each qualifying event after E1, per the per-event gap rule) and refuses
a `DEMO_GAP_SECONDS` of 0.

**Runbook helpers** (no broadcast — they only print signatures; research D10):

```sh
forge script contracts/script/SignPermit.s.sol --root contracts   # prints v,r,s over the asset domain (chain 10143)
forge script contracts/script/SignIncome.s.sol --root contracts   # prints v,r,s over KiteCore's IncomeEvent domain
```

**Manual loop** — `contracts/script/MANUAL-LOOP.md` walks, with `cast` only:
draft → `SignPermit` → `cast send activateWithPermit --gas-limit <published>` →
`SignIncome` → `cast send receiveIncome --gas-limit <published>` → cap-out event →
final reads (`status == 3 CompletedCapped`, `remaining == 0`) → collect explorer
hashes. Throwaway personas funded by stage-1's persona top-ups.

## Published-artifact contract (`packages/contracts`)

```ts
// src/addresses.ts — written once per deployment from the manifest
export const KITE_DEPLOYMENT = {
  chainId: 10143, network: "Monad Testnet",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorerBaseUrl: "https://testnet.monadscan.com",
  kiteCore: "0x…", kiteCoreImpl: "0x…",
  ausd: "0x…", ausdIsMock: true,
  channelId: 1n, minEventGapSec: 60,
  deployedAt: 0,
} as const;

// src/abis/*.abi.json — generated:  bun run gen:abis  (= forge inspect <C> abi)
// src/index.ts:  + export * from "./addresses.js";  + export * as abis …
// src/gasLimits.ts — recalibrated: observedMax from Monad receipts,
//                    fixedLimit = ceil(observedMax × 1.25/1000) × 1000,
//                    header "MONAD TESTNET MEASURED (chain 10143, <date>)"
```

`package.json` gains `"gen:abis"`. Consumers never need forge; the generated files
are committed (research D8).

## Failure/abort surface (preflight and asserts — every message names causes, never values)

| Abort | Trigger |
|---|---|
| `EnvMissing(<NAME>)` | any required variable empty |
| `WrongChain(<got>, want 10143)` | `block.chainid != 10143` |
| `DeployerUnderfunded` | MON < 0.5e18 |
| `AssetNotERC20 / AssetDecimals(<got>, want 6)` | real-asset probe failed |
| `AssetFundingShort(<balance>, need SEED_AUSD_MIN)` | sufficiency probe failed |
| `AlreadyInitialized` | re-run pointed at an existing proxy |
| `SeedAssert(<what>, expected, observed)` | any stage-5 literal mismatch |
| `VerificationIncomplete(<contracts>)` | explorer verification unresolved |

## What this interface deliberately does NOT add

No admin seed/state-write functions (constitution IV — the seed uses only the public
003 API), no `setMinEventGap` (no new privileged surface), no backend/indexer hooks,
no mainnet paths.
