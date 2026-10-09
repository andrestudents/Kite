# Demo accounts + deployment manifest (Feature 004, Monad testnet)

> **Disclosure (FR-018; PLAN §6.2 clarification of 2026-10-10):** this demo
> deployment was initialized with `minEventGap = 60 seconds` so the §6.3 seeded
> states are producible honestly inside the hackathon window. The protocol value
> is **60 days**; the gap is **init-once — no setter exists**, so nothing can
> change it on this deployment. A production deployment passes 60 days and the
> anti-farming property is unchanged (Matocard `minCycleDuration` precedent).
> The seeded history below is therefore **presented as prepared, not
> spontaneous** (constitution VIII): every transaction that built it is on the
> public explorer.
>
> Also disclosed: which settlement asset is live — `ausdIsMock` in
> `packages/contracts/src/addresses.ts` — and that the throwaway ISA of the
> manual loop is a demonstration artifact, funded by the deployer.

**Public addresses only. Never keys** (FR-005).

## Deployment (fill from the DeployKiteCore manifest — task T011)

| What | Address | Explorer |
|---|---|---|
| KiteCore (proxy — THE address) | _pending_ | _pending_ |
| KiteCore (implementation) | _pending_ | _pending_ |
| Settlement asset (`ausdIsMock`: _pending_) | _pending_ | _pending_ |
| Channel 1 «_name pending_» pubkey = mill wallet | _pending_ | _pending_ |
| `minEventGap()` | **60** (seconds — demo value; protocol 60 days) | — |
| deployedAt | _pending_ | — |

## Operators

| Role | Address | Funded with |
|---|---|---|
| Deployer / admin | _pending_ | faucet MON |
| RELAYER_ROLE | _pending_ | 1 MON (seed leg) |
| ORCHESTRATOR_ROLE | _pending_ | 1 MON (seed leg) |
| PAUSER_ROLE | _pending_ | — |

## Personas (seeded — task T017)

| Persona | Address | Holding |
|---|---|---|
| Budi (seeker, all ISAs) | _pending_ | identity-bound; 1,200 + 1,920 + 1,200 AUSD received |
| Siti (historical backer A) | _pending_ | AUSD (funded) |
| Wati (historical backer B) | _pending_ | AUSD (funded) |
| Pak Haji (active backer) | _pending_ | AUSD (funded) |
| Mill (channel signer + gross funding) | _pending_ | AUSD ≥ seed grosses + finale headroom |

## State after seed (asserted on-chain by stage 5)

- `scoreOf(Budi) == 58` — profile {totalISAs 2, completed 2, qualEvents 4, distinctBackers 2}
- ISA-3 (demo): P 600 AUSD · cap 780 · **remaining 480 (38.5%)** · Active · backer Pak Haji
- ISA-1, ISA-2: CompletedCapped (the §6.3 history)

## Throwaway manual-loop ISA (task T021)

| What | Value |
|---|---|
| ISA id | _pending_ |
| Outcome | CompletedCapped · remaining 0 · replay reverts |
