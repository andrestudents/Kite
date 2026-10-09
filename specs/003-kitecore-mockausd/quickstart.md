# Quickstart: KiteCore Settlement Contract + MockAUSD

**Feature**: 003-kitecore-mockausd · **Gates**: spec SC-001..SC-006 · **Test
contract**: [contracts/kitecore-api.md](contracts/kitecore-api.md) (84 names,
contractual)

Every scenario below is runnable unaided from a fresh clone (constitution IX).
Commands run from the **repo root**; `--root contracts` follows forge 1.5.1 syntax
(flag AFTER the subcommand). `--match-test` patterns are substring regexes.

## §0 Prerequisites

- Foundry (`foundryup`); `forge --version` ≥ 1.x. `contracts/lib/` ships forge-std
  AND the two pinned OpenZeppelin 5.x checkouts — no install step after clone.
- §1–§4 need nothing else. §5 additionally needs Python 3 + pip
  (`sudo apt install -y python3-pip` if absent). §6 needs bun 1.4.x.

## §1 Compile gate

```sh
forge build --root contracts
```

**Expected**: exit 0, `Compiler run successful`, artifacts for `KiteCore.sol`,
`MockAUSD.sol`, and the five `src/modules/*.sol` (solc 0.8.36).

## §2 Full suite green — the "Done when" core

```sh
forge test --root contracts
```

**Expected**: `Suite result: ok. 84 passed; 0 failed; 0 skipped` across three
contracts: `MockAUSDTest` (10), `KiteCoreTest` (62), `KiteCoreInvariants` (12).
Any failure fails the feature (SC-006).

## §3 Constitution IX — the §6.3 literal gate through the real path

```sh
forge test --root contracts --match-test testLiteral_
```

**Expected**: `ok. 12 passed` across TWO suites — `KiteScoringTest` also has 6
`testLiteral_` names (Feature 002 regression, they ride along in this filter),
and `KiteCoreTest` must show exactly these 6 (the PLAN §6.3 demo tables,
onchain end-to-end):

```text
[PASS] testLiteral_Demo_Activation_600Out_600In_Remaining780()
[PASS] testLiteral_Demo_Panen1_Back300_Seeker1200_Remaining480()
[PASS] testLiteral_Demo_Panen2_Back300_Seeker1200_Remaining180()
[PASS] testLiteral_Demo_Panen3_Back180_Seeker1320_CompletedCapped()
[PASS] testLiteral_Demo_Reputation_58During_91AtFinish()
[PASS] testLiteral_Cap_Formula_PrincipalTimesCapMultOver100()
```

During TDD RED (before T010–T014 land) KiteCoreTest instead reports
`[FAIL: EvmError: Revert] setUp()` — the fixture's bindIdentity/registerChannel
calls hit the reverting stubs; that IS the expected pre-implementation state.

Hand-check any row against PLAN §6.3 (600/780; 300/1200 ×2; 180/1320; 58→91) —
they must agree exactly.

## §4 Tier gates — every §6.4 invariant and role/pause/reentrancy/upgrade obligation

```sh
forge test --root contracts --match-test invariant_
```

**Expected**: `ok. 12 passed` — one per PLAN §6.4 item, numbered
`invariant_01_…` … `invariant_12_…` (mapping table in
[kitecore-api.md](contracts/kitecore-api.md)). This is SC-002.

```sh
forge test --root contracts --match-test testRole_     # 6 passed (§6.2 confinement, SC-003)
forge test --root contracts --match-test testPause_    # 5 passed (asymmetry, SC-004)
forge test --root contracts --match-test testReentrancy_  # 2 passed
forge test --root contracts --match-test testBoundary_    # 39 passed
forge test --root contracts --match-test testMock_        # 10 passed
forge test --root contracts --match-test testUpgrade_     # 3 passed
forge test --root contracts --match-test testInitialize_  # 1 passed
```

## §5 Static analysis + gas artifacts

```sh
pip3 install --user slither-analyzer
solc-select install 0.8.36 && solc-select use 0.8.36   # matches forge's solc
slither contracts/                                     # may need ~/.local/bin on PATH
```

**Expected**: analysis completes; **every** detector finding has a row in
`contracts/SLITHER.md` with disposition `fixed` or `justified` — **0 untriaged**
(SC-005). If installation genuinely fails, SLITHER.md must contain the attempted
commands + output; the gate stays open and the feature is NOT done.

```sh
forge snapshot --root contracts
```

**Expected**: `contracts/.gas-snapshot` exists, is committed, and is unchanged by a
re-run on a clean tree (diff after re-run = empty). The published limits live at
`packages/contracts/src/gasLimits.ts` — typed constants whose header says
`LOCAL-EVM BASELINE — recalibrate on Monad at deploy` (SC-006).

## §6 No regressions to the Feature-001/002 gates

```sh
bun run health && bun run build
```

**Expected**: `9/9 workspaces ok` (exit 0) and the full pipeline green (turbo +
`forge build --root contracts`).

## What is NOT validated here

- Monad-testnet deployment and seeded demo state (next feature, PLAN §12 Day 4).
- Real-AUSD signature compatibility beyond the mirrored "AUSD"/"1" domain (swap-day
  check, research D12).
- Relayer/backend/indexer behavior (later features).
