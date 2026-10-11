# Interface Contract: HTTP API + Relayer Jobs (Feature 005)

**Consumers**: the mobile app (Feature 006+), the Mitra console (web feature), CRE WF-1 (orchestration feature), the quickstart gate scripts.
**Authority**: the contract onchain is the only authority (constitution IV); every read endpoint reflects chain state or a projection correctable by it. Money values are integral JSON numbers in AUSD base units (D14). Errors: `{ "error": { "code": string, "message": string } }` with proper HTTP status; no stack traces, no key material, ever.

Auth (research D11): `x-api-key: $MITA_API_KEY` on **all purchase routes** (`POST /api/channel/purchases`, `GET /:id`, `POST /:id/paid`); `x-api-key: $INTERNAL_API_KEY` on relayer `/jobs` **only**; constant-time compare, 401 on mismatch. `/api/me` identifies the caller via `x-kite-wallet: 0x…` (demo identity, swappable for Mera sessions).

*Decision record (do not relitigate)*: the mill's console authorizes its own payment lifecycle — intent, validation read, and the paid transition are one caller's fact-flow, already evidenced by the mill signature captured at creation — so one MITA key owns all three purchase routes. INTERNAL is the relayer worker's key and mutates nothing in the registry; WF-1 (later feature) gets its own key rather than reusing either.

## apps/api routes

### GET /api/health — FR-001
```json
{ "status": "ok" | "degraded",
  "db":   { "ok": true,  "detail": "…" },
  "rpc":  { "ok": true,  "chainId": 10143, "blockNumber": 7412 },
  "time": "2026-10-10T09:00:00Z" }
```
Never a false ok: each dependency is probed; a failure flips both its entry and `status`.

### GET /api/quote?pair=USD_IDR|USD_MYR — FR-002
```json
{ "pair": "USD_IDR", "rate": 16000, "scale": 0,
  "expiresAt": "2026-10-10T09:00:58Z", "source": "demo-fixed" }
```
Default pair `USD_IDR`. Inside the 60 s TTL the same locked row is returned; unknown pair → 400 `unknown_pair`. Display-only (constitution VI/VIII).

### GET /api/me — FR-003 (header `x-kite-wallet`)
```json
{ "wallet": "0x…",
  "balanceAusd": 1200000000,
  "identityBound": true,
  "profile": { "score": 58, "maxSupportAusd": 1296000000,
               "totalIsas": 2, "completed": 2, "qualEvents": 4, "distinctBackers": 2 },
  "activeIsa": { "isaId": 3, "backer": "0x…",
                 "principalAusd": 600000000, "shareBps": 2000, "capMult": 130,
                 "capAusd": 780000000, "remainingAusd": 480000000,
                 "progressBps": 3846, "termEnd": 1794270000, "channelId": 1 },
  "recentPurchases": [ { "purchaseRef": "0x…", "grossAusd": 1500000000,
                         "status": "SETTLED", "txHash": "0x…",
                         "settledAt": "2026-10-10T08:59:11Z" } ] }
```
Chain-authoritative fields (`activeIsa.*`, `profile.*`, `balanceAusd`) are read from the proxy in this feature. Empty state (no history): valid 200 with `score 0`, `maxSupportAusd 600000000`, `activeIsa: null` — never an error. Missing/invalid header → 400.

### GET /api/p/:id — FR-004 (`:id` = identityHash or wallet, D12)
```json
{ "id": "0x<identityHash>", "wallet": "0x…",
  "reputation": { "score": 91, "completedDeals": 3, "qualEvents": 7 },
  "deals": [ { "isaId": 3, "principalAusd": 600000000, "shareBps": 2000,
               "capAusd": 780000000, "totalDivertedAusd": 780000000,
               "status": "completed_capped",
               "events": [ { "grossAusd": 1500000000, "toBackerAusd": 180000000,
                             "toSeekerAusd": 1320000000, "remainingAusd": 0,
                             "txHash": "0x…", "blockTime": "2026-10-10T08:59:11Z" } ] } ],
  "explorerBaseUrl": "https://testnet.monadscan.com" }
```
NO personal-data fields exist in this shape (name/phone/documents — asserted by unit test D18). Unknown id → 404 `profile_not_found` (identical shape for never-existed and once-existed).

### POST /api/channel/purchases — FR-005 (MITA key)
```json
{ "channelId": 1, "isaId": 3,
  "purchaseRef": "0x<bytes32>", "grossAusd": 1500000000,
  "millSig": { "salt": "0x<bytes32>", "v": 27, "r": "0x<bytes32>", "s": "0x<bytes32>" } }
```
`millSig` is the mill's EIP-712 signature over `IncomeEvent(uint64 channelId, uint256 isaId, bytes32 purchaseRef, uint256 gross, bytes32 salt)`, domain `("KiteCore","1",10143,proxy)` — the exact `SignIncome.s.sol` encoding (D8). Responses: `201` `{purchase}` · identical duplicate → `200` with the same purchase (idempotent) · ref reuse with different payload → `409 purchase_ref_conflict` · non-integer money → `422 money_must_be_integer` · unknown channel/isa → `422` · bad auth → `401`.
The purchase DTO everywhere: `{ id, channelId, isaId, purchaseRef, grossAusd, status, txHash, createdAt, settledAt }`.

### GET /api/channel/purchases/:id — FR-006 (MITA key)
`200 {purchase}` · `404 purchase_not_found`. This is the WF-1 validation read (later feature).

### POST /api/channel/purchases/:id/paid — FR-007 (MITA key)
`200 {purchase}` (now PAID, transition logged) · `409 invalid_transition` when not PENDING.

## Settlement path (not an HTTP route)

`apps/api/src/jobs/submit-settlement.ts` — **Demo Tool** (research D8): loads the purchase's stored `millSig`, submits `receiveIncome(isaId, purchaseRef, gross, salt, v, r, s)` signed+paid by `ORCHESTRATOR_KEY` at the published gas limit; a terminal revert (deal no longer Active) marks the purchase FAILED with its reason. Observation is chain-driven (the same processing pass runs in-process — no separate watcher process required): the watcher (D9) sees `IncomeSettled(isaId, channelId, purchaseRef, gross, toBacker, toSeeker, remaining, qualifying)`, claims it via `webhook_events`, flips the matching PAID purchase to SETTLED (`tx_hash`, `settled_at`), writes ledger rows (`in channel:<id> gross`; `out backer:<addr> toBacker`; `out seeker:<addr> toSeeker`), refreshes the `isas` cache from `isaOf()`. CRE WF-1 replaces the submitter, not this registry.

## apps/relayer API (INTERNAL key)

### POST /jobs — FR-015
```json
{ "kind": "transfer_with_authorization",
  "payload": { … kind-specific, below … },
  "clientRef": "send-0x…-1719000000" }
```
→ `202 {jobId}` · duplicate `clientRef` → `200` with the existing job (idempotent enqueue) · unknown kind → `400 unknown_kind` · bad auth → `401`.

### GET /jobs/:id → `200 { id, kind, status, attempts, txHash, lastError, terminalAt }`

### Job kinds + payloads + onchain read-back (FR-016, research D7) — `kind` wire values are snake_case; FR-015's camelCase names the contract functions

**uint256 wire contract:** every uint256 payload field (`valueAusd`, `validAfter`, `validBefore`, `isaId`, `deadline`) travels as a **decimal string** (`"1500000"`) — JSON numbers cannot carry a uint256 losslessly, and `JSON.stringify` refuses BigInt outright. The relayer is the parse/validate edge (`requireUint`): digits-only strings and small integral numbers are accepted, everything else → `400 bad_request`; the handler receives an exact `bigint`. Raw BigInt in a payload is rejected (it cannot survive jsonb serialization). `v` (uint8) may arrive either way. Money remains integers in AUSD base units (constitution VI) — a decimal string of digits is an integer, never a float.

| kind | payload | tx (submitter: relayer key) | read-back before `confirmed` |
|---|---|---|---|
| `activate_with_permit` | `{isaId, deadline, v, r, s}` — backer's ERC-2612 permit over `("AUSD","1",10143,ausd)` (exact `SignPermit.s.sol` encoding) | `activateWithPermit(isaId, deadline, v, r, s)` @ `KITE_GAS_LIMITS.activateWithPermit.fixedLimit` | `isaOf(isaId).status == 2` (Active) |
| `transfer_with_authorization` | `{from, to, valueAusd, validAfter, validBefore, nonce, v, r, s}` — sender's EIP-3009 sig over `TransferWithAuthorization(…)` (same AUSD domain) | `transferWithAuthorization(…)` @ `MOCK_AUSD_GAS_LIMITS.transferWithAuthorization.fixedLimit` | receipt logs parse to AUSD `Transfer(from, to, value)` |
| `bind_identity` | `{wallet, identityHash}` | `bindIdentity(wallet, identityHash)` @ `bindIdentity` limit | `identityOf(wallet) == identityHash` |
| `drip` | `{wallet}` | native MON transfer (fixed 21k-class limit) | `getBalance(wallet)` increased; `drips` PK guarantees once |

Sender of `transfer_with_authorization` / `activate_with_permit` needs **zero MON** (their signature is the authority — FR-016). Every tx carries `gas: fixedLimit` from `@kite/contracts` (gas is charged on the limit on Monad — D10). Execution: one job at a time per key, claim via `FOR UPDATE SKIP LOCKED`, nonce resync from `eth_getTransactionCount(relayer,'pending')` before each send, retries with capped backoff, receipt ≠ success (D5–D7).

## CLI jobs (bun scripts — the quickstart gates call these)

| command | behavior | exit codes |
|---|---|---|
| `bun run apps/api/src/jobs/watch-settlements.ts` | poll `IncomeSettled` from checkpoint; process idempotently; refresh cache; run until SIGINT | 0 on clean stop |
| `bun run apps/api/src/jobs/submit-settlement.ts --purchase <id>` | Demo Tool submit (above); runs the watcher pass in-process until SETTLED (no separate watcher process); terminal revert → FAILED + reason | 0 settled · 1 failed |
| `bun run apps/api/src/jobs/recon.ts [--day YYYY-MM-DD]` | D16: backend Σ vs chain Σ over the UTC day (post-baseline); writes `recon_daily` | 0 ok · 1 mismatch (row written) · 2 infra (no row) |
| `bun run scripts/gates/gasless-send.ts` | SC-001 end-to-end assert | 0/1 |
| `bun run scripts/gates/purchase-settled.ts` | SC-002 end-to-end assert | 0/1 |
| `bun run scripts/gates/recon.sh` | SC-003: clean run + forced mismatch + cleanup | 0/1 |

## Constitutional payload rules (unit-tested, D18)

- Every monetary value is an integer in AUSD base units (constitution VI): response DTOs carry integral JSON numbers; relayer JOB PAYLOADS carry uint256 as decimal strings, parsed/validated at the relayer edge (see the uint256 wire contract above). No float anywhere.
- No human-readable string emitted by `/api/me`, `/api/p/:id`, `/api/quote` contains a banned word (wallet, gas, chain, token, onchain transaction, seed, pending) — `status` values use uppercase machine states (`SETTLED`), which are data, not copy; screen copy arrives with the web feature.
- `/api/p/:id` has no personal-data fields, structurally.
- Nothing in any response echoes key material or env values.
