# Data Model: Backend — API, Relayer, Purchase Registry & Reconciliation (Feature 005)

**Source**: PLAN §7.3 (schema is verbatim there — table names and columns below reproduce it exactly) · spec FR-005..FR-012, FR-019..FR-021 · research D3, D8, D9, D15.
**Storage**: Neon Postgres via Drizzle; schema declared once in `packages/core/src/db/schema.ts`.
**Money rule (constitution VI)**: every `*_ausd` / amount column is a Postgres `bigint` holding integer AUSD base units (6 dp). No numeric/float/decimal column anywhere.

## §7.3 tables (verbatim core)

### users
| Column | Type | Rules |
|---|---|---|
| id | uuid/text PK | — |
| wallet | text UNIQUE | 0x-address, lowercase canonical |
| phone | text NULL | demo: optional |
| kyc_status | text | `unverified → verified` (demo auto-approve path) |
| identity_hash | text NULL | 0x-bytes32; set when bound (matches onchain binding) |
| locale | text | e.g. `id`, `ms` |
| created_at | timestamptz | — |

### isas — chain cache (projection; the contract wins, constitution IV)
| Column | Type | Rules |
|---|---|---|
| isa_id | numeric PK | onchain id |
| seeker / backer | text | 0x-addresses |
| principal | bigint | AUSD base units |
| share_bps | integer | 1000..2000 |
| cap_mult | integer | 120..150 |
| remaining | bigint | AUSD base units, refreshed from `isaOf()` on every observed event |
| status | text | `drafted / active / completed_capped / completed_at_term / cancelled` |
| term_end | bigint | unix seconds |

Refreshed by the settlement watcher (D9) and relayer read-backs; never user-writable.

### purchases — the §7.2 state machine
| Column | Type | Rules |
|---|---|---|
| id | serial/uuid PK | — |
| channel_id | numeric | must exist in `channels` |
| isa_id | numeric | the deal the purchase settles against |
| purchase_ref | text | 0x-bytes32 — **UNIQUE (channel_id, purchase_ref)** (§7.2 rule 1) |
| gross_ausd | bigint | integer ≥ 0 |
| status | text | `PENDING → PAID → SETTLED` (+ `FAILED`) — forward only |
| mill_sig | jsonb | `{salt, v, r, s}` — the mill's EIP-712 signature captured AT CREATION (D8) |
| tx_hash | text NULL | settlement tx, set at SETTLED |
| created_at | timestamptz | — |
| *settled_at* | timestamptz NULL | aux (D15): recon day attribution |
| *failed_reason* | text NULL | aux (D15): terminal failure reason |

Rows are never deleted; status never regresses; every change appends to `purchase_transitions`.

### channels
| Column | Type | Rules |
|---|---|---|
| id | numeric PK | onchain channel id |
| name | text | — |
| pubkey | text | the mill's signing address (onchain registry is authority) |
| active | boolean | mirrors onchain `channelOf()` |

### fx_quotes — display-only locks (§7.4)
| Column | Type | Rules |
|---|---|---|
| id | serial PK | — |
| pair | text | `USD_IDR`, `USD_MYR` |
| rate | bigint | integer; interpreted with the pair's scale (IDR ×1, MYR ×10⁻³) — D13 |
| expires_at | timestamptz | now + 60 s; read inside TTL returns the same row |

### relayer_jobs — the queue (§7.3 + D5/D6/D7)
| Column | Type | Rules |
|---|---|---|
| id | serial PK | — |
| kind | text | `activate_with_permit` / `transfer_with_authorization` / `bind_identity` / `drip` — exactly four (FR-015) |
| payload_json | jsonb | kind-specific (HTTP contract §Jobs) |
| status | text | `pending → sent → confirmed` (§7.3 states only) |
| tx_hash | text NULL | set when broadcast |
| nonce | bigint NULL | recorded per send; resynced from chain before each send (D6) |
| attempts | integer | ≥ 0; incremented per attempt |
| *client_ref* | text UNIQUE NULL | aux: idempotent enqueue (D5) |
| *last_error* | text NULL | aux (D15) |
| *terminal_at* | timestamptz NULL | aux (D15): set when attempts exhausted — the job is failed iff this is set |

### webhook_events — the replay lock (§7.2 rule 1)
| Column | Type | Rules |
|---|---|---|
| provider_event_id | text PK | e.g. `10143:7421:3` (chain:block:logIndex) for chain events; provider ids for HTTP webhooks |
| processed_at | timestamptz | — |

### recon_daily — the daily verdict (§7.3)
| Column | Type | Rules |
|---|---|---|
| day | date PK | UTC day |
| backend_total | bigint | Σ gross of SETTLED purchases settled that day |
| chain_total | bigint | Σ gross of IncomeSettled events that day (post-baseline) |
| status | text | `ok` / `mismatch` |

Upsert by day (latest completed run wins); never written when a side was unfetchable (exit 2 instead — D16).

## Auxiliary tables (§7.2-mandated behavior; research D15)

### purchase_transitions — append-only lifecycle log (§7.2 rule 2)
| Column | Type |
|---|---|
| id | serial PK |
| purchase_id | FK → purchases |
| from_status / to_status | text |
| actor | text (api-key identity or `chain-watcher`) |
| created_at | timestamptz |

### ledger_entries — append-only double entry (§7.2 rule 3)
| Column | Type | Rules |
|---|---|---|
| id | serial PK | — |
| purchase_id | FK → purchases | written once, at SETTLED |
| account | text | `channel:<id>` (in) · `backer:<addr>` / `seeker:<addr>` (out) |
| side | text | `in` / `out` |
| amount_ausd | bigint | from the IncomeSettled event values (gross, toBacker, toSeeker) |

Per purchase: Σ(in) == Σ(out) == gross — asserted by the writer and by a unit test. Entries immutable.

### drips — one-time MON drip (§7.2 rule 5, FR-017)
| Column | Type | Rules |
|---|---|---|
| wallet | text PK | one drip per wallet, enforced by the PK |
| tx_hash | text | — |
| created_at | timestamptz | — |

### job_state — checkpoints and counters (research D9/D15)
| Column | Type | Rules |
|---|---|---|
| key | text PK | `settlements_block`, `recon_baseline_ts`, `unmatched_settlement_events`, … |
| value | text | integer/ISO as fits the key |

`recon_baseline_ts` is set once at `db:push` (D15): the chain's pre-backend seed settlements stay out of recon verdicts; everything after is compared honestly.

## Relationships

```text
channels 1───n purchases n───1 isas (cache row per onchain deal)
purchases 1───n purchase_transitions        (append-only)
purchases 1───n ledger_entries              (written at SETTLED)
purchases 1───1 webhook_events-claimed log rows (via event id at settlement time)
users 1───n isas (seeker or backer, by wallet)
relayer_jobs ── independent (no FK into money tables; payload carries ids)
recon_daily ── one row per UTC day (derived, never authoritative)
```

## Lifecycle: purchases (the §7.2 rule-2 machine)

```text
PENDING ──record payment──▶ PAID ──IncomeSettled observed & read back──▶ SETTLED
   │                            │
   │                            └──settlement impossible (terminal deal, bad fact)──▶ FAILED
   └─ (any state) rows never deleted; transitions never edited — append-only log
```

- PENDING → PAID: authenticated transition call (MITA key), logged with actor.
- PAID → SETTLED: ONLY the watcher, on an `IncomeSettled` log matching (channel, purchaseRef), after the isas cache is refreshed from `isaOf()` (FR-009 read-back).
- → FAILED: settlement attempt failed terminally onchain (e.g., deal no longer Active); reason recorded.
- Skips and regressions rejected + logged; duplicates no-op via the UNIQUE (channel_id, purchase_ref) and the webhook event-id lock.

## Lifecycle: relayer_jobs

```text
pending ──claim (FOR UPDATE SKIP LOCKED)──▶ [execute] ──broadcast──▶ sent
sent ──receipt + onchain read-back ok──▶ confirmed
sent ──revert/read-back miss──▶ (backoff retry, attempts++) ──attempts exhausted──▶ sent + terminal_at set  (= failed, visible)
```

One job in flight per key at all times (research D5/D6).
