# Data Model: KiteCore Settlement Contract + MockAUSD (Feature 003)

**Source**: spec.md Key Entities + FR-001..FR-019 · PLAN §6.2 (state, verbatim
structure) · research.md D3 (storage ownership), D4 (directed drafts), D6 (signature
payload), D8 (completion-only profile updates). Money is integers in AUSD base units
(6 decimals) everywhere (constitution VI).

All state lives onchain inside KiteCore's ERC-7201 namespaced modules; the contract
is the only authority (constitution IV). `KiteScoring.Profile` (Feature 002 library)
is reused verbatim as the stored profile shape.

## Entities

### Terms (value type, immutable once drafted — PLAN §6.2)

| Field | Type | Validation (at `createISADraft`, spec FR-005) |
|---|---|---|
| principal | uint256 | > 0 and ≤ `offerOf(seeker).maxP` (score-derived, §6.3) |
| shareBps | uint16 | ∈ [1000, 2000] (10–20%), inclusive |
| capMult | uint16 | ∈ [120, 150] (1.2–1.5×), inclusive |
| termEnd | uint64 | > now and ≤ now + 24 months (inclusive at exactly 24 mo) |
| channelId | uint64 | channel exists (registered) |

Cap formula: `cap = principal × capMult / 100` — computed once at draft and stored as
`ISA.remaining` (integer, floor). Example (§6.3 demo): 600e6 × 130 / 100 = 780e6.

### ISA (per deal — PLAN §6.2 struct, field-for-field)

| Field | Type | Rules |
|---|---|---|
| terms | Terms | immutable after draft |
| seeker | address | identity-bound at draft; the drafter |
| backer | address | named at draft (directed offer, research D4); must be identity-bound |
| remaining | uint256 | = cap at draft; decreases by exactly the backer leg of each settlement |
| activatedAt | uint64 | 0 while Drafted; set at activation |
| lastEventAt | uint64 | timestamp of last QUALIFYING event (0 = none yet) |
| eventCount | uint64 | qualifying events only (§6.3 bars) |
| status | uint8 | 0 None · 1 Drafted · 2 Active · 3 CompletedCapped · 4 CompletedAtTerm · 5 Cancelled |

Identity: `isaId` = sequential `nextIsaId` counter starting at 1 (0 never a valid id).

**State transitions** (spec FR-005..FR-013; §6.4 #4 terminality):

```text
(draft)  createISADraft ─────────────► DRAFTED ──cancelDraft(seeker|backer)──► CANCELLED ✝
                                        │  ▲
                       activateWithPermit│  │(only while Drafted; permit owner == backer)
                       (permit→pull P→pay P│  │ ; sets activeISA[seeker])
                                        ▼  │(no return path)
                                      ACTIVE ──receiveIncome: remaining→0──► COMPLETED_CAPPED ✝
                                        │
                                        └─completeAtTerm(anyone, now≥termEnd)──► COMPLETED_AT_TERM ✝
                                           (remaining forgiven, never collectable)
```

- ✝ = terminal. No income settles on any terminal ISA (§6.4 #4); Completed* applies
  the profile bookkeeping of research D8 exactly once.
- `activeISA[seeker] = isaId` while Active; cleared on both terminal completions.
  A seeker with an Active ISA cannot draft (one active deal, MVP; unlimited Drafted).
- Active deals accept income only while `block.timestamp ≤ termEnd` (research D7).

### Profile (per seeker — `KiteScoring.Profile`, PLAN §6.2)

| Field | Type | Updates (ONLY at a completion — research D8, §6.4 #7) |
|---|---|---|
| totalISAs | uint64 | +1 at each completion |
| completed | uint64 | +1 at each completion |
| qualEvents | uint64 | + `isa.eventCount` at each completion |
| distinctBackers | uint64 | +1 iff first completion with that backer (`completedWithBacker[seeker][backer]`) |

Score/offer are NEVER stored — always recomputed via `KiteScoring.score /
offerOf` from this struct (constitution IV). `ScoreChanged(old, new)` emitted at each
completion (indexer feed).

### Channel (Identity module, spec FR-004)

| Field | Type | Rules |
|---|---|---|
| id | uint64 | caller-supplied (PLAN-literal signature); duplicate registration reverts |
| name | string | display label (e.g. the mill's name) |
| pubkey | address | EVM signing address; also the funding account (research D6) |
| active | bool | new drafts naming an inactive channel revert; existing deals run to term |

### Identity binding (Identity module, spec FR-003, PLAN D4)

- `identityOf: address → bytes32`, `walletOfIdentity: bytes32 → address` — mutual
  inverses over the bound set; one-to-one, immutable, both directions enforced
  (§6.4 #5). "Verified" seeker/backer = non-zero bound hash.

### Income-fact registry (Stream module, spec FR-009, PLAN D7)

- `eventHashes: bytes32 → bool` where
  `eventHash = keccak256(abi.encode(channelId, purchaseRef, gross, salt))`.
  True forever once settled — single use, ever (§6.4 #2).
- `settledRefs: uint64 → bytes32 → bool` (channel → purchaseRef): the same purchase
  reference cannot settle twice on its channel even under a fresh salt — §6.4 #2's
  "same purchaseRef twice" clause (a new salt mints a new eventHash, so the tuple
  guard alone cannot enforce it).
- The signed payload (EIP-712 `IncomeEvent`) additionally binds `isaId`
  (research D6): routing a genuine fact to the wrong deal is impossible.

### Roles (Governed module, spec FR-001)

- ADMIN = `DEFAULT_ADMIN_ROLE` (grants/revokes all; sole UUPS upgrade authority).
- RELAYER_ROLE → `bindIdentity`. ORCHESTRATOR_ROLE → `receiveIncome`,
  `completeAtTerm` is permissionless-but-orchestrator-listed, `flagMismatch`.
  PAUSER → `pause`/`unpause`.
- Role holders can NEVER move user funds beyond PLAN §6.2 functions (constitution
  Hard Constraint; §6.4 #12).
- Pause flag: `bool paused` — blocks ONLY draft/activate (research D10).

### MockAUSD authorization states (spec FR-018, research D12)

- ERC-2612: per-owner permit `nonces` (consumed by `permit`).
- ERC-3009: `used[authorizer][nonce]: bool`; authorization window
  `[validAfter, validBefore]`; signature by `from`. Single-use by nonce.

## Storage ownership (research D3 — ERC-7201 namespaces)

| Namespace | State |
|---|---|
| `kite.governed` | paused |
| `kite.identity` | identityOf, walletOfIdentity, channels, nextChannelId |
| `kite.isa` | isas, activeISA, profiles, completedWithBacker, nextIsaId |
| `kite.stream` | eventHashes |
| (OZ namespaced) | AccessControl roles, UUPS implementation slot, EIP-712 domain, reentrancy guard |

Namespaces are pairwise-distinct by construction; `testUpgrade_ModuleNamespaces_Distinct`
+ `testUpgrade_StateSurvives_V2` prove isolation (spec FR-017).

## Relationships

- ISA 1—1 Terms (embedded); ISA N—1 Channel (via `terms.channelId`);
  ISA N—1 seeker, N—1 named backer (both identity-bound addresses);
  Profile 1—1 seeker (aggregates that seeker's completed ISAs);
- EventHash entries reference (channel, isa) logically via the signed payload — no
  foreign key onchain; replay protection is global, not per-ISA.

## Volume assumptions

MVP/testnet: dozens of seekers/channels, hundreds of deals, thousands of income
facts — sequential uint64 counters cannot realistically overflow; no pagination or
indexing performed onchain (the Envio indexer is a projection, constitution IV).
