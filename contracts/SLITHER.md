# SLITHER.md — static-analysis triage (T024)

Feature 003 · spec FR-023 / research.md D16. **Every finding is triaged below —
0 untriaged.** Two findings were FIXABLE in Kite src and are FIXED (§ "Fixed
during triage"); every other finding is justified with the rule it implements.

## Reproduction

```bash
pip3 install --user slither-analyzer solc-select   # exit 0
solc-select install 0.8.36 && solc-select use 0.8.36  # exit 0 (research.md D16 pin)
slither contracts/                                  # exit 0
slither contracts/ --json slither.json              # machine-readable census
```

Versions: slither-analyzer **0.11.6** · crytic-compile 0.4.2 · solc-select 1.2.0 ·
solc 0.8.36 selected (the foundry integration drives `forge build --build-info`;
the project's `^0.8.20` pragmas compile on the forge-managed 0.8.x toolchain).

Result: **47 contracts, 102 detectors, 125 findings** — 22 in `src/`, 103 in
vendored `lib/` (OpenZeppelin 5.7, unmodified). Before the two fixes below:
127 findings (the shadowing-builtin and the src shadowing-local are gone).

## Fixed during triage (2)

| # | Detector | Location | Severity | Disposition | Rationale |
|---|----------|----------|----------|-------------|-----------|
| F1 | shadowing-builtin | `KiteScoring.isQualifyingEvent(...,uint256 now,…)` (src/KiteScoring.sol:111) | Low | **fixed** | Param renamed `now` → `at` (Solidity 0.8 has no `now` builtin, but the shadow is still confusing); signature + natdoc updated; all callers are positional; full suite re-verified 104/104 |
| F2 | shadowing-local | `KiteCore.initialize(...,address ausd)` shadowing `KiteCore.ausd()` (src/KiteCore.sol:35) | Low | **fixed** | Param renamed `ausdToken`; ABI selector unchanged (initialize is called positionally everywhere); re-verified |

## src/ findings (22 — each triaged individually)

| # | Detector | Location | Severity | Disposition | Rationale |
|---|----------|----------|----------|-------------|-----------|
| S1 | arbitrary-send-erc20 | `Stream._settleFact` — `transferFrom(channelKey,…)` (src/modules/Stream.sol:171) | High | **justified** | The detector cannot see the authorization: `channelKey` is contract-owned, write-once registry state set by ADMIN-only `registerChannel` (PLAN §6.2), and the pull is authorized per-fact by the channel's EIP-712 income signature verified onchain. ORCHESTRATOR cannot choose a source — §6.4 #3 (forged/tampered/wrong-channel signature tests) + invariant_03 prove non-channel calls revert |
| S2 | arbitrary-send-erc20-permit | `ISAModule.activateWithPermit` — `transferFrom(isa.backer,…)` (src/modules/ISA.sol:195) | High | **justified** | This IS PLAN §6.2's one-tx activation: the backer is authenticated by the ERC-2612 permit over the token's own domain, plus the pre-recover check that the signer IS `isa.backer` (reverts `WrongBacker` otherwise). The "arbitrary from" is the backer themselves — by design |
| S3 | reentrancy-no-eth | `Stream._settleFact` bookkeeping written after ERC-20 transfers (src/modules/Stream.sol:171–174,192) | Medium | **justified** | Both money entry points are `nonReentrant` with the guard declared FIRST (Stream.sol:110, ISA.sol:175); the AUSD rail is a fixed ERC-20 with no transfer hooks (ERC-2612/ERC-3009 signatures only — no callbacks); the D13 attacker-token rig (testReentrancy_ 2 tests) and invariant_11 prove re-entry is blocked while the outer flow completes atomically. Cross-function re-entry via permissionless `completeAtTerm` is idempotent on terminal/due ISAs only (T019) |
| S4 | unchecked-transfer | `Stream._settleFact` ×3 + `activateWithPermit` ×2 — return values ignored (src/modules/Stream.sol:171,173,174; src/modules/ISA.sol:195,196) | High | **justified** | OpenZeppelin 5.x ERC-20 `transfer`/`transferFrom` REVERT on failure — they have no `return false` path (OZ docs; bool returns exist only for non-standard tokens). Checking the return is vestigial under this token standard; downstream flows are re-verified by the §6.3 literal numbers and invariant_12's balance mirror |
| S5 | uninitialized-local | `KiteScoring.score` local `history` (src/KiteScoring.sol:52) | Medium | **justified** | Relies on Solidity's guaranteed zero-initialization: `history` stays 0 when `totalISAs == 0`, which is exactly the §6.3 specified score for a new seeker. The 20-test KiteScoring suite pins every boundary of this formula |
| S6 | timestamp | `ISAModule.createISADraft` — `MAX_TERM`/start bounds (src/modules/ISA.sol:138,141) | Low | **justified** | Time IS the specified semantics: §6.2 defines terms in days (max 730). A ±1–2 s block-timestamp variance is immaterial at day magnitude; inclusive boundaries are pinned by testBoundary_ tests |
| S7 | timestamp | `Completion.completeAtTerm` — `now < termEnd` (src/modules/Completion.sol:31) | Low | **justified** | Completing AT TERM is by definition a timestamp comparison (PLAN §6.2); inclusive edge (`termEnd`) pinned by testBoundary_Complete_* |
| S8 | timestamp | `Stream.receiveIncome` — D7 hard stop `now > termEnd` (src/modules/Stream.sol:120) | Low | **justified** | PLAN research.md D7 rule verbatim; equality allowed, +1 s reverts — pinned by tests. Same day-magnitude reasoning |
| S9 | timestamp | `MockAUSD._transferWithAuthorization` — `validAfter`/`validBefore` (src/MockAUSD.sol:71–72) | Low | **justified** | Verbatim ERC-3009 window semantics; MockAUSD is the labeled **Demo Tool** money rail, replaced by production AUSD at integration |
| S10 | assembly | `_identityStorage` / `_isaStorage` / `_streamStorage` / `_governedStorage` (src/modules/Identity.sol:49, ISA.sol:103, Stream.sol:86, Governed.sol:37) | Informational | **justified** | ERC-7201 namespaced storage access — the exact pattern PLAN §6.1 / research.md D3 mandate (and OZ's own upgradeable namespaces use). Assembly is required by EIP-7201; the four slot constants are compile-time derived with the standard formula |
| S11 | naming-convention | `Governed.__Governed_init` (src/modules/Governed.sol:44) | Informational | **justified** | OZ initializer naming convention (`__X_init`) — required to interoperate with `onlyInitializing` guards |
| S12 | naming-convention | `IAUSD.DOMAIN_SEPARATOR` (src/modules/ISA.sol:20) | Informational | **justified** | ERC-2612 mandates the exact function name — cannot be mixedCase |
| S13 | pragma | src declares `^0.8.20` ranges (multiple files) | Informational | **justified** | PLAN non-negotiable: "Solidity 0.8.x". Ranges are resolved by the forge-managed toolchain at compile time |
| S14 | solc-version | `^0.8.20` range flagged against historical Solidity advisories | Informational | **justified** | The advisory list applies to RANGE floors, not the compiled 0.8.x current release; OZ 5.7 requires ≥ 0.8.20. Action recorded for deploy: pin the exact solc in foundry.toml during the Monad gas calibration (T025 companion) |

## lib/ findings (103 — vendored OpenZeppelin 5.7 / dependency-managed)

| # | Detector | Locations | Count | Severity | Disposition | Rationale |
|---|----------|-----------|-------|----------|-------------|-----------|
| L1 | assembly | OZ internals: ECDSA, MessageHashUtils, StorageSlot, Math, Bytes, LowLevelCall, Strings, ShortStrings, Panic, SafeCast, upgradeable namespace accessors | 55 | Informational | **justified** | Vendored OZ 5.7, unmodified, at its published audit baseline; assembly is OZ's own implementation choice |
| L2 | divide-before-multiply | `Math.mulDiv`, `Math.invMod` | 9 | Medium | **justified** | Intentional Montgomery-style modular-inverse computation (OZ reviewed); slither's dataflow cannot prove the divisor invariants |
| L3 | incorrect-exp | `Math.mulDiv` — `^` read as exponentiation | 1 | High | **justified** | Known slither false positive on OZ: the `^` IS bitwise-xor by design (exponentiation-by-squaring step in the modular inverse) |
| L4 | msg-value-in-nonpayable | `ERC1967Utils._checkNonPayable` | 1 | High | **justified** | Intentional OZ guard — reverts if `msg.value` is present on an upgrade path; the detector mis-models the guard as a read |
| L5 | naming-convention | OZ `__X_init`, `_EIP712Name`, `DOMAIN_SEPARATOR`, location constants | 19 | Informational | **justified** | OZ conventions and ERC-2612/ERC-1967 mandated names; vendored |
| L6 | shadowing-local | `ERC20Permit.constructor(string).name` | 1 | Low | **justified** | OZ constructor parameter shadowing its own view — vendored, standard ERC-20 name wiring |
| L7 | solc-version | dependency pragma ranges (`^0.8.20`, `^0.8.22`, `>=0.8.4`, …) | 6 | Informational | **justified** | Dependency-managed ranges; resolved to current 0.8.x by the toolchain |
| L8 | timestamp | `ERC20Permit.permit` deadline | 1 | Low | **justified** | Verbatim ERC-2612 standard semantics |
| L9 | too-many-digits | OZ bit-mask literals (`Bytes`, `Math.log2`, `ShortStrings`) | 7 | Informational | **justified** | Intentional hex bit-masks; readability lint only |
| L10 | unindexed-event-address | `IERC1967.AdminChanged` | 1 | Informational | **justified** | ERC-1967 SPECIFIES the event signature — indexing would change the topic hash; vendored verbatim |
| L11 | unused-return | `ERC1967Utils.upgradeToAndCall` / `upgradeBeaconToAndCall` — `functionDelegateCall` return ignored | 2 | Medium | **justified** | `Address.functionDelegateCall` reverts on failure — the bool return has no false path in OZ 5.x; vestigial check |

## Sum check

src: 22 (S1..S14 = 1+1+2+5+1+1+1+1+1+4+1+1+1+1 = 22) · lib: 103 (55+9+1+1+19+1+6+1+7+1+2 = 103) ·
fixed: 2 · **125 total = 0 untriaged.**

Post-triage verification: `forge test --root contracts` → **104 passed; 0 failed**
(62 KiteCore + 12 invariant + 10 MockAUSD + 20 KiteScoring).

---

# Feature 004 re-triage — governed-gap refactor (2026-10-10)

The Q1/A refactor touched four src files: `KiteScoring.sol` (MIN_EVENT_GAP constant
→ `isQualifyingEvent(…, minGap)` argument — library stays pure/stateless),
`Governed.sol` (`minEventGap` added to the `kite.governed` ERC-7201 struct, set
once in `__Governed_init`, public `minEventGap()` view, NO setter),
`KiteCore.sol` (`initialize` gains the 6th `minEventGapSec` parameter), and
`Stream.sol` (passes the stored gap into the gate). Re-ran the exact 003 toolchain:

```bash
slither contracts/ --json slither.json   # slither-analyzer 0.11.6, solc 0.8.36
```

Result: **47 contracts, 102 detectors, 126 findings** — 23 in `src/`, 103 in
vendored `lib/` (unchanged from 003). Delta vs the 003 census: **+1**, triaged
below. No previously-justified finding changed location or shape except where the
refactor's lines moved (`Stream.sol` line numbers shifted by the call-site edit).

## New findings (1 — triaged)

| # | Detector | Location | Severity | Disposition | Rationale |
|---|----------|----------|----------|-------------|-----------|
| S15 | reentrancy-benign | `Stream._settleFact` — the qualifying-gate read now listed as a state-access path: `KiteScoring.isQualifyingEvent(…, minEventGap())` (src/modules/Stream.sol:181–182; accessor src/modules/Governed.sol:43–47) | Informational | **justified** | `minEventGap()` is an INTERNAL view over this contract's own ERC-7201 `kite.governed` storage — no external call, no callback surface; slither's reentrancy graph merely gained a read node when the gate started going through the accessor. The money reasoning is unchanged from S3: both entry points remain `nonReentrant`-first, the AUSD rail has no transfer hooks, and the D13 rig + invariant_11 still prove re-entry is blocked. Read-only and init-once — the value cannot be mutated mid-transaction by any role (no setter, FR-016) |

## Sum check (004)

src: 23 (003's 22 + S15) · lib: 103 (vendored, untouched) · **126 total = 0 untriaged.**

Post-refactor verification: `forge test --root contracts` → **108 passed; 0 failed**
(65 KiteCore incl. the testGap_ tier + 12 invariant + 10 MockAUSD + 21 KiteScoring
incl. testGap_ArgumentControlsQualifyingWindow).
