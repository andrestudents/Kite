# Feature Specification: KiteScoring Library + Split Math

**Feature Branch**: `002-kite-scoring-math`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "Feature 002 — KiteScoring library + split math. Pure functions, no storage, no proxy. Source of truth: PLAN.md §6.3 (formulas AND the literal demo tables) and §6.2 (Terms / remaining semantics). Deliverable: contracts/src/KiteScoring.sol with pure functions: score(Profile), offerOf(score), divert(gross, shareBps, remaining), isQualifyingEvent(lastEventAt, now, gross, principal). Acceptance tests: the §6.3 demo tables pass as LITERAL test cases. Boundary cases: cap reached exactly, gross below 10%, gap < 60 days, zero values. Done when: forge test green, including every literal number above."

**Implements**: PLAN §6.3 (score formula, offer, demo tables), §6.2 (Profile struct, `remaining` semantics, testnet parameters), §6.4 invariants 1 and 8 (split conservation; qualifying bars), §12 Day 2–3. Constitution IX (the §6.3 literal numbers are acceptance tests), VI (integer money).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The plan's demo numbers ARE the contract's numbers (Priority: P1)

Anyone — a judge, a backer, a developer — can take the worked examples in PLAN §6.3 and reproduce every number by hand and by an automated check. The reputation score (0–100) and the maximum supportable amount are pure integer arithmetic over four counters (total deals, completed deals, qualifying events, distinct backers), with each component floored to a whole number. The three states of the demo — new account (score 0, offer 600 AUSD), Budi prepared (score 58, offer 1,296 AUSD), after the demo deal completes (score 91, offer 1,692 AUSD) — must come out of the computation exactly as printed in the plan.

**Why this priority**: Constitution IX makes the §6.3 literal numbers an acceptance gate. Every later feature (offers, deal bounds, profiles) is built on this arithmetic; nothing advances while these numbers can mismatch. The plan's pitch ("hand-checkable, exactly like the demo tables") depends on it.

**Independent Test**: Run the feature's acceptance suite — every §6.3 table row is asserted as a literal number. No other feature is needed to verify this.

**Acceptance Scenarios**:

1. **Given** an empty reputation record (0 deals, 0 completed, 0 qualifying events, 0 backers), **When** the score and offer are computed, **Then** the score is 0 and the maximum support is 600 AUSD.
2. **Given** the prepared-Budi record {totalISAs 2, completed 2, qualEvents 4, distinctBackers 2}, **When** the score is computed, **Then** History = 26, Consistency = 6, Volume = 26, score = 58, and the offer is 1,296 AUSD.
3. **Given** the record after the demo deal completes {3, 3, 7, 3}, **When** the score is computed, **Then** History = 40, Consistency = 11, Volume = 40, score = 91, and the offer is 1,692 AUSD.
4. **Given** an otherwise perfect record backed by a single backer {3, 3, 7, 1}, **When** the score is computed, **Then** History is capped at 13 and the score is 64 — one backer can never fund a full record (anti-self-dealing, PLAN §6.3).

### User Story 2 - The split is exact and ends exactly at the cap (Priority: P2)

When harvest income arrives, the backer's share and the seeker's share are decided by one deterministic rule, computable before the transaction is sent: the backer gets the smaller of (the share slice of the gross) and (the amount remaining of the cap); the seeker gets the rest of the gross, always. The demo ISA (principal 600 AUSD, share 20%, cap 780 AUSD) must split its three harvests exactly as the §6.3 table prints: 300/1,200, 300/1,200, and finally 180/1,320 — the last one reaching the cap precisely, with not one base unit diverted beyond it.

**Why this priority**: Constitution III (exact conservation: backer + seeker = gross, diverted ≤ remaining) and IX (the split table is a literal gate). The finish line — the deal ending forever, exactly at the cap — is the business model made visible.

**Independent Test**: Run the split-rule acceptance cases — both demo rows plus the exact-cap boundary — standalone. Nothing about scoring is needed to verify this.

**Acceptance Scenarios**:

1. **Given** gross 1,500 AUSD, share 20%, remaining cap 780 AUSD, **When** the split is computed, **Then** the backer receives 300 and the seeker 1,200.
2. **Given** gross 1,500 AUSD, share 20%, remaining 180 AUSD, **When** the split is computed, **Then** the backer receives 180 (cap reached) and the seeker 1,320.
3. **Given** remaining exactly equal to the share slice (gross 1,500, share 20%, remaining 300), **When** the split is computed, **Then** the backer receives 300 and the seeker 1,200 — the cap is reached exactly, never exceeded.

### User Story 3 - Only real seasons count toward reputation (Priority: P3)

An income event raises the reputation counters only when it is a *qualifying event*: it happens at least 60 days after the previous qualifying event, and its gross is at least 10% of the deal's principal. A faster or smaller event still splits money normally — it just counts toward nothing. Event spam therefore cannot farm score (PLAN D9).

**Why this priority**: Protects the *meaning* of the score that US1 computes, but the score arithmetic itself is complete without it; the gate is a filter the settlement layer will apply later.

**Independent Test**: Run the gate's acceptance cases — short gap, small gross, and both exact boundaries (59 vs 60 days; 9.99% vs 10%) — standalone.

**Acceptance Scenarios**:

1. **Given** the previous qualifying event 59 days ago, **When** a new event is checked, **Then** it does not qualify.
2. **Given** the previous qualifying event exactly 60 days ago and gross ≥ 10% of principal, **When** checked, **Then** it qualifies (the bar is "≥", inclusive).
3. **Given** a long gap but gross of 9.99% of principal, **When** checked, **Then** it does not qualify.
4. **Given** a long gap and gross of exactly 10% of principal, **When** checked, **Then** it qualifies.

### Edge Cases

- **Cap already reached** (remaining = 0): the backer receives 0 and the seeker the whole gross — the split rule never pays out more than the cap, even when called on a finished deal (the settlement layer prevents this state from splitting; the math still stays safe).
- **Zero gross** (failed harvest): backer 0, seeker 0 — nothing is diverted; and the event never qualifies against any positive principal (PLAN D8: harvest fails → 0 taken).
- **Empty record division guard**: totalISAs = 0 must not divide by zero — History is defined as 0 (matches the §6.3 "New account" row).
- **Component saturation**: qualEvents beyond 12 (Consistency) and beyond 6 (Volume) add nothing — the score tops out at 100 with History 40 + Consistency 20 + Volume 40.
- **Score at the theoretical maximum 100**: the offer reaches 1,800 AUSD (base 600 × 300%).
- **First event ever** (no previous qualifying event, lastEventAt = 0): the gap condition is satisfied by definition — otherwise nothing could ever qualify.
- **Clock inversion** (lastEventAt later than now): the gap is negative → the event does not qualify.
- **Share slice vs cap ordering**: both orderings of `min()` must agree — when the slice is smaller (US2 scenario 1) and when the remaining is smaller (US2 scenario 2).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST compute the reputation score as History + Consistency + Volume, each component an integer floor of its exact rational value (PLAN §6.3):
  - History = ⌊40 × completed × min(totalISAs, 3) ÷ (totalISAs × 3)⌋, defined as 0 when totalISAs = 0; when distinctBackers < 2, History MUST additionally be capped at 13.
  - Consistency = ⌊20 × min(qualEvents, 12) ÷ 12⌋.
  - Volume = ⌊40 × min(qualEvents, 6) ÷ 6⌋.
  - The result MUST always lie in [0, 100].
- **FR-002**: The system MUST compute the offer as maxP = BASE_MAX_P × (100 + 2 × score) ÷ 100 in integer arithmetic, with BASE_MAX_P = 600 AUSD expressed in integer base units (6 decimals) (PLAN §6.3 formula, §6.2 parameters).
- **FR-003**: The system MUST compute the split as toBacker = min(⌊gross × shareBps ÷ 10000⌋, remaining) and toSeeker = gross − toBacker (PLAN §6.2 `receiveIncome`, §6.3 demo ISA table). Diverted MUST never exceed remaining, and toBacker + toSeeker MUST equal gross exactly, for every input (constitution III / §6.4 invariant).
- **FR-004**: The qualifying-event gate MUST return true if and only if BOTH: (a) now − lastEventAt ≥ 60 days (60 days = 5,184,000 seconds; lastEventAt = 0 satisfies the gap — first event), AND (b) gross ≥ principal × 1000 ÷ 10000 (≥ 10% of principal, MIN_EVENT_BPS) (PLAN §6.3 qualifying event, §6.2 parameters).
- **FR-005**: All four computations MUST be pure and deterministic: no stored state is read or written, nothing external is called, and identical inputs always produce identical outputs (PLAN §6.1: KiteScoring is a pure, hand-checkable library; no proxy, no storage).
- **FR-006**: Every monetary amount MUST be an integer in AUSD base units (6 decimals). Floating-point MUST NOT appear anywhere money is computed (constitution VI).
- **FR-007**: The PLAN §6.3 demo tables MUST pass as LITERAL acceptance cases — new account → score 0 / maxP 600; {2,2,4,2} → score 58 / maxP 1,296; {3,3,7,3} → score 91 / maxP 1,692; split(1500, 20%, 780) → 300/1,200; split(1500, 20%, 180) → 180/1,320 (constitution IX).
- **FR-008**: Boundary cases MUST pass: cap reached exactly (share slice == remaining), gross below 10% of principal, gap of 59 days vs 60 days, and zero values (gross 0, empty record, remaining 0).
- **FR-009**: Scope boundary — this feature MUST NOT introduce: stored state, upgradeability/proxy wiring, deal-bounds enforcement (PLAN D6 — later ISA-module feature), channel signatures or the replay registry, counter bookkeeping on settlement, or share guidance (2000 − 8 × score bps is UI-only, PLAN §6.3).

### Key Entities *(include if feature involves data)*

- **Reputation record (Profile)** — PLAN §6.2: four counters describing a seeker's history: totalISAs, completed, qualEvents, distinctBackers (incremented on the first completed deal per backer). Read-only input to the score.
- **Score** — integer 0–100, composed of History (max 40), Consistency (max 20), Volume (max 40); changes only on completion.
- **Offer (maxP)** — maximum supportable principal, in AUSD base units, derived from the score alone.
- **Split outcome** — the pair (toBacker, toSeeker) partitioning the gross exactly.
- **Qualifying event** — an income event passing the 60-day gap bar and the ≥10%-of-principal size bar; the only events that count toward score.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the PLAN §6.3 literal numbers (three score-table rows, two split-table rows) match the computed outputs exactly, verifiable by one command run unaided from a fresh clone.
- **SC-002**: Zero violations across the entire acceptance suite of the two conservation properties: diverted ≤ remaining, and backer + seeker = gross — including the exact-cap boundary case.
- **SC-003**: Zero cases in which a short-gap (< 60 days) or undersized (< 10% of principal) event passes the qualifying gate, and zero cases in which the score leaves [0, 100].
- **SC-004**: The full acceptance suite runs green in under one minute as part of the repository's standard test entry point.

## Assumptions

- Time is measured in whole seconds; "60 days" is fixed at exactly 5,184,000 seconds (no calendar arithmetic).
- BASE_MAX_P = 600 AUSD = 600,000,000 base units, per the §6.2 testnet parameters.
- lastEventAt = 0 means "no previous qualifying event" → the gap condition passes; the demo timeline depends on this for first seasons.
- Profile counters arrive already consistent from the ledger layer (completed ≤ totalISAs, all non-negative); this library does not re-validate them.
- shareBps arrives within the deal bounds [1000, 2000] from the caller layer; bounds enforcement is a later feature (PLAN D6), and the split formula itself is defined for any share value.
- Share guidance (2000 − 8 × score bps) is display-only and explicitly out of scope here.
- The deliverable is one pure onchain library artifact (`contracts/src/KiteScoring.sol`) plus its test file — no storage, no proxy — per the user description; exact internal structure is decided in the planning phase.
- Non-qualifying events still split money normally; that behaviour belongs to the settlement module (later feature) — only the gate predicate is specified here.
