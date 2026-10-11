# Data Model: Invisible Account — Mera Passkey Onboarding (Feature 006)

**Input**: spec.md Key Entities · research D5, D6, D7, D12

**Headline**: 006 adds **no tables and no columns** (research D12). Everything the feature
keeps is device-local; everything it shows is derived at read time from the chain and the
005 schema. This file defines the device-local shapes, the derived state, and the DTOs.

---

## 1. Server schema (unchanged — consumed read-only)

| Table (005) | 006 usage | Mode |
|--------------|-----------|------|
| `drips` (wallet PK) | read: has this wallet been dripped? (`dripped` read-back) | READ |
| `relayer_jobs` | written only by the relayer itself, via the jobs 006 enqueues through it | indirect |
| `users`, `isas`, `purchases`, … | untouched; `users` stays dormant (activator: Feature 007) | — |

## 2. Device-local entities (browser storage — never synced, never in git)

### 2.1 SignupData *(localStorage, per device)*

| Field | Type | Rules |
|-------|------|-------|
| phone | string | local format as typed (leading zero); no international coercion (FR-002); display-only |
| locale | `"id" \| "ms"` | catalog selector; demo personas pinned by manifest (D5) |

Lost on device loss — acceptable, R5-adjacent (spec Edge Cases). No server copy exists.

### 2.2 SessionBlob *(localStorage — the refresh-survival artifact, research D7)*

| Field | Type | Rules |
|-------|------|-------|
| wallet | `0x…` (EIP-55) | the account the message names |
| until | integer (unix seconds) | `issuedAt < until ≤ issuedAt + 7d` — enforced at signing; `now < until ≤ now+7d+60s` at verification (auth-session.md) |
| sig | `{v, r, s}` | signature over the frozen message `Sign in to Kite\n<wallet>\nuntil <until>` |

Lifecycle: created at login → survives refresh while valid → destroyed at sign-out or
routed to sign-in when the server returns `session_expired`/`session_invalid` (FR-010).
The signing key is NOT persisted — only the signature proof is.

### 2.3 DemoPersona *(IndexedDB — demo phones only, research D5)*

| Field | Type | Rules |
|-------|------|-------|
| persona | `"budi" \| "pakhaji"` | set by demo-prep; selects the demo-derivation mode (labeled) |
| vaultCiphertext | bytes | Mera secret vault wrapping the seeded key; decryptable only by this device's passkey ceremony; **never leaves the device** (FR-011 hygiene) |
| displayName | string | from the demo manifest ("Budi · Ngawi"), never a server table (D5) |

## 3. Derived state (computed at read time — never stored)

| State | Derivation | Consumer |
|-------|------------|----------|
| identityBound | `identityOf(wallet) != 0` (chain, via apps/api) | verification GET, Home readiness (FR-004/006) |
| dripped | `drips` row exists for wallet | verification GET, Home readiness (FR-005) |
| ready | `identityBound && dripped` (both read-backs green) | Home gate (FR-006) |
| identityHash | `keccak256("kite-demo-v1" ‖ keccak(ktpBytes) ‖ keccak(selfieBytes) ‖ wallet)` — computed client-side once per verification (D6) | verification POST |

## 4. DTOs (wire — full grammar in contracts/)

### 4.1 `GET /api/me/verification` → 200

```json
{ "identityBound": true, "dripped": false }
```

### 4.2 `POST /api/me/verification` ← `{ "identityHash": "0x…64hex" }`

→ 200 (idempotent — deterministic clientRefs make replays return the same jobs):

```json
{ "identityBound": false, "dripped": false, "enqueued": ["bind_identity", "drip"] }
```

422 `identity_hash_invalid` on malformed hash. 401 per auth-session.md. No other
user-data fields exist on either route (FR-002: no persistence).

### 4.3 Session header (request), see [contracts/auth-session.md](contracts/auth-session.md)

```text
x-kite-session: 0xWallet…|1730000000|27|0xr…|0xs…
```

## 5. Validation rules summary

- `identityHash`: exactly `0x` + 64 hex chars — validated server-side before enqueue.
- `until`: integer, seconds; server clamps validity per §2.2; > 7-day windows rejected.
- `wallet`: EIP-55 checksum in the message; comparison is address-equality after recovery.
- No float ever reaches storage or wire (constitution VI); display conversions happen in
  the UI from `/api/quote` locks and are never stored.

## 6. State transitions (session)

```text
absent --login(ceremony)--> valid --refresh--> valid
valid --server 401 expired--> routed-to-sign-in
valid --sign-out--> destroyed (blob wiped, session ended; passkey untouched)
expired-window --any authenticated call--> 401 --> routed-to-sign-in
```
