# Quickstart: Backend validation gates (Feature 005)

Every gate is a command **you** run from the repo root; each prints its own PASS/FAIL and exits 0/1 (constitution IX). Endpoints and job payloads: [contracts/http-api.md](contracts/http-api.md). Tables and state machines: [data-model.md](data-model.md).

## §0 Prerequisites

- Bun 1.4.2 + Foundry on PATH (`bun run health` → 9/9 ok).
- A Neon Postgres project (free tier) — create one at neon.tech, copy the connection string.
- The Feature-004 deployment live (proxy `0x3B6C…C0fD` — already published in `@kite/contracts/addresses.ts`) and the operator keys available from `contracts/script/env.example` conventions: `DEPLOYER_KEY` (funded, holds MockAUSD), `RELAYER_KEY` (RELAYER_ROLE + MON), `ORCHESTRATOR_KEY` (ORCHESTRATOR_ROLE + MON), `MILL_KEY` (channel 1 signer).

## §1 Setup (once)

```sh
cp env.example .env             # root env for the backend; fill DATABASE_URL + keys
bun install
bun run db:push                 # applies the schema + stamps recon baseline
bun run health                  # 9/9
```

`db:push` records `recon_baseline_ts = now` (research D15): Feature-004's seed settlements predate the backend and stay out of recon verdicts; everything after is compared honestly.

## §2 Unit gates (no testnet, no network beyond Neon-none — PGlite in-memory)

```sh
bun test
```

Covers: purchase state machine (forward-only, transitions logged, duplicates no-op), webhook-event replay lock, ledger double-entry balance, quote TTL lock, recon math (ok / mismatch / incomplete-side), integer-money validation, banned-words scan of every public payload, relayer job read-back logic. Expected: all green, exit 0.

## §3 Gate SC-001 — gasless send, zero MON on the sender

Start the relayer (one process = HTTP + worker):

```sh
bun run dev:relayer             # listens on :3001
```

Run the gate (it creates two throwaway wallets, funds the sender with AUSD **from the deployer** — the sender never holds MON — signs the EIP-3009 authorization with the throwaway key, enqueues the job, waits for `confirmed`):

```sh
bun run scripts/gates/gasless-send.ts
```

PASS = AUSD moved sender → recipient; sender's MON balance was and stayed 0; job `confirmed` only after the onchain read-back. The gate prints all three facts with explorer links.

## §4 Gate SC-002 — purchase intent → SETTLED after the onchain split

With the relayer running (not needed for this gate's chain leg, but harmless):

```sh
bun run scripts/gates/purchase-settled.ts
```

The gate drives the full registry path: POST intent (mill signature captured at creation) → record payment (PAID) → `submit-settlement` Demo Tool submits `receiveIncome` with the stored signature at the published gas limit → the watcher (`watch-settlements.ts`) marks it SETTLED with the tx hash (the gate drives the watcher pass in-process — no separate watcher process to start) → asserts ledger rows balance (gross-in == backer-out + seeker-out) and the DB's deal copy equals `isaOf()` onchain. PASS = every step printed with its evidence (ids, tx, sums).

Manual poke afterwards (the endpoints are plain HTTP):

```sh
curl -s localhost:3000/api/channel/purchases/<id> -H "x-api-key: $MITA_API_KEY"
# → status "SETTLED", txHash set
curl -s -X POST localhost:3000/api/channel/purchases -H "x-api-key: $MITA_API_KEY" \
  -H 'content-type: application/json' -d '<identical body again>'
# → 200 with the SAME purchase id (idempotent — not a second row)
```

## §5 Gate SC-003 — recon: clean day, forced mismatch, no silent repair

```sh
bun run scripts/gates/recon.sh
```

Three assertions, in order:
1. **clean** — `recon.ts` on the gate's day: `recon_daily` row `{status: ok, totals equal}`, exit 0.
2. **forced mismatch** — the script injects a fake SETTLED purchase (or pads a ledger amount), reruns recon: row `{status: mismatch}` with both totals, **exit 1**, and the injected data is still there afterwards (nothing was repaired).
3. **infra failure** — recon with a dead RPC URL: **exit 2**, and no verdict row was written.

PASS = all three exit codes observed + rows as stated. Cleanup is built into the script.

## §6 Replay/edge spot-checks (also unit-covered; these run against the live services)

```sh
bun run scripts/gates/gasless-send.ts --replay    # re-enqueues the same clientRef → one transfer, job returned not duplicated
curl -s localhost:3000/api/health                 # flip RPC_URL to garbage first → status "degraded", rpc.ok false — never a fake ok
curl -s "localhost:3000/api/quote" && curl -s "localhost:3000/api/quote"   # same locked rate + expiresAt inside 60 s
curl -s localhost:3000/api/me -H "x-kite-wallet: 0xDbAc…"                    # Budi: onchain-equal remaining/progress/score
curl -s localhost:3000/api/p/0x<identityHash>                                # public profile, explorer links, no personal fields
```

## §7 Secrets checklist (manual review, 2 minutes)

- [ ] `.env` is gitignored; no key value appears in any committed file, log line, or gate output (gates print addresses and tx hashes only).
- [ ] `env.example` carries names + non-secret defaults only (the Feature-004 convention).
- [ ] Relayer key env-only; its onchain power is exactly RELAYER_ROLE (fund-confinement unchanged — constitution Hard Constraints).
- [ ] Demo components labeled: `submit-settlement` prints its Demo Tool banner; quote responses carry `source: "demo-fixed"`.
