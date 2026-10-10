# MANUAL-LOOP.md — the throwaway ISA, by hand, with `cast` only

**Demo Tool.** This runbook proves the PLAN §12 Day-4 done-when with bare tools:
one throwaway ISA walks draft → activate → income → `CompletedCapped`, every
transaction visible on the explorer, no orchestration, no UI, no script doing the
thinking.

> **Disclosure (FR-018 / TRUST.md):** the deployment you are pointing at was
> initialized with `minEventGap = 60 SECONDS` (demo value) instead of the protocol's
> 60 days, so this loop needs no waiting between events. The gap is init-once (no
> setter) and readable on-chain via `minEventGap()`. The first qualifying event of an
> ISA never needs a wait; this loop uses exactly one event.

## What you need

- `cast` + `forge` (Foundry), on PATH.
- Sourced env (see [`env.example`](env.example)): `DEPLOYER_KEY`, `RELAYER_KEY`,
  `ORCHESTRATOR_KEY`, `MILL_KEY` — plus two throwaway keys you create in step 1.
- The proxy address from the deploy manifest / [`DEMO-ACCOUNTS.md`](DEMO-ACCOUNTS.md)
  (published in `packages/contracts/src/addresses.ts` as `KITE_DEPLOYMENT.kiteCore`).
- Gas limits: every `cast send` below carries `--gas-limit` from
  [`packages/contracts/src/gasLimits.ts`](../../packages/contracts/src/gasLimits.ts) —
  on Monad, gas is charged on the LIMIT, so tight limits are the honest number.
- **The throwaway ISA id**: run it only after the seed landed (ids 1–3 belong to
  Budi; id 3 is the demo ISA). The draft lands on the next free id — read it
  from the ISADrafted event of your `createISADraft` tx (explorer or
  `cast receipt`) and use it everywhere below as `$ID`. On the demo deployment
  the clean run landed **id 10** (ids 4–9 are abandoned drafts from implementer
  dry-runs whose throwaway keys died mid-loop — they stay Drafted forever,
  which is itself the cancel-absent honest behavior).

Set up once (paste the proxy address):

```sh
RPC_URL="${RPC_URL:-https://testnet-rpc.monad.xyz}"
KITE_CORE="0x…"                                  # from DEMO-ACCOUNTS.md
AUSD=$(cast call "$KITE_CORE" 'ausd()' --rpc-url "$RPC_URL" | cast parse-bytes32-address)
echo "proxy=$KITE_CORE asset=$AUSD"
```

## 1. Two throwaway wallets

```sh
cast wallet new   # → SEEKER (address + private key)
cast wallet new   # → BACKER (address + private key)
SEEKER_KEY=0x…; SEEKER=0x…       # paste each pair
BACKER_KEY=0x…; BACKER=0x…
```

These keys exist for this loop only — throw them away after (they are printed to
YOUR terminal, never committed).

## 2. Fund them (deployer pays)

```sh
# The seeker pays draft (345k) + activation (346k) charged ON THE LIMIT
# (Monad) - ~0.07 MON at 100+ gwei; 0.15 leaves headroom.
cast send "$SEEKER" --value 0.15ether --private-key "$DEPLOYER_KEY" --rpc-url "$RPC_URL"
cast send "$BACKER" --value 0.05ether --private-key "$DEPLOYER_KEY" --rpc-url "$RPC_URL"   # spare
cast send "$AUSD" 'transfer(address,uint256)' "$BACKER" 300000000 \
  --private-key "$DEPLOYER_KEY" --gas-limit 93000 --rpc-url "$RPC_URL"                     # principal 300 AUSD
```

Confirm the mill can still fund a gross (seed left it ≥ 2,650 AUSD):

```sh
cast call "$AUSD" 'balanceOf(address)' "$MILL" --rpc-url "$RPC_URL"    # MILL address from DEMO-ACCOUNTS.md
```

## 3. Identity (RELAYER broadcasts BOTH bindings)

`createISADraft` requires BOTH parties verified (ISA.sol: `Kite__NotVerified`),
so the backer is bound here too — different hash, same relayer.

```sh
HASH_S=$(cast keccak "manual-loop:$SEEKER")
cast send "$KITE_CORE" 'bindIdentity(address,bytes32)' "$SEEKER" "$HASH_S" \
  --private-key "$RELAYER_KEY" --gas-limit 158000 --rpc-url "$RPC_URL"
HASH_B=$(cast keccak "manual-loop-backer:$BACKER")
cast send "$KITE_CORE" 'bindIdentity(address,bytes32)' "$BACKER" "$HASH_B" \
  --private-key "$RELAYER_KEY" --gas-limit 158000 --rpc-url "$RPC_URL"
cast call "$KITE_CORE" 'identityOf(address)' "$SEEKER" --rpc-url "$RPC_URL"   # == $HASH_S
cast call "$KITE_CORE" 'identityOf(address)' "$BACKER" --rpc-url "$RPC_URL"   # == $HASH_B
```

## 4. Draft (the seeker proposes: P 300 · 20% · cap 1.3× · 1 year)

```sh
TERMENT=$(( $(date +%s) + 31536000 ))
cast send "$KITE_CORE" \
  'createISADraft((uint256,uint16,uint16,uint64,uint64),address)' \
  "(300000000,2000,130,$TERMENT,1)" "$BACKER" \
  --private-key "$SEEKER_KEY" --gas-limit 345000 --rpc-url "$RPC_URL"
```

(The struct arg takes PARENTHESES on this cast build — `[a,b,c]` fails with
`parser error: expected ( `.)

The new ISA is the next free id on the deployment (`$ID` — read it from the
ISADrafted event; **10** on the demo deployment). Confirm it exists and is `status 1`
(Drafted):

```sh
ID=10   # <- from your ISADrafted event
cast call "$KITE_CORE" 'isaOf(uint256)' "$ID" --rpc-url "$RPC_URL"
```

## 5. Activate — one transaction, signed by nobody's key on-chain

```sh
BACKER_KEY="$BACKER_KEY" KITE_CORE_ADDRESS="$KITE_CORE" ISA_ID="$ID" \
  forge script contracts/script/SignPermit.s.sol --root contracts \
  --rpc-url "$RPC_URL"    # Demo Tool: prints v/r/s; NO --rpc-url = local EVM = dead reads
```

Paste `DEADLINE`, `V`, `R`, `S` from its output, then (activation is permissionless —
the backer's signature IS the authorization; the seeker may broadcast):

```sh
cast send "$KITE_CORE" 'activateWithPermit(uint256,uint256,uint8,bytes32,bytes32)' \
  "$ID" "$DEADLINE" "$V" "$R" "$S" \
  --private-key "$SEEKER_KEY" --gas-limit 346000 --rpc-url "$RPC_URL"
```

(346,000 = the COLD-state live estimate 276,644 × 1.25, from
[`gasLimits.ts`](../../packages/contracts/src/gasLimits.ts). The seed's
warm-state 256,000 limit OOG'd here — Monad charges on the LIMIT and a mined
revert still pays it. If a send reverts with empty data, that is out-of-gas.)

Verify: `isaOf($ID)` → `status 2` (Active); the seeker was paid the principal:

```sh
cast call "$AUSD" 'balanceOf(address)' "$SEEKER" --rpc-url "$RPC_URL"   # 300000000
```

## 6. One qualifying income event caps it exactly

ISA-$ID: P 300e6, cap 390e6, share 2000 bps → one gross of **1950e6** diverts
exactly 390e6 (20%) → remaining hits 0 → the contract auto-completes
`CompletedCapped` in the SAME transaction. First event of the ISA → no gap wait.

```sh
MILL_KEY="$MILL_KEY" KITE_CORE_ADDRESS="$KITE_CORE" ISA_ID="$ID" \
  GROSS=1950000000 PURCHASE_REF=$(cast keccak "manual-e1") SALT=$(cast keccak "manual-s1") \
  forge script contracts/script/SignIncome.s.sol --root contracts \
  --rpc-url "$RPC_URL"    # Demo Tool: prints v/r/s
```

Then the orchestrator transports the fact:

```sh
cast send "$KITE_CORE" \
  'receiveIncome(uint256,bytes32,uint256,bytes32,uint8,bytes32,bytes32)' \
  "$ID" "$PURCHASE_REF" 1950000000 "$SALT" "$V" "$R" "$S" \
  --private-key "$ORCHESTRATOR_KEY" --gas-limit 502000 --rpc-url "$RPC_URL"
```

## 7. Assert the terminal state

```sh
cast call "$KITE_CORE" 'isaOf(uint256)' "$ID" --rpc-url "$RPC_URL"
#   remaining: 0        status: 3 (CompletedCapped)
cast call "$AUSD" 'balanceOf(address)' "$BACKER" --rpc-url "$RPC_URL"   # 390000000
#   (the backer spent the 300 principal on activation; the payout is +390)
```

## 8. The replay must revert

```sh
cast send "$KITE_CORE" \
  'receiveIncome(uint256,bytes32,uint256,bytes32,uint8,bytes32,bytes32)' \
  "$ID" "$PURCHASE_REF" 1950000000 "$SALT" "$V" "$R" "$S" \
  --private-key "$ORCHESTRATOR_KEY" --gas-limit 502000 --rpc-url "$RPC_URL"
# → reverts: Kite__NotActive(<ID>, 3) — terminal states accept no further income
```

## 9. Collect the explorer trail

Every `cast send` printed a transaction hash. Open each on
`https://testnet.monadscan.com/tx/<hash>` and confirm it resolved against the
**verified** proxy (if a URL shows unverified source, the SC-003 gate is open —
say so, do not round it down):

| Step | Tx hash | What to see |
|------|---------|-------------|
| funding ×2 | | MON transfers from deployer |
| AUSD transfer | | 300 AUSD → backer |
| bindIdentity | | IdentityBound event |
| createISADraft | | ISADrafted($ID, …) event |
| activateWithPermit | | ISAActivated($ID) event |
| receiveIncome | | IncomeSettled($ID, …, qualifying=true) + ISACompletedCapped($ID) |
| replay | | reverted transaction |

Note the throwaway ISA id in [`DEMO-ACCOUNTS.md`](DEMO-ACCOUNTS.md) when done.
