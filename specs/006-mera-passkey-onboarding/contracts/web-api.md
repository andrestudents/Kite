# Contract: Web ↔ API (Feature 006 delta)

**Layers on**: 005's `specs/005-backend-api-relayer/contracts/http-api.md` (routes,
response shapes, money-as-integral-JSON, error envelope). This file records only 006's
deltas. 005's docs are not edited (research D13).

---

## 1. `/api/me` (delta: caller identity)

Response shape: **unchanged** from 005 (balanceAusd, profile, activeIsa,
recentPurchases — integral JSON numbers).

Caller identity: `x-kite-session` per [auth-session.md](auth-session.md) replaces the
bare `x-kite-wallet` header. 005's quickstart curl examples for `/api/me` are superseded
by:

```bash
curl -s "$API/api/me" -H "x-kite-session: 0xW…|1730000000|27|0xr…|0xs…"
```

(A session can be minted for testing with any throwaway viem account signing the frozen
message — see quickstart §3.)

## 2. `GET /api/me/verification` (new — user-scoped)

- **Auth**: session ([auth-session.md](auth-session.md)).
- **Response 200**:

```json
{ "identityBound": true, "dripped": false }
```

- `identityBound` — chain read-back: `identityOf(wallet)` is set (constitution IV).
- `dripped` — the 005 one-time lock row exists for this wallet.
- No other fields; no user-data fields exist on this route (FR-002).

## 3. `POST /api/me/verification` (new — user-scoped trigger)

- **Auth**: session.
- **Request**: `{ "identityHash": "0x…64 hex chars" }` — the client-side derivation per
  data-model §3 (003's hash-of-identity-material pattern; demo documents never leave the
  device).
- **Effect**: enqueues the **existing** 005 relayer jobs `bind_identity
  {wallet, identityHash}` and `drip {wallet}` server-side (INTERNAL key stays
  server-side — research D4) with deterministic clientRefs `bind-<wallet>` /
  `drip-<wallet>`: replay returns the same jobs (idempotent), duplicates collapse on the
  queue and the `drips` PK exactly as 005 defined.
- **Response 200** (idempotent):

```json
{ "identityBound": false, "dripped": false, "enqueued": ["bind_identity", "drip"] }
```

- **Errors**: `422 identity_hash_invalid` (malformed hash) · `401` per auth-session.md ·
  `503 relayer_unreachable` (enqueue failed; safe to retry — same clientRefs).
- The route writes **no** user data; it is a stateless trigger plus read-backs.

## 4. `/api/quote`, `/api/p/:id`, `/api/health` (unchanged, public)

The web app consumes them exactly as 005 defined. The credit passport `/api/p/:id`
MUST stay reachable with no session header (auth-domain table, row Public).

## 5. Relayer `/jobs` (unchanged, INTERNAL)

The browser never calls the relayer. All enqueues from the app flow through the
verification trigger; the INTERNAL key exists only in server env.

## 6. Client rules

- Money: integral base units to the wire, always; IDR/MYR rendering multiplies by the
  locked quote's `rate / 10^scale` in the UI only (constitution VI).
- Banned words: no route's human-readable string values may contain them (005's D18
  payload rule carries to the new routes; the web catalogs are scanned separately).
- Timeouts: the app polls `GET /api/me/verification` at a gentle interval (≥ 2 s) until
  `identityBound && dripped`, with a plain-language retry — never a dead end (US1-AC5).
