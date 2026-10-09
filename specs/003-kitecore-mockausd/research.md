# Research: KiteCore Settlement Contract + MockAUSD (Feature 003)

**Input**: spec.md FR-001..FR-024 · PLAN §6.1–§6.4 · constitution I–X
**Note**: `/speckit-clarify` was terminated early by the user (0 questions answered).
The five questions it had queued are resolved here as D4, D7, D9, D10, D13 — each
with the recommended default and explicit rationale, veto-able at review. Nothing
below deviates from PLAN silently; the two refinements PLAN's table does not spell
out (D4, D7) are flagged for a PLAN clarification note at merge time.

---

## D1 — OpenZeppelin 5.x in scope for this feature

- **Decision**: Use OZ 5.x: `AccessControlUpgradeable`, `UUPSUpgradeable`,
  `EIP712Upgradeable`, `PausableUpgradeable`, `ReentrancyGuardUpgradeable` in KiteCore
  modules; `ERC20` + `ERC20Permit` + hand-rolled ERC-3009 in MockAUSD (plain, not
  proxied); `ERC1967Proxy` for tests. Pin both `openzeppelin-contracts` and
  `openzeppelin-contracts-upgradeable` at the same latest 5.x tag via `forge install`.
- **Rationale**: Constitution Hard Constraints mandate "Foundry + Solidity 0.8.x +
  OpenZeppelin 5.x; UUPS + ERC-7201 modules". Feature 002's "zero OZ" rule was
  feature-local (pure math), not a project rule.
- **Alternatives**: hand-rolled roles/EIP-712/reentrancy guards (rejected: more code
  to audit, constitution names the stack).

## D2 — Module pattern: abstract contracts, one file per module

- **Decision**: `contracts/src/modules/{Governed,Identity,ISA,Stream,Completion}.sol`,
  each an `abstract contract` holding ONLY its ERC-7201 namespaced storage + internal
  functions; `contracts/src/KiteCore.sol` inherits all five and declares the external
  interface + initializer. Completion owns no storage (it transitions ISA-owned state
  and reuses ISA profile bookkeeping via internal functions).
- **Rationale**: PLAN §6.1 names exactly these modules; ERC-7201 namespacing lets one
  module change without shifting another's slots (spec FR-017).
- **Alternatives**: libraries with struct-passing (rejected: clunky for stateful
  modules); diamond facets (rejected: PLAN says one UUPS proxy, not diamond).

## D3 — Storage ownership map and status encoding

- **Decision**:
  - `Governed` namespace: role admin bookkeeping comes from OZ AccessControlUpgradeable
    (its own namespacing) + `bool paused`.
  - `Identity` namespace: `identityOf`, `walletOfIdentity`, `channels`.
  - `ISA` namespace: `isas`, `activeISA`, `profiles`, `completedWithBacker`
    (seeker→backer→bool, for distinctBackers), `nextIsaId`.
  - `Stream` namespace: `eventHashes`, `settledRefs` (channelId → purchaseRef →
    bool). Two guards because §6.4 #2 demands BOTH "a duplicate eventHash" and "the
    same purchaseRef twice" revert — a new salt mints a new eventHash, so tuple
    uniqueness alone cannot enforce the second clause.
  - Status as `uint8`: 0 None (non-existent id) · 1 Drafted · 2 Active ·
    3 CompletedCapped · 4 CompletedAtTerm · 5 Cancelled.
- **Rationale**: field-for-field PLAN §6.2; uint8 keeps `isaOf` self-describing
  (0 = never existed) and matches the §6.2 `uint8 status`.
- **Alternatives**: Solidity `enum` (equal storage, but PLAN literal says uint8 —
  keep PLAN literal).

## D4 — Drafts are directed offers (CLARIFY DEFERRED #1; PLAN-signature refinement)

- **Decision**: `createISADraft(Terms calldata terms, address backer)` — the draft
  names its intended backer, who must be identity-bound (D8 of PLAN). `cancelDraft`
  is callable by seeker OR named backer while Drafted (PLAN: "either party").
  `activateWithPermit` requires the permit owner == the named backer.
- **Rationale**: PLAN §6.2's ISA struct HAS a `backer` field and its `cancelDraft`
  row says "either party" — impossible unless the backer exists pre-activation.
  The demo flow (Pak Haji funds Budi's specific request) is directed.
- **Alternatives**: open drafts with backer assigned at activation (rejected:
  contradicts "either party" cancel; weaker fit to the demo).
- **PLAN note**: adds one parameter to PLAN's literal `createISADraft(terms)` —
  recorded as a PLAN clarification at merge, not a silent deviation. Same class of
  refinement, same obligation: `bindIdentity(address wallet, bytes32 identityHash)`
  — PLAN's one-arg form cannot say WHOSE identity the relayer attests (msg.sender is
  the relayer, not the user; users never pay gas, constitution I).

## D5 — activateWithPermit: permit → pull → pay, relayer-submittable

- **Decision**: `activateWithPermit(uint256 isaId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`:
  calls `AUSD.permit(backer, KiteCore, principal, deadline, v, r, s)`, then
  `transferFrom(backer, this, principal)`, then `transfer(seeker, principal)`, marks
  Active, sets `activeISA[seeker]`, emits `ISAActivated`. `msg.sender` is unrestricted
  (the backer's signature is the authorization — PLAN D11 "one relayer tx").
  `nonReentrant`. Reverts leave the deal Drafted (atomic — no partial state).
- **Rationale**: spec FR-006, constitution III (exact conservation).
- **Alternatives**: ERC-3009 `receiveWithAuthorization` for the pull (rejected:
  MockAUSD scope is transferWithAuthorization + permit per the user's description).

## D6 — Income leg: channel approval pull + EIP-712 signature binding the ISA

- **Decision**: The channel's registered pubkey address is also its funding account;
  it approves KiteCore once (demo setup). `receiveIncome` pulls `gross` via
  `transferFrom(channel, this, gross)` and splits in the same transaction
  (`KiteScoring.divert`). The channel signature is EIP-712 over
  `IncomeEvent{uint64 channelId; uint256 isaId; bytes32 purchaseRef; uint256 gross; bytes32 salt}`
  in KiteCore's domain ("KiteCore", "1"), recovered against `channels[channelId].pubkey`.
  The replay registry hash stays PLAN-literal:
  `eventHash = keccak256(abi.encode(channelId, purchaseRef, gross, salt))`, backed
  by a per-channel purchaseRef guard (`settledRefs`) so the same reference cannot be
  re-spent under a fresh salt (§6.4 #2's second clause).
  `purchaseRef` is `bytes32` (keccak of the UTF-8 ref when longer than 32 bytes).
- **Rationale**: spec FR-008 says the payload binds "at least (channel, ref, gross,
  salt)" — adding `isaId` prevents a compromised orchestrator from routing a genuine
  mill fact to a different deal on the same channel. Registry tuple stays PLAN-exact.
- **Alternatives**: signing only the registry tuple (rejected: routing attack above);
  raw `eth_sign` prefix (rejected: EIP-712 is the OZ-native, wallet-friendly standard).

## D7 — Post-termEnd income is a hard stop (CLARIFY DEFERRED #2; PLAN-silence tightening)

- **Decision**: `receiveIncome` additionally requires `block.timestamp <= termEnd`
  (equality allowed). Between termEnd and a `completeAtTerm` call, the deal is Active
  but collects nothing; only permissionless forgiveness remains.
- **Rationale**: makes the term a real end, prevents a backer from squeezing one more
  harvest past the term by front-running the seeker's forgiveness transaction
  (constitution VII, humane by design). PLAN's function table is silent here; B
  (keep settling while Active) was the strict literal but leaves a griefing window.
- **Alternatives**: keep settling while still Active (rejected: race window);
  auto-complete at termEnd in the same tx (rejected: nobody triggers it — blocks
  don't run code on their own).
- **PLAN note**: a tightening PLAN's table does not state — recorded as a PLAN
  clarification at merge, not a silent deviation. Test
  `testBoundary_Income_AfterTermEnd_Reverts` pins it.

## D8 — Profile counters update ONLY at completion (both terminal Completed* states)

- **Decision**: During an Active deal only `remaining`/`eventCount`/`lastEventAt`
  change. At completion (auto at cap, or `completeAtTerm`):
  `totalISAs++, completed++, qualEvents += isa.eventCount`, and
  `distinctBackers++` iff `!completedWithBacker[seeker][backer]` (then set it).
  Emits `ScoreChanged(old, new)`.
- **Rationale**: §6.4 #7 "score changes only on completion" + the §8 finish-line
  screen (58 during the deal → 91 at 🎉) only reconcile this way. `CompletedAtTerm`
  counts as completion (KiteScoring natspec, PLAN §6.2 comment).
- **Alternatives**: continuous profile updates (rejected: violates #7 and breaks the
  demo's reputation-jump narrative).

## D9 — Zero-gross income events settle 0/0 and never qualify (CLARIFY DEFERRED #3)

- **Decision**: `gross == 0` is permitted: splits 0/0, records the fact (replay
  guard applies), `isQualifyingEvent(…, 0, P)` is false so no score credit.
- **Rationale**: PLAN D8 "failed harvest diverts zero" — the mechanics exist, so the
  door stays open; erroring would erase the honest-failure story.
- **Alternatives**: revert on zero gross (rejected: no PLAN basis, kills D8 mechanics).

## D10 — Pause blocks exactly two functions (CLARIFY DEFERRED #4)

- **Decision**: `whenNotPaused` on `createISADraft` and `activateWithPermit` ONLY.
  `bindIdentity`, `registerChannel`, `cancelDraft` stay callable while paused.
- **Rationale**: PLAN §6.2 pause row names exactly draft/activate as blocked and
  receiveIncome/completeAtTerm as never blocked; everything unlisted stays usable —
  asymmetry means minimal blocking (spec FR-002 "ONLY").
- **Alternatives**: freeze admin/identity functions too (rejected: not in PLAN,
  adds blast radius).

## D11 — completeAtTerm state matrix (idempotency pinned)

- **Decision**: Active + `block.timestamp >= termEnd` → complete (forgive remaining,
  apply D8 bookkeeping, emit, clear `activeISA`). Already CompletedCapped or
  CompletedAtTerm → no-op SUCCESS (idempotent per PLAN). Drafted / Cancelled /
  non-existent id → revert. Never pausable, any caller.
- **Rationale**: PLAN "permissionless, idempotent, not pausable" + spec FR-013.
- **Alternatives**: revert on repeat (rejected: not idempotent).

## D12 — MockAUSD: plain OZ ERC20 + permit + hand-rolled ERC-3009 subset

- **Decision**: `contracts/src/MockAUSD.sol`, non-proxied. OZ `ERC20("AUSD","AUSD")`
  + `ERC20Permit` (ERC-2612) + `transferWithAuthorization(from,to,value,validAfter,
  validBefore,nonce,v,r,s)` per EIP-3009 (EIP-712 typehash from the EIP, auth-nonce
  map `used[authorizer][nonce]`, errors: `AuthorizationUsed`, `AuthorizationExpired`,
  `AuthorizationNotYetValid`, `AuthorizationInvalidSigner`). Domain name "AUSD",
  version "1" so app signatures mirror the intended real-asset domain. Constructor
  mints a fixed `INITIAL_SUPPLY = 1_000_000e6` to `initialHolder`. No
  `receiveWithAuthorization`, no `cancelAuthorization` (not in the user's scope).
- **Rationale**: user's feature description names exactly these two authorization
  standards; EIP-3009 is not in OZ, so it is hand-rolled against the EIP text.
- **Alternatives**: full ERC-3009 (rejected: scope discipline; swap-day note in
  SLITHER/README if the real asset ships it).

## D13 — AUSD address injected via initializer (CLARIFY DEFERRED #5 enabler)

- **Decision**: `initialize(address admin, address relayer, address orchestrator,
  address pauser, address ausd)` — the token is a parameter, not immutable.
- **Rationale**: lets the reentrancy tests deploy KiteCore against a malicious mock
  token whose `transfer`/`transferFrom` re-enter (spec FR-022) while production
  wires the real AUSD. Also enables the eventual Mock→real swap without redeploying
  logic assumptions.
- **Alternatives**: immutable constructor arg (rejected: proxy pattern wants
  initializer wiring; same test benefit either way, init is the OZ-idiomatic path).

## D14 — Reentrancy guards

- **Decision**: `ReentrancyGuardUpgradeable.nonReentrant` on `activateWithPermit` and
  `receiveIncome` (the two FR-022 surfaces). `completeAtTerm` moves no funds —
  unguarded (still safe: state transitions are checks-effects-interactions).
- **Rationale**: constitution gates require reentrancy tests on exactly these two.
- **Alternatives**: guard everything (rejected: unneeded gas on view/permissionless
  paths, PLAN measures gas).

## D15 — Test architecture: 3 files + handler, exact-name inventory

- **Decision**:
  - `contracts/test/MockAUSD.t.sol` — 10 `testMock_*`.
  - `contracts/test/KiteCore.t.sol` — 62 tests: 6 `testLiteral_*` (§6.3 demo
    journey through the real path) + 39 `testBoundary_*` + 6 `testRole_*` +
    5 `testPause_*` + 2 `testReentrancy_*` + 3 `testUpgrade_*` + 1 `testInitialize_*`.
  - `contracts/test/invariant/KiteCoreInvariants.t.sol` + `KiteCoreHandler.t.sol` —
    12 `invariant_NN_*`, one per §6.4 item (mapping in
    [contracts/kitecore-api.md](contracts/kitecore-api.md)); handler-driven with
    bounded actors (admin/relayer/orchestrator/pauser/seekers/backers/channel) and
    ghost accounting (cumulative in/out, per-ISA snapshots, score-change latches).
    Handler reverts are caught (try/catch) so legal-and-adversarial sequences run.
  - Names are contractual (002 convention): quickstart counts and tasks reference
    them verbatim.
- **Rationale**: constitution IX + spec FR-020/FR-021.
- **Alternatives**: fewer, broader tests (rejected: loses per-invariant failure
  localization, which is the point of §6.4).

## D16 — Slither toolchain

- **Decision**: `pip3 install --user slither-analyzer` (Ubuntu 22.04 WSL ships
  python3; install `python3-pip` via apt if pip3 is absent) + `solc-select install
  0.8.36 && solc-select use 0.8.36` so Slither compiles with the same solc forge
  uses. Run `slither contracts/src --json -` style triage; every finding gets a row
  in `contracts/SLITHER.md` (Finding / Severity / Disposition: fixed|justified /
  Rationale). If installation is impossible (no network), the attempted commands and
  output are committed in SLITHER.md and the gate stays OPEN — never silently passed
  (spec FR-023 + assumption).
- **Rationale**: user's Done-when; honest-failure rule (constitution VIII/X).
- **Alternatives**: Aderyn/other tools (rejected: user named Slither).

## D17 — Gas snapshot + published limits

- **Decision**: `forge snapshot --root contracts` → committed `contracts/.gas-snapshot`
  (add a `!contracts/.gas-snapshot` style entry if gitignore patterns interfere —
  verify at implementation). Hand-generate `packages/contracts/src/gasLimits.ts`
  from the snapshot in tasks: typed `KITE_GAS_LIMITS` mapping function →
  `{ gasUsed, fixedLimit }` with `fixedLimit = ceil(gasUsed × 1.25 / 1000) × 1000`,
  exported from the package entry, header comment `LOCAL-EVM BASELINE — recalibrate
  on Monad at deploy (gas is charged on the limit)`.
- **Rationale**: spec FR-024 + constitution Hard Constraints; simplest honest
  publishing without building codegen infra this feature.
- **Alternatives**: codegen script (deferred to the relayer feature with ABIs).

## D18 — foundry.toml additions

- **Decision**: add `[invariant] runs = 128, depth = 128` (handler suite is heavy;
  defaults 256/256 would dominate CI time) and keep default fuzz runs. No other
  config changes; OZ enters via `forge install` into `contracts/lib/` with
  auto-remappings alongside vendored forge-std.
- **Rationale**: keep the suite green-and-runnable unaided (constitution IX) within
  sane wall-clock.
- **Alternatives**: default depths (rejected: slow), CI profile split (deferred —
  no CI requirement in this feature).

---

## Needs-clarification residue

None. Every Technical Context unknown resolved above; D4 and D7 are the only two
that touch PLAN text and both carry an explicit "record as PLAN clarification at
merge" obligation.
