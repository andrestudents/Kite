# Research: Mera docs map — pre-implementation verification (Feature 006)

**Date**: 2026-10-11 · **Docs**: mera.category.xyz (all pages fetched live this date)
**SDK**: `@category-labs/mera` **0.2.0** (npm `latest`; runtime deps are only `@scure/base`,
`@noble/curves`, `@noble/hashes`; optional peers `viem` ^2.28.0, `react-native-passkey`).
**Method**: every Mera-dependent claim in `spec.md` / `contracts/auth-session.md` /
`tasks.md` mapped to a fetched doc page; API signatures copied from the reference pages.

## Verdict

**No MISSING rows. All 7 required rows VERIFIED.**
Rows 1–3 are VERIFIED *with precision notes* (derivation is app-side; no built-in session
TTL; vault APIs exactly match FR-011 Option B) — the notes are folded into tasks.md
(T002/T005/T011/T017/T023/T024). Rows 4–7 clean. **T001 may start; the FR-011 fallback
ladder's first rung (Mera vault) is confirmed to exist.**

## Sources (fetched 2026-10-11)

| Page | URL |
|---|---|
| Getting started (incl. embedded API reference) | https://mera.category.xyz/getting-started/ |
| Concepts: Passkey accounts | https://mera.category.xyz/concepts/passkey-accounts/ |
| Concepts: Passkeys and the PRF extension | https://mera.category.xyz/concepts/passkeys-and-prf/ |
| Concepts: Signing sessions | https://mera.category.xyz/concepts/signing-sessions/ |
| Concepts: Secret vaults | https://mera.category.xyz/concepts/secret-vaults/ |
| Concepts: Security model | https://mera.category.xyz/concepts/security-model/ |
| Recipe: Create passkey accounts | https://mera.category.xyz/recipes/create-passkey-accounts/ |
| Recipe: Encrypt an existing secret with a passkey | https://mera.category.xyz/recipes/use-an-existing-secret/ |
| Authenticator support | https://mera.category.xyz/authenticator-support/ |
| Ref: createPasskeyWithPrfOutput | https://mera.category.xyz/reference/create-passkey-with-prf-output/ |
| Ref: getPasskeyPrfOutput | https://mera.category.xyz/reference/get-passkey-prf-output/ |
| Ref: createSecp256k1SigningSession | https://mera.category.xyz/reference/create-secp256k1-signing-session/ |
| Ref: Secp256k1SigningSession | https://mera.category.xyz/reference/secp256k1-signing-session/ |
| Ref: getEvmAddress | https://mera.category.xyz/reference/get-evm-address/ (signature verified via getting-started + create-passkey-accounts recipe) |
| Ref: createSecretVaultWithNewPasskey | https://mera.category.xyz/reference/create-secret-vault-with-new-passkey/ |
| Ref: createSecretVaultWithExistingPasskey | https://mera.category.xyz/reference/create-secret-vault-with-existing-passkey/ |
| Ref: decryptSecretVaultWithPasskey | https://mera.category.xyz/reference/decrypt-secret-vault-with-passkey/ |
| Ref: Secret vault format | https://mera.category.xyz/reference/secret-vault-format/ |
| npm | https://registry.npmjs.org/@category-labs/mera/latest |
| PLAN.md | lines 30, 32–33, 110, 370 (bounty table, D3, stack table) |

---

## Row 1 — Passkey signup → derived EOA — **VERIFIED (with correction: derivation is app-side)**

**Claim (spec FR-001, T005/T011)**: one passkey ceremony yields a plain EOA address.

**Docs**: `createPasskeyWithPrfOutput({ rp: {id, name}, user: {name, displayName},
timeout?, prfSalt?, webAuthnClient? })` → `{ credentialId (canonical unpadded
base64url), transports?, prfOutput: Uint8Array (always 32 bytes) }`. One creation
ceremony, one user-verification prompt (authenticators that don't evaluate PRF at
creation run one fallback assertion → second prompt). Fixed params: ES256/RS256,
attestation "none", resident key required, UV required. Fresh 32-byte user handle per
call → adds a passkey, never replaces one.

**Correction folded into tasks**: mera does **not** derive accounts. The recipe's
app-side chain (our exact path, `m/44'/60'/0'/0/0`):
`prfOutput` → `entropyToMnemonic(prfOutput, wordlist)` → `mnemonicToSeedSync(mnemonic)`
→ `HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0").privateKey` — requires
**`@scure/bip32` + `@scure/bip39`** (recipe prerequisites; added to T002).

**Address exposure**: `getEvmAddress(publicKey: Uint8Array): EvmAddress` — "Derives the
EIP-55 checksummed EVM address for a secp256k1 public key"; accepts compressed or
uncompressed; call as `getEvmAddress(session.publicKey)` (65-byte uncompressed).
`createSecp256k1SigningSession` and `getEvmAddress` are **synchronous** — the address is
available immediately after the one ceremony, no further prompt.

**Returning user**: `getPasskeyPrfOutput({ rpId, credential?, prfSalt?, timeout?,
webAuthnClient? })` → `{ credentialId, prfOutput }`. Default salt is
`sha256("mera.prf.salt.v1")` and "will not change across library versions"; "The PRF
output is a deterministic function of the credential, rpId, and salt" → same bytes →
same derivation → same address on every device the passkey syncs to. Credential
pinning (recipe "Remember the credential"): store `{credentialId, transports}` at
create time, pass back as `credential` so the browser reuses the same passkey instead
of offering a chooser (folded into T017).

---

## Row 2 — Signing session vs frozen message + 7-day max — **VERIFIED**

**Claim (spec FR-007, contracts/auth-session.md)**: message exactly
`Sign in to Kite\n<wallet>\nuntil <unix>`, signed by the passkey account, ≤ 7-day
validity, middleware ecrecovers locally.

**Docs** (`/concepts/signing-sessions/`, `/reference/secp256k1-signing-session/`):
- `createSecp256k1SigningSession({ privateKey: Uint8Array(32, valid scalar) })` —
  **synchronous**; copies the key into a session-owned snapshot.
- `session.signDigest(digest32: Uint8Array): Promise<Secp256k1Signature>` — "Signs a
  32-byte digest **without prehashing it**" → `{ compact: Uint8Array(64) /* r||s */,
  low-S (s in lower half of curve order), recovery: 0|1 }`.
- `session.publicKey` — 65-byte uncompressed (0x04 prefix).
- `session.end()` — "Zeroes the session-owned private-key copy and permanently ends the
  session; later signing throws SESSION_ENDED". `[Symbol.dispose]()` → `using` support.

**Compatibility**: exact. We hash the frozen message ourselves (viem `hashMessage` =
EIP-191 → 32-byte digest), feed it to `signDigest`, split `compact` into r‖s and set
`v = 27 + recovery`. Low-S is standard EVM (EIP-2); server-side
`recoverMessageAddress` round-trips. mera never sees or constrains the message.

**Expiry/transport**: the session is **in-memory only** ("doesn't contact an
authenticator" per signature; one UV ceremony to create, then signing is prompt-free)
and has **no built-in TTL** — "Session lifetime is a trade-off between that prompt and
the open window". Our 7-day `until` is purely application-level; zero conflict.
Sessions do **not survive page reload** — a reload means one new ceremony (via
`getPasskeyPrfOutput`) to re-derive + re-sign. That is consistent with SC-001's ~10 s
return visit (one biometric prompt) and with FR-008 (refresh keeps the *stored signed
blob*, not a live session). `toViemAccount` exists if ever needed; not required for the
header signing.

---

## Row 3 — PRF key material: wrap externally-provided key material? — **VERIFIED (Option B exactly as spec'd)**

**Claim (spec FR-011)**: passkey-wrapped seeded keys — wrap once, unwrap via passkey
ceremony, signing session over the persona's exact address.

**Docs**: secret vaults are the documented mechanism for exactly this ("Vaults cover
the cases where key material must come from outside the passkey"):

- `createSecretVaultWithNewPasskey({ rp: {id, name}, user: {name, displayName},
  secret: Uint8Array, timeout?, webAuthnClient? }): Promise<PasskeySecretVault>` —
  creates the passkey AND encrypts `secret` ("Any non-empty length", "opaque to the
  library" — raw private-key bytes are the documented case: "A private key is encrypted
  the same way: pass its raw bytes as `secret`").
- `createSecretVaultWithExistingPasskey({ rpId, credential?, secret, timeout?,
  webAuthnClient? }): Promise<PasskeySecretVault>` — one assertion ceremony; can pin a
  `credential`.
- `PasskeySecretVault = { version: 1, credential: { credentialId, transports? },
  prfSalt, nonce, ciphertext }` — JSON-safe, base64url fields; AES-256-GCM (12-byte
  nonce, 16-byte auth tag appended); **fresh random 32-byte PRF salt per vault** ("The
  salt is not secret"); encryption key = PRF output for that salt; rpId deliberately
  not stored.
- `parseSecretVault(value: unknown): PasskeySecretVault` — "the boundary for the
  untrusted stored JSON": only version 1, validates base64url + lengths, drops unknown
  fields; throws `VAULT_FORMAT_INVALID`.
- `decryptSecretVaultWithPasskey({ rpId, vault, timeout?, webAuthnClient? }):
  Promise<Uint8Array>` — one assertion ceremony, **automatically pinned to the
  credential stored in the vault**; returns the secret in a fresh allocation;
  `DECRYPT_FAILED` on any tampering (AES-GCM auth).
- The app stores the vault itself (docs: localStorage in the recipe, "a backend or sync
  service works the same") — our IndexedDB per-device choice matches
  (data-model §2.3). Recipe hygiene pattern adopted in T023: `try { … } finally {
  secret.fill(0) }`.

**So**: the PRF output is *not* forced to be the key. Both models coexist and we use
both — passkey accounts (PRF → BIP-39/BIP-32 derivation) for judge fresh signups, and
vaults wrapping externally-provided keys for demo personas. **No mechanism change; no
ladder descent.**

---

## Row 4 — Known-EOA import — **VERIFIED unsupported (matches clarify decision)**

**Claim (spec Facts)**: "an existing EOA private key cannot be imported into a
passkey-derived account."

**Docs** (`/concepts/passkey-accounts/`): "Passkey accounts are rooted in the passkey
itself, so an account that predates the passkey cannot become one. The app can instead
lock the existing secret to the passkey with a secret vault."

---

## Row 5 — Server components / API keys / allowlists — **VERIFIED none required**

**Claim (spec stack assumptions; PLAN line 370 "Client-side library, no contract, no
API key")**.

**Docs** (`/concepts/security-model/`): no servers, backends, custody services, API
keys, allowlists, or registration are mentioned anywhere. "The only runtime
dependencies are `@noble/*` and `@scure/*`, well-known audited cryptography
libraries." The trust boundary is app + mera + authenticator; the only domain concept
is the WebAuthn rpId. Prerequisites (getting-started): HTTPS secure context (or
`localhost` in dev) + a PRF-capable authenticator. npm deps echo this exactly.

---

## Row 6 — Phone support matrix (demo devices) — **VERIFIED**

**Docs** (`/authenticator-support/`, table current through 2026-06):

| Demo device | Authenticator | PRF |
|---|---|---|
| iPhone, Safari (our iOS demo) | iCloud Keychain | ✓ since iOS 18 (2024-09) |
| iPhone, Chrome | iCloud Keychain | ✓ iOS 18+ (all iOS browsers use iCloud Keychain) |
| Android, Chrome (our Android demo) | Google Password Manager | ✓ "Known by 2026-06" |
| Fallback either platform | 1Password | ✓ any browser since 2.26.1 beta / Android 8.10.38 beta (2024-07) |

Known NOT PRF-capable as of 2026-06-01: Chrome profile passkeys (desktop), Bitwarden,
Dashlane — useful diagnostics if T005 reports `PRF_UNAVAILABLE` on a borrowed device.
Native apps (not our path): iOS 18+, Android 9+.

---

## Row 7 — Mera UX bounty "stateless test" — **VERIFIED (build-toward list already satisfied by design)**

**PLAN.md line 32**: "Mera: Best Mera-Powered UX | $2.5k | **Mera is the whole account
layer, stateless test** | Passkey signup, signing sessions, no seed phrase, no
extension, no custody backend (D3)". D3 (line 110): "Mera passkey derives a plain EOA;
a signing session makes in-app actions prompt-free; the relayer drips MON for fees
after verification."

Docs confirm every named element: passkey signup = row 1; signing sessions = row 2;
no custody backend = row 5; no seed-phrase UI / no extension = client-side ceremonies
only. Our architecture additionally aligns with "stateless": the `x-kite-session`
header is self-verifying (no server session store) and the users table stays dormant —
nothing server-side is required for the fresh-signup path. Line 33's second Mera
bounty (One Passkey, Many Keys / PRF) remains Q5-flagged, out of 006 scope.

---

## Implementation notes (beyond the 7 rows)

- **RP-ID stickiness (T004)** — docs make it absolute: "A passkey works only under the
  rpId it was created for: after a domain migration, passkey accounts can no longer be
  reproduced and vaults can no longer be decrypted." Fix the demo domain before ANY
  ceremony, as T004 says.
- **UV is required and not configurable** — every ceremony (`create…`, `get…`,
  `decrypt…`) shows exactly one user-verification prompt; CTAP hmac-secret keeps two
  PRFs per credential but "WebAuthn exposes only the user-verified PRF".
- **Zeroing** — "mera zeroes every sensitive buffer it allocates after it no longer
  needs it"; caller-provided buffers are the caller's job (hence the `finally
  fill(0)` pattern for decrypted persona keys); "a defense-in-depth measure, not a
  guarantee" (TRUST.md wording should stay modest).
- **Error codes** (for the T005 gate's diagnostics): `PRF_UNAVAILABLE`,
  `INPUT_INVALID`, `CRYPTO_UNAVAILABLE`, `PASSKEY_OPERATION_FAILED`, `SESSION_ENDED`,
  `VAULT_FORMAT_INVALID`, `DECRYPT_FAILED`.
- **Version pin** — 0.2.0 today; default PRF salt is stable across library versions,
  but pin exact anyway (T002) so derivation never moves under us.

## Corrections folded into tasks.md (this pass)

1. **T002**: added `@scure/bip32` + `@scure/bip39` (pinned exact) — mera does not
   derive accounts; recorded 0.2.0 as current.
2. **T005**: steps now name the exact APIs — `createPasskeyWithPrfOutput`,
   BIP-39→BIP-32 derivation, `createSecretVaultWithNewPasskey`, `parseSecretVault` +
   `decryptSecretVaultWithPasskey`, `createSecp256k1SigningSession` +
   `getEvmAddress(session.publicKey)`.
3. **T011**: full `createAccount`/`signIn`/`signIntent` API chains (incl.
   `getEvmAddress(session.publicKey)` and `v = 27 + recovery`).
4. **T017**: credential pinning via stored `{credentialId, transports}`.
5. **T023**: `parseSecretVault` boundary + `decryptSecretVaultWithPasskey` +
   address-assert + `finally fill(0)` hygiene.
6. **T024**: wrap via `createSecretVaultWithNewPasskey`; vault JSON field shape.
