# Contract: Auth Session (Feature 006)

**Supersedes/extends**: 005's http-api.md auth section (F1 decision record) — this file
is now the **single auth-domain record**. 005's MITA/INTERNAL ownership is restated
verbatim below, not changed.

**Spec basis**: FR-007 (clarified 2026-10-10), FR-008..FR-010; research D3, D4.

---

## 1. The frozen session message

The signed message is EXACTLY (UTF-8, `\n` line breaks, wallet in EIP-55 checksum,
`<until>` decimal unix seconds — no padding, no extras):

```text
Sign in to Kite
0xWalletChecksummedAddress
until 1730000000
```

Line 1 is the literal string `Sign in to Kite`. Any change to this format is a breaking
contract change — it is frozen by clarification and must not drift.

### 1.1 Digest construction (pinned — client and server in lockstep)

The 32-byte digest that `signDigest` signs is the EIP-191 `personal_sign` hash of the
exact §1 message:

```text
digest = keccak256( 0x19 ‖ utf8("Ethereum Signed Message:\n" ‖ len) ‖ utf8(message) )
```

- `len` = the decimal ASCII rendering of the message's **UTF-8 byte length** (the
  frozen message is pure ASCII, so bytes == chars, but the rule is byte length).
- **Client**: `digest = hashMessage(message)` (viem — computes exactly the formula
  above); `sig = session.signDigest(digest)` — mera signs these 32 bytes **as-is**
  (no re-hash); wire `v = 27 + sig.recovery`, `r = 0x` + hex(`sig.compact[0..32]`),
  `s = 0x` + hex(`sig.compact[32..64]`) (`compact` is low-S normalized — EIP-2).
- **Server**: `recoverMessageAddress({ message, signature: {v, r, s} })` (viem) —
  re-derives the same digest via the same formula and ecrecovers locally (no RPC).
- Both sides delegate to viem's `hashMessage`; the formula is written down so any
  non-viem implementation (or a future digest change) stays in lockstep — changing it
  is a breaking contract change, same as §1.

## 2. Wire encoding (request header)

```text
x-kite-session: <wallet>|<until>|<v>|<r>|<s>
```

- `wallet`: `0x` + 40 hex, EIP-55 (must equal the address recovered from the signature)
- `until`: decimal integer, unix seconds
- `v`: 27 or 28 (decimal)
- `r`, `s`: `0x` + 64 hex each
- Separator: the literal pipe `|`; no whitespace inside the value

The legacy `x-kite-wallet` header is **not accepted** on user-scoped routes once 006
lands — identity is recovered from the signature, never asserted (clarification Q2).

## 3. Verification algorithm (apps/api session middleware)

1. Parse the header per §2; malformed → `401 session_invalid`.
2. Rebuild the message per §1; recover the address (`recoverMessageAddress` — local
   ecrecover, no RPC call).
3. Require `recovered == declared wallet` (address equality) → else `401 session_invalid`.
4. Require `now < until` → else `401 session_expired`.
5. Require `until ≤ now + 7d + 60s` (skew allowance) → else `401 session_invalid`.
6. Attach `wallet` to the request context; the route treats it as the caller.

Bearer-token limitation (disclosed in TRUST.md): the signature is replayable by anyone
who holds it, within its window — acceptable for MVP; nonce binding is roadmap.

## 4. Error shapes

```json
{ "error": { "code": "session_invalid", "message": "…" } }
{ "error": { "code": "session_expired", "message": "…" } }
```

Both are HTTP 401; the app routes either code to sign-in (FR-010) — the distinction is
for logging, not for different UX.

## 5. The auth-domain table (single record)

| Auth domain | Routes | Auth |
|-------------|--------|------|
| User-scoped | `/api/me`; `GET`/`POST /api/me/verification` (006) | Signed session (this contract): address recovered from signature, expiry ≤ 7 days, else 401 |
| Public | `/api/p/:id`, `/api/health`, `/api/quote` | None — MUST remain open (the credit passport is a public artifact); never auth-gated |
| Service-keyed | purchase registry routes (MITA key) · relayer `/jobs` (INTERNAL key) | 005's key domains, unchanged (decision record: the mill's console authorizes its own payment transitions — intent, validation read, and the paid transition are one caller's fact-flow; INTERNAL is the relayer worker's key) |

*Route-set note (plan-time, research D4)*: the user-scoped domain gained the verification
endpoints because the browser cannot hold the INTERNAL key; those routes store no user
data (users table dormant) and enqueue only the existing job kinds with deterministic
clientRefs — the "read-only against user data" clarification is preserved.

## 6. Named conformance tests (mandatory, FR-007)

1. expired session → 401 `session_expired`
2. tampered signature → 401 `session_invalid`
3. valid session → 200 with the correct recovered identity
4. `/api/p/:id` → 200 with no session header (public domain intact)
5. MITA purchase route → unaffected by the middleware (service domain intact)
