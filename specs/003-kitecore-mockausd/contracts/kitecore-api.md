# Contract API: KiteCore + MockAUSD (Feature 003)

**Test names are contractual** (Feature-002 convention): quickstart.md counts and
tasks.md gates reference them verbatim — do not rename. Suite = **84 tests**
(10 MockAUSD + 62 KiteCore + 12 invariant). All money literals are AUSD base units
(6 dp). Every function's natspec cites its PLAN §6.2 row; every test's comment cites
the §6.4 invariant or §6.3 row it proves.

**Standard demo fixture** (shared helper `_demo()` in KiteCoreTest — the §6.3
journey): MockAUSD funds all actors; admin initializes KiteCore with roles; relayer
binds Budi (seeker, prepared reputation {2,2,4,2} via two prior completed deals on
two backers) and Pak Haji (backer); admin registers channel 1 (mill, key = its
funded account, approves KiteCore); Budi drafts P 600e6 / share 2000 / capMult 130 /
term +12 months / channel 1 directed at Pak Haji; helper `_runTo(stage)` advances
the journey (activation at T0, panen at T0+61d, +122d, +183d).

---

## KiteCore — external interface

```solidity
struct Terms   { uint256 principal; uint16 shareBps; uint16 capMult; uint64 termEnd; uint64 channelId; }
struct ISA     { Terms terms; address seeker; address backer; uint256 remaining;
                 uint64 activatedAt; uint64 lastEventAt; uint64 eventCount; uint8 status; }
// status: 0 None · 1 Drafted · 2 Active · 3 CompletedCapped · 4 CompletedAtTerm · 5 Cancelled

function initialize(address admin, address relayer, address orchestrator, address pauser, address ausd)
function bindIdentity(address wallet, bytes32 identityHash)          // RELAYER_ROLE
function registerChannel(uint64 id, string calldata name, address pubkey)  // ADMIN
function createISADraft(Terms calldata terms, address backer) external returns (uint256 isaId)  // seeker, whenNotPaused
function cancelDraft(uint256 isaId)                                   // seeker | backer, Drafted only
function activateWithPermit(uint256 isaId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)  // whenNotPaused, nonReentrant
function receiveIncome(uint256 isaId, bytes32 purchaseRef, uint256 gross, bytes32 salt, uint8 v, bytes32 r, bytes32 s)  // ORCHESTRATOR, nonReentrant
function completeAtTerm(uint256 isaId)                                // anyone, never pausable
function flagMismatch(uint256 day, uint256 expected, uint256 actual)  // ORCHESTRATOR, emits only
function pause() / function unpause()                                 // PAUSER
function isaOf(uint256 isaId) view returns (ISA memory)
function profileOf(address seeker) view returns (KiteScoring.Profile memory)
function scoreOf(address seeker) view returns (uint8)
function offerOf(address seeker) view returns (uint256)
// + upgradeToAndCall (UUPS, ADMIN) inherited
```

### Behavior (revert conditions are exhaustive per PLAN §6.2 + spec FRs)

| Function | Requires | Effects |
|---|---|---|
| initialize | once | grants roles, wires AUSD (research D13), EIP-712 domain "KiteCore"/"1" |
| bindIdentity | RELAYER; `wallet` and `identityHash` both unbound | sets both directions (immutable, §6.4 #5); `IdentityBound` |
| registerChannel | ADMIN; id unused | stores name/pubkey/active=true; `ChannelRegistered` |
| createISADraft | not paused; caller identity-bound (seeker); backer identity-bound; §6.2 bounds: shareBps∈[1000,2000], capMult∈[120,150], termEnd≤now+24mo, principal≤offerOf(seeker); channel exists+active; activeISA[seeker]==0 | id=nextIsaId++; remaining=principal×capMult/100; status Drafted; `ISADrafted` |
| cancelDraft | status==Drafted; caller ∈ {seeker, backer} | status Cancelled (terminal); `ISACancelled` |
| activateWithPermit | not paused; status==Drafted; permit(backer→KiteCore, principal, deadline) valid; backer balance/allowance ≥ principal | permit → pull exactly principal → pay exactly principal to seeker; status Active; activatedAt=now; activeISA[seeker]=isaId; `ISAActivated` — atomic, no partial state on revert |
| receiveIncome | ORCHESTRATOR; status==Active; isa terms.channelId == signed channelId; EIP-712 `IncomeEvent{channelId, isaId, purchaseRef, gross, salt}` recovers to channels[channelId].pubkey; eventHash=keccak(channelId,purchaseRef,gross,salt) unused AND settledRefs[channel][purchaseRef] unset; now ≤ termEnd; channel funded+approved | pull gross; (toBacker,toSeeker)=KiteScoring.divert(gross,shareBps,remaining); pay both; remaining-=toBacker; if qualifying (isQualifyingEvent: gap≥60d since lastEventAt AND gross≥10% principal) eventCount++, lastEventAt=now; if remaining==0 → CompletedCapped + completion bookkeeping; `IncomeSettled(gross,toBacker,toSeeker,remaining,qualifying)` |
| completeAtTerm | status Active && now≥termEnd → complete; already Completed* → no-op success; Drafted/Cancelled/none → revert | forgiven=remaining; remaining irrelevant; status CompletedAtTerm; activeISA cleared; completion bookkeeping (D8); `ISACompletedAtTerm` + `ScoreChanged` |
| flagMismatch | ORCHESTRATOR | emits `MismatchFlagged`; zero state change |
| pause/unpause | PAUSER | paused=true/false; blocks ONLY draft+activate (D10) |
| views | — | pure reads over public state (constitution IV) |

Completion bookkeeping (D8, both Completed* paths): `totalISAs++, completed++,
qualEvents+=isa.eventCount`, `distinctBackers++` iff first completion with that
backer; emits `ScoreChanged(old,new)`.

### Events

`IdentityBound(wallet, identityHash)` · `ChannelRegistered(id, name, pubkey)` ·
`ISADrafted(isaId, seeker, backer, terms)` · `ISAActivated(isaId, backer, principal)` ·
`ISACancelled(isaId, by)` · `IncomeSettled(isaId, channelId, purchaseRef, gross,
toBacker, toSeeker, remaining, qualifying)` · `ISACompletedCapped(isaId)` ·
`ISACompletedAtTerm(isaId, forgiven)` · `ScoreChanged(seeker, oldScore, newScore)` ·
`MismatchFlagged(day, expected, actual)` · `Paused(account)` / `Unpaused(account)`.

### Errors (`Kite__` prefix)

`IdentityAlreadyBound` · `HashAlreadyBound` · `ChannelExists` · `UnknownChannel` ·
`ChannelInactive` · `NotVerified` · `ShareOutOfBounds` · `CapMultOutOfBounds` ·
`TermTooLong` · `TermAlreadyEnded` · `PrincipalAboveMax` · `HasActiveISA` ·
`NotDrafted` · `NotActive` · `NotSeekerOrBacker` · `WrongBacker` ·
`EventAlreadySettled` · `BadChannelSignature` · `ChannelMismatch` · `TermEnded`.
(OZ errors bubble for permit/roles/transfer failures.)

---

## MockAUSD — external interface

```solidity
constructor(address initialHolder)   // mints INITIAL_SUPPLY = 1_000_000e6 to holder
function decimals() pure returns (uint8)  // 6 — OZ default 18 is overridden
// ERC-20: totalSupply/balanceOf/transfer/approve/transferFrom (OZ)
// ERC-2612: permit(owner, spender, value, deadline, v, r, s), nonces, DOMAIN_SEPARATOR
// ERC-3009 (hand-rolled, research D12):
function transferWithAuthorization(address from, address to, uint256 value,
    uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)
```

ERC-3009 errors: `AuthorizationUsed` · `AuthorizationNotYetValid` ·
`AuthorizationExpired` · `AuthorizationInvalidSigner`. Domain name "AUSD", version "1".

---

## Test inventory — exact names (84)

### contracts/test/MockAUSD.t.sol — 10

| # | Name | Asserts |
|---|---|---|
| 1 | testMock_Decimals_Six | decimals()==6; symbol/totalSupply sane |
| 2 | testMock_Permit_UnlocksPull | permit → transferFrom moves exact value (the funding-leg primitive) |
| 3 | testMock_Permit_Expired_Reverts | deadline < now reverts |
| 4 | testMock_Permit_ReplayedNonce_Reverts | second permit with same nonce reverts |
| 5 | testMock_Permit_ForgedSignature_Reverts | wrong signer reverts |
| 6 | testMock_TransferWithAuthorization_GaslessSend | holder signs, relayer executes, exact value moves |
| 7 | testMock_TransferWithAuthorization_ReplayedNonce_Reverts | same nonce twice → AuthorizationUsed |
| 8 | testMock_TransferWithAuthorization_Expired_Reverts | now > validBefore |
| 9 | testMock_TransferWithAuthorization_NotYetValid_Reverts | now < validAfter |
| 10 | testMock_TransferWithAuthorization_ForgedSignature_Reverts | non-holder signature |

### contracts/test/KiteCore.t.sol — 62

**Literal tier — the §6.3 journey through the real path (6)**

| # | Name | Asserts |
|---|---|---|
| 1 | testLiteral_Demo_Activation_600Out_600In_Remaining780 | backer −600e6, seeker +600e6 same tx, status Active, remaining 780e6, activeISA set |
| 2 | testLiteral_Demo_Panen1_Back300_Seeker1200_Remaining480 | balances ±300e6/1200e6, remaining 480e6, eventCount 1 |
| 3 | testLiteral_Demo_Panen2_Back300_Seeker1200_Remaining180 | remaining 180e6, eventCount 2 |
| 4 | testLiteral_Demo_Panen3_Back180_Seeker1320_CompletedCapped | backer +180e6, seeker +1320e6, status CompletedCapped, terminal |
| 5 | testLiteral_Demo_Reputation_58During_91AtFinish | scoreOf(Budi)==58 after each panen mid-deal; {3,3,7,3} and score 91 + ScoreChanged exactly at completion |
| 6 | testLiteral_Cap_Formula_PrincipalTimesCapMultOver100 | remaining at draft == principal×capMult/100 for non-demo tuple (e.g. 1000e6×150/100) |

**Boundary tier — bounds, identity, stream, completion, cancel, views (39)**

| # | Name | Asserts |
|---|---|---|
| 7 | testBoundary_Draft_Share999_Reverts | ShareOutOfBounds |
| 8 | testBoundary_Draft_Share1000_Ok | accepted |
| 9 | testBoundary_Draft_Share2000_Ok | accepted |
| 10 | testBoundary_Draft_Share2001_Reverts | ShareOutOfBounds |
| 11 | testBoundary_Draft_Cap119_Reverts | CapMultOutOfBounds |
| 12 | testBoundary_Draft_Cap120_Ok | accepted |
| 13 | testBoundary_Draft_Cap150_Ok | accepted |
| 14 | testBoundary_Draft_Cap151_Reverts | CapMultOutOfBounds |
| 15 | testBoundary_Draft_TermBeyond24Months_Reverts | TermTooLong |
| 16 | testBoundary_Draft_TermExactly24Months_Ok | accepted |
| 17 | testBoundary_Draft_PrincipalAboveMaxP_Reverts | prepared seeker (58→1296e6): 1296e6+1 reverts |
| 18 | testBoundary_Draft_PrincipalExactlyMaxP_Ok | exactly 1296e6 accepted |
| 19 | testBoundary_Draft_PrincipalAboveScore0Max_Reverts | fresh seeker: 600e6+1 reverts |
| 20 | testBoundary_Draft_UnknownChannel_Reverts | UnknownChannel |
| 21 | testBoundary_Draft_SeekerWithActiveDeal_Reverts | HasActiveISA |
| 22 | testBoundary_Draft_SeekerUnverified_Reverts | NotVerified |
| 23 | testBoundary_Identity_HashToSecondWallet_Reverts | one hash, one wallet (§6.4 #5) |
| 24 | testBoundary_Identity_SecondHashToWallet_Reverts | one wallet, one hash |
| 25 | testBoundary_Income_CallerNotOrchestrator_Reverts | roles enforced |
| 26 | testBoundary_Income_ForgedSignature_Reverts | orchestrator submits attacker-signed event → BadChannelSignature (§6.4 #3) |
| 27 | testBoundary_Income_WrongChannel_Reverts | valid sig, channel ≠ deal's channel → ChannelMismatch |
| 28 | testBoundary_Income_TamperedGross_Reverts | sig over 1500e6, submit 1400e6 → recovery fails |
| 29 | testBoundary_Income_ReplaySameTuple_Reverts | second submit → EventAlreadySettled (§6.4 #2) |
| 30 | testBoundary_Income_ReplaySameRefNewSalt_Reverts | same purchaseRef, new salt → still EventAlreadySettled |
| 31 | testBoundary_Income_OnDrafted_Reverts | §6.4 #4 |
| 32 | testBoundary_Income_OnCancelled_Reverts | §6.4 #4 |
| 33 | testBoundary_Income_OnCompletedCapped_Reverts | §6.4 #4 terminality |
| 34 | testBoundary_Income_ZeroGross_SettlesZero_NeverQualifies | 0/0 split, fact recorded, eventCount unchanged (D9) |
| 35 | testBoundary_Income_SubBarGap_Splits_NoQualCredit | income 61d-1s after activation: splits, eventCount stays 0 (§6.4 #8) |
| 36 | testBoundary_Income_SliceEqualsRemaining_CompletesExactly | slice == remaining → completes at exactly the cap |
| 37 | testBoundary_Income_AfterTermEnd_Reverts | hard stop (research D7, TermEnded) |
| 38 | testBoundary_Complete_BeforeTermEnd_Reverts | now < termEnd |
| 39 | testBoundary_Complete_FromDrafted_Reverts | NotActive |
| 40 | testBoundary_Complete_RemainderForgiven_ProfileUpdated | forgiven remaining; profile {+1,+1,+eventCount,+1}; post-income reverts |
| 41 | testBoundary_Complete_SecondCall_NoOpSuccess | idempotent, no duplicate bookkeeping/event |
| 42 | testBoundary_Cancel_BySeeker_WhileDrafted_Ok | status Cancelled, terminal |
| 43 | testBoundary_Cancel_ByBacker_WhileDrafted_Ok | either party (D4) |
| 44 | testBoundary_Cancel_AfterActivation_Reverts | NotDrafted |
| 45 | testBoundary_Views_RecomputeFromPublicState | isaOf/profileOf/scoreOf/offerOf agree with §6.3 math on live state (constitution IV) |

**Role tier — §6.2 confinement matrix (6)**

| # | Name | Asserts |
|---|---|---|
| 46 | testRole_Relayer_CanOnlyBind | bind ok; draft/income/complete/flag/register/upgrade all revert |
| 47 | testRole_Orchestrator_OnlyIncomeCompleteFlag | those three ok; bind/draft/register/upgrade revert |
| 48 | testRole_Pauser_OnlyPauseCycle | pause/unpause ok; every fund-moving call reverts |
| 49 | testRole_Admin_GrantsRoles_CannotMoveFunds | grant/revoke/upgrade ok; as actor: income/draft revert (§6.4 #12) |
| 50 | testRole_Stranger_OnlyCompleteAtTerm | permissionless complete works; everything else reverts |
| 51 | testRole_FlagMismatch_EmitsOnly_ZeroStateChange | event emitted; all storage + balances byte-identical |

**Pause tier — asymmetric (5)**

| # | Name | Asserts |
|---|---|---|
| 52 | testPause_Blocks_CreateISADraft | reverts while paused |
| 53 | testPause_Blocks_ActivateWithPermit | reverts while paused |
| 54 | testPause_Allows_ReceiveIncome | settles while paused (§6.4 #10) |
| 55 | testPause_Allows_CompleteAtTerm | forgives while paused |
| 56 | testPause_Allows_BindAndRegister | documented default (research D10) |

**Reentrancy tier (2)**

| # | Name | Asserts |
|---|---|---|
| 57 | testReentrancy_ActivateWithPermit_Blocked | malicious-token KiteCore (research D13): re-entry reverts, one pull only (§6.4 #11) |
| 58 | testReentrancy_ReceiveIncome_Blocked | same for settlement |

**Upgrade tier (3)**

| # | Name | Asserts |
|---|---|---|
| 59 | testUpgrade_AdminOnly_UnauthorizedReverts | non-admin upgradeToAndCall reverts (FR-001) |
| 60 | testUpgrade_StateSurvives_V2 | dummy V2: isas/profiles/registry/balances intact (FR-017) |
| 61 | testUpgrade_ModuleNamespaces_Distinct | five ERC-7201 slots pairwise distinct |

**Init tier (1)**

| # | Name | Asserts |
|---|---|---|
| 62 | testInitialize_Twice_Reverts | initializer protection |

### contracts/test/invariant/KiteCoreInvariants.t.sol — 12 (§6.4, one per item)

Handler: `KiteCoreHandler` — bounded actor set (admin/relayer/orchestrator/pauser/
seekers/backers/channel), randomized legal + adversarial calls with try/catch, ghost
accounting (cumulative AUSD in/out per role, per-ISA snapshots, score latches,
settled-fact set, last-op-was-completion flag). Reentrancy attacker token wired via
D13 where reachable.

| # | Name | §6.4 | Holds |
|---|---|---|---|
| 1 | invariant_01_SplitConservation_CumulativeExact | #1, #9 | Σ income pulled == Σ backer paid + Σ seeker paid, exactly |
| 2 | invariant_02_EventFacts_SingleUse | #2 | every ghost-settled hash maps true; duplicates always reverted |
| 3 | invariant_03_Income_RequiresValidChannelSignature | #3 | zero income settled without a recovering signature (forged attempts all reverted) |
| 4 | invariant_04_NoIncome_OnTerminalISA | #4 | income attempts on terminal ISAs all reverted; no resurrection op exists |
| 5 | invariant_05_Identity_OneToOneBothWays | #5 | identityOf/walletOfIdentity mutual inverses over bound set |
| 6 | invariant_06_Terms_WithinBounds | #6 | every existing ISA's terms within §6.2 bounds; principal ≤ maxP at its creation |
| 7 | invariant_07_Score_Within0_100_ChangesOnlyOnCompletion | #7 | score ∈ [0,100]; scoreOf unchanged unless a completion ran since last check |
| 8 | invariant_08_SubBarEvents_AddNoQualCredit | #8 | qualEvents delta matches count of bar-passing events only |
| 9 | invariant_09_EscrowConservation_ContractHoldsNothing | #9 | KiteCore AUSD balance == 0 after every handler action |
| 10 | invariant_10_PauseAsymmetric_BlocksNewRisk_Only | #10 | while paused: draft/activate always revert; income/complete succeed |
| 11 | invariant_11_Reentrancy_Resisted | #11 | no nested drain possible; balance conservation holds under attacker token |
| 12 | invariant_12_Roles_ConfinedToPlanFunctions | #12 | ghost fund-ledger moves only via §6.2 legs regardless of actor roles |

---

## Suite arithmetic (quickstart depends on it)

10 (Mock) + 62 (Core: 6 literal + 39 boundary + 6 role + 5 pause + 2 reentrancy + 3
upgrade + 1 init) + 12 (invariant) = **84**. Tier selectors (`--match-test`, substring
regex): `testMock_` 10 · `testLiteral_` 6 · `testBoundary_` 39 · `testRole_` 6 ·
`testPause_` 5 · `testReentrancy_` 2 · `testUpgrade_` 3 · `testInitialize_` 1 ·
`invariant_` 12.
