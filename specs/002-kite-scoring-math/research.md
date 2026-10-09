# Research: KiteScoring Library + Split Math

**Feature**: 002-kite-scoring-math · **Date**: 2026-10-09
**Input**: spec.md (all requirements resolved — no NEEDS CLARIFICATION markers existed) + user plan constraints: *Foundry only, pure Solidity, no OZ deps beyond math utils, natspec comments citing PLAN*.

All math below was hand-verified against PLAN §6.3 during specification:

- {2,2,4,2}: H=⌊40×2×2/6⌋=26 · C=⌊20×4/12⌋=6 · V=⌊40×4/6⌋=26 → **58** · maxP=600e6×216/100=**1296e6**
- {3,3,7,3}: H=40 · C=⌊140/12⌋=11 · V=40 → **91** · maxP=600e6×282/100=**1692e6**
- {3,3,7,1}: H capped 13 → 13+11+40=**64** (anti-self-dealing row)
- divert(1500e6, 2000, 780e6)=min(300e6,780e6)=**300e6**/1200e6 · divert(1500e6, 2000, 180e6)=**180e6**/1320e6

---

## D1 — Zero dependencies (not even OZ math utils)

**Decision**: `KiteScoring.sol` imports nothing. forge-std is test-only.

**Rationale**: The user constraint allows OZ *math utils*, but none are needed. Solidity ≥0.8 has checked arithmetic (reverts on overflow/underflow). The only theoretical overflow risk is History's numerator `40 × completed × min(totalISAs,3)`: with uint64 counters the worst case is 40 × (2⁶⁴−1)² ≈ 1.3×10⁴¹ ≪ 2²⁵⁶. `offerOf`'s worst product is 600e6 × 300 ≈ 1.8×10¹¹. `Math.mulDiv` would add a dependency to solve a problem that cannot occur. Zero deps also keeps fresh-clone builds offline-green (forge-std is vendored).

**Alternatives considered**: OZ `Math` (mulDiv/min) — rejected: native `x < y ? x : y` and checked `*`/`/` cover everything; a remapping + `forge install` for unused safety is complexity the PLAN doesn't ask for. Fixed-point libraries (PRBMath, Solady FixedPointMathLib) — rejected: PLAN §6.3 is integer floors by design (constitution VI); no fixed-point anywhere.

## D2 — `library` with `internal pure` functions (inlined, never deployed)

**Decision**: `library KiteScoring` whose four functions are `internal pure` — call sites get them inlined at compile time.

**Rationale**: PLAN §6.1 literally lists `KiteScoring (library)`. Internal-pure = zero bytecode overhead for future `KiteCore` modules, no deployment, no DELEGATECALL gas, and purity is compiler-enforced. It also lets future modules write `using KiteScoring for Profile;`.

**Alternatives considered**: Free functions in a file — works, but can't attach via `using…for`, and a struct + its arithmetic belong together. Abstract contract — invites inheritance misuse and storage-slot confusion with ERC-7201 modules. Deployed library with `external` functions — pays gas and adds a deployment artifact for math that must be hand-checkable inlined.

## D3 — `struct Profile` lives in the library, field-for-field per PLAN §6.2

**Decision**: `struct Profile { uint64 totalISAs; uint64 completed; uint64 qualEvents; uint64 distinctBackers; }` defined inside `KiteScoring`; future modules import it from there.

**Rationale**: One definition, no drift between library and KiteCore; field order and widths are exactly PLAN §6.2. Function names are exactly the user-specified four: `score`, `offerOf`, `divert`, `isQualifyingEvent` (KiteCore's later *view* wrappers `scoreOf`/`offerOf` in §6.2 are separate, and live in the module).

**Alternatives considered**: Separate `Types.sol` — one more file for 4 fields; premature until a second consumer exists. Defining the struct per-module — invites field drift, the exact bug §6.3 tests exist to catch.

## D4 — §6.2 parameters as library `constant`s

**Decision**: `uint256 internal constant BASE_MAX_P = 600e6; MIN_EVENT_GAP = 60 days; MIN_EVENT_BPS = 1000;` inside the library.

**Rationale**: `offerOf(score)` takes no parameter argument (user signature), so BASE_MAX_P must resolve inside the library; the event bars belong with the gate. Constitution II ("fairness is physics") favors immutability — these are physics, not policy. If the PLAN later wants them admin-tunable via `modules/Governed`, that is a PLAN change first (CLAUDE.md: never deviate silently).

**Alternatives considered**: Passing parameters as function args — breaks the specified signatures and spreads policy decisions to every caller. `immutable` contract-level values — meaningless for an inlined library.

## D5 — Parameter/return widths: `uint256` scalars, `uint8` score

**Decision**: All scalar parameters (`gross`, `shareBps`, `remaining`, `lastEventAt`, `now`, `principal`) are `uint256`; `score` returns `uint8`; `offerOf(uint8 score) returns (uint256)`; `divert` returns `(uint256 toBacker, uint256 toSeeker)`.

**Rationale**: `uint256` is the EVM's native word — internal functions pay nothing for width, and future callers holding `Terms.shareBps` (uint16) or `uint64` timestamps widen implicitly with no casts and no truncation bugs. Money must be `uint256` anyway (FR-006 base units). `uint8` for score matches the user signature and makes the [0,100] range self-documenting.

**Alternatives considered**: Mirroring §6.2 storage widths (uint16/uint64) in the API — forces casts at every call site for zero benefit in an inlined library.

## D6 — Underflow-safe gap check (clock inversion → false, never revert)

**Decision**: `isQualifyingEvent` checks the gap as `lastEventAt == 0 || lastEventAt + MIN_EVENT_GAP <= now` — addition and comparison only, never subtraction.

**Rationale**: The spec's edge case demands "lastEventAt later than now → does not qualify" (not a revert). A naive `now - lastEventAt >= GAP` would panic (0.8 underflow) exactly there. The additive form also gives `lastEventAt == 0` = "no previous event" for free (spec Assumption). With uint256, `lastEventAt + 5_184_000` cannot overflow.

**Alternatives considered**: `unchecked { now - lastEventAt }` with a `lastEventAt <= now` guard — equivalent, but two operations to reason about instead of one comparison chain.

## D7 — History's divide-by-zero guard; no clamping beyond the PLAN's own cap

**Decision**: `totalISAs == 0 → History = 0`. The only clamp in the library is the PLAN's own: History capped at 13 when `distinctBackers < 2`. No other clamping.

**Rationale**: The zero guard is forced by the §6.3 "New account" row (0/0/0/0 → score 0). Everything else is the formula verbatim. Under the documented input contract (`completed ≤ totalISAs`, spec Assumption), History ≤ 40, Consistency ≤ 20, Volume ≤ 40, so score ∈ [0,100] holds *mathematically* — FR-001 satisfied without a defensive clamp that would mask ledger bugs (a wrong clamp is worse than a loud wrong number: it would lie about a broken invariant).

**Alternatives considered**: Clamping score to [0,100] defensively — rejected: hides ledger corruption; the fuzz tests prove the bound for valid inputs instead.

## D8 — Test design: literal → boundary → stateless fuzz, one file

**Decision**: `contracts/test/KiteScoring.t.sol` (forge-std `Test`), three tiers — exact names in [contracts/kite-scoring-api.md](contracts/kite-scoring-api.md):
1. **Literal** (constitution IX): the three §6.3 score rows with per-component assertions, the single-backer 13-cap row, both divert rows.
2. **Boundary**: cap reached exactly, 59 vs 60 days, 9.99% vs exactly 10%, zero gross, zero remaining, empty profile, Consistency/Volume saturation (12/6), score 100 → offer 1800e6.
3. **Stateless fuzz** (`testFuzz_*`): score ∈ [0,100] and components ≤ their maxima for valid random profiles; divert conservation (`toBacker ≤ remaining`, `toBacker + toSeeker == gross`) for arbitrary uint256 inputs.

**Rationale**: The literal tier is the gate the PLAN demands; fuzz adds property confidence for free where the function is pure (no handler machinery needed — Foundry fuzzer calls the test directly). Re-deriving the same formula in the test to compare against itself would be tautological, so fuzz asserts *properties* (bounds, conservation, monotonicity), not re-implementation.

**Alternatives considered**: Formal proofs (Halmos/Kontrol) — overkill for 4 pure functions in a hackathon window; Echidna-style property runners — redundant, Foundry's built-in fuzzer covers stateless properties; invariant/handler suites — apply to stateful KiteCore (§6.4), not here.

## D9 — Delete the forge-init placeholder Counter

**Decision**: Remove `contracts/src/Counter.sol` and `contracts/test/Counter.t.sol` in this feature.

**Rationale**: PLAN §6.1 lists exactly KiteCore, its modules, KiteScoring, MockAUSD. Counter is scaffolding noise from `forge init`; leaving it means shipping dead code in a repo judges read, and its test pretends to test something. The tree after this feature = exactly the PLAN §6.1 items built so far.

**Alternatives considered**: Keep until KiteCore lands — rejected: every day it lives it's a lie in the inventory.

## D10 — NatSpec citing PLAN on every symbol

**Decision**: `/// @notice` on the library and each function, each citing its PLAN section (`§6.3` formulas, `§6.2` parameters/struct), with `@param` units (AUSD base units / bps / seconds) and `@return` semantics; formulas written out in the notice so `forge doc` output is hand-checkable against the PLAN.

**Rationale**: Explicit user requirement for this feature; also constitution IV — the math must be recomputable *and* auditable by anyone reading the code or generated docs.

**Alternatives considered**: Plain `//` comments — lose `forge doc`; citing only §6.3 — the parameters and struct belong to §6.2, cite both.

---

## NEEDS CLARIFICATION resolution

None existed entering Phase 0 (spec passed `/speckit-clarify` with zero questions). Every choice above is an implementation decision within the frozen PLAN + user constraints — none requires a PLAN change.
