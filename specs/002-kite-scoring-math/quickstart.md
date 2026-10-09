# Quickstart: KiteScoring Library + Split Math

**Feature**: 002-kite-scoring-math · **Gate**: spec SC-001..SC-004 · **Test contract**: [contracts/kite-scoring-api.md](contracts/kite-scoring-api.md)

Every scenario below is runnable unaided from a fresh clone (constitution IX).
All commands run from the **repo root**. `forge test --root contracts` = forge 1.5.1
syntax (flag after the subcommand).

## §0 Prerequisites

- Foundry installed (`foundryup`); `forge --version` prints ≥ 1.x.
- Repo cloned; nothing else needed — `contracts/lib/forge-std` is vendored, the
  library has **zero dependencies** (research.md D1). No `bun install` required for
  §1–§4 (only §5 touches the bun side).

## §1 Compile gate

```sh
forge build --root contracts
```

**Expected**: exit 0, `Compiler run successful`, artifacts for `KiteScoring.sol` (and
`Counter.sol` gone from `contracts/src/` — deleted per research.md D9).

## §2 Full suite green (the "Done when")

```sh
forge test --root contracts
```

**Expected** (test inventory = the contract in [kite-scoring-api.md](contracts/kite-scoring-api.md)):

```text
| Contract      | KiteScoringTest |
| Suite result: ok. 20 passed; 0 failed; 0 skipped
```

20 = 6 literal + 11 boundary + 3 fuzz. Any failure here fails the feature.

## §3 Constitution IX — the literal gate, tier by tier

```sh
forge test --root contracts --match-test testLiteral
```

**Expected**: `ok. 6 passed` — exactly these names:

```text
[PASS] testLiteral_Score_NewAccount_0_Offer600()
[PASS] testLiteral_Score_BudiPrepared_58_Offer1296()
[PASS] testLiteral_Score_AfterDemo_91_Offer1692()
[PASS] testLiteral_Score_SingleBacker_HistoryCap13_Score64()
[PASS] testLiteral_Divert_Panen1_300_1200()
[PASS] testLiteral_Divert_Panen3_CapReached_180_1320()
```

These six ARE the PLAN §6.3 demo tables: 0/58/91 → 600/1296/1692 and the splits
300/1200, 180/1320. Hand-check any row against PLAN §6.3 — they must agree.

```sh
forge test --root contracts --match-test testBoundary
```

**Expected**: `ok. 11 passed` — cap-reached-exactly, 59 vs 60 days, <10% vs =10%,
first event, clock inversion, zero gross, zero remaining, saturation, score-100 offer.

```sh
forge test --root contracts --match-test testFuzz
```

**Expected**: `ok. 3 passed` — score bounds for valid profiles; split conservation
(`toBacker ≤ remaining`, sum == gross); offer monotonicity.

## §4 Single-row spot check with detail

```sh
forge test --root contracts -vv --match-test testLiteral_Score_BudiPrepared_58_Offer1296
```

**Expected**: `[PASS]`, suite `ok. 1 passed` — the prepared-Budi row
(History 26 · Consistency 6 · Volume 26 → score 58 → maxP 1,296 AUSD).

## §5 No regressions to the Feature-001 gates

```sh
bun run health && bun run build
```

**Expected**: `9/9 workspaces ok` (exit 0) and the full build pipeline green
(turbo + `forge build --root contracts`). Proves the Counter deletion and the new
library broke nothing outside `contracts/`.

## What is NOT validated here

- Bounds enforcement (`shareBps ∈ [1000,2000]` etc.) — later ISA-module feature.
- `remaining` bookkeeping, replay guards, signatures — settlement module feature.
- Gas limits on Monad — begins with tx-bearing features (plan.md Technical Context).
