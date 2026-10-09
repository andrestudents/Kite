# Data Model: KiteScoring Library + Split Math

**Feature**: 002-kite-scoring-math · **Source**: spec.md FR-001..FR-004, PLAN §6.2–§6.3

This feature is a pure library: **no entity is stored**. Every entity below is either an
input value type (Profile), a derived value (Score, Offer, Split, QualifyingDecision),
or a named constant. Storage, counters, and their lifecycle belong to the future
KiteCore modules (PLAN §6.2); this library only defines the shapes and the arithmetic.

## Entities

### Profile (input value type — PLAN §6.2)

A seeker's reputation counters. Defined once inside `KiteScoring` and imported by
future modules (research.md D3).

| Field | Type | Meaning | Constraint |
|---|---|---|---|
| `totalISAs` | `uint64` | Deals ever drafted-and-activated for this seeker | ≥ `completed` (ledger-guaranteed; library trusts, does not re-validate — spec Assumption) |
| `completed` | `uint64` | Deals finished (capped or term-forgiven) | ≤ `totalISAs`; drives History |
| `qualEvents` | `uint64` | Lifetime qualifying income events | drives Consistency (saturates at 12) and Volume (saturates at 6) |
| `distinctBackers` | `uint64` | Distinct backers with ≥ 1 completed deal | `< 2` → History capped at 13 (anti-self-dealing, PLAN §6.3) |

**Validation rules** (enforced upstream, trusted here): non-negative by type;
`completed ≤ totalISAs`. Out-of-contract inputs produce out-of-contract results
(defined behavior, no clamping — research.md D7).

**Relationships**: many-to-one with the future onchain `mapping(address => Profile)`
(PLAN §6.2); read-only input to `score`.

### Score (derived value)

| Component | Formula (PLAN §6.3) | Range |
|---|---|---|
| History | `⌊40 × completed × min(totalISAs,3) ÷ (totalISAs × 3)⌋`; `0` if `totalISAs = 0`; cap `13` if `distinctBackers < 2` | [0, 40] |
| Consistency | `⌊20 × min(qualEvents,12) ÷ 12⌋` | [0, 20] |
| Volume | `⌊40 × min(qualEvents,6) ÷ 6⌋` | [0, 40] |
| **Score** | sum, returned as `uint8` | **[0, 100]** |

Integer floor per component; no rounding anywhere else (constitution VI).

### Offer (derived value)

`maxP = BASE_MAX_P × (100 + 2 × score) ÷ 100`, with `BASE_MAX_P = 600e6` (600 AUSD in
base units, 6 dp). Range: 600e6 (score 0) … 1800e6 (score 100). Share guidance
(`2000 − 8 × score` bps) is UI-only and NOT part of this entity (spec FR-009).

### Split (derived value)

Inputs: `gross`, `shareBps`, `remaining` (all `uint256`, AUSD base units / bps).

| Output | Rule | Invariant |
|---|---|---|
| `toBacker` | `min(⌊gross × shareBps ÷ 10000⌋, remaining)` | `toBacker ≤ remaining` — always |
| `toSeeker` | `gross − toBacker` | `toBacker + toSeeker == gross` — exactly (constitution III / PLAN §6.4 invariant 1) |

`remaining` semantics (PLAN §6.2): the AUSD left of the cap, where
`cap = principal × capMult ÷ 100`; it starts at the cap and decreases by each
divert. Computing the cap itself belongs to the ISA module — this library receives
`remaining` as a value.

### QualifyingDecision (derived value, boolean)

True **iff both** bars pass (PLAN §6.3, §6.2 parameters):

| Bar | Predicate | Constant |
|---|---|---|
| Gap | `lastEventAt == 0 ∨ lastEventAt + MIN_EVENT_GAP ≤ now` | `MIN_EVENT_GAP = 60 days = 5_184_000 s` |
| Size | `gross × 10000 ≥ principal × MIN_EVENT_BPS` | `MIN_EVENT_BPS = 1000` (≥ 10% of principal) |

Clock inversion (`lastEventAt > now`) → false, never a revert (research.md D6).

## Named constants (library-owned — PLAN §6.2 testnet parameters)

| Constant | Value | Used by |
|---|---|---|
| `BASE_MAX_P` | `600e6` (600 AUSD) | offerOf |
| `MIN_EVENT_GAP` | `60 days` (5,184,000 s) | isQualifyingEvent |
| `MIN_EVENT_BPS` | `1000` (10%) | isQualifyingEvent |

Immutability is deliberate (constitution II — fairness is physics; research.md D4).

## State transitions

None. Every entity above is a value; no storage, no lifecycle, no events
(spec FR-005/FR-009). The lifecycle of Profiles and `remaining` lives in the future
KiteCore modules and is out of scope here.
