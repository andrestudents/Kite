# Quickstart: Invisible Account — Mera Passkey Onboarding (Feature 006)

**Purpose**: Validate the feature end to end with commands and device steps you can run
yourself (constitution IX). Implementation detail lives in tasks.md; wire grammar lives
in [contracts/](contracts/). Gates in execution order — §2 blocks everything (FR-011
verification-first).

---

## §0 Prerequisites

1. **Feature 005 merged and running**: `bun run dev:api` and `bun run dev:relayer` up;
   `bun run db:push` applied (shared Neon DB reachable).
2. **Fix the demo domain FIRST** (research D10, mera-docs-map "RP-ID stickiness"): the
   domain is the **final Vercel production URL** — deploy the web app (at minimum the
   T002 scaffold) and write the hostname down. Passkeys and demo vaults bind to this
   domain (RP ID) **irreversibly** (mera security model: after a domain migration,
   accounts cannot be reproduced and vaults cannot be decrypted). **No
   wrap-on-localhost-then-move**: a localhost/tunnel rpId is for throwaway ceremonies
   only — every ceremony meant to survive (§2 smoke PASS, §5 demo wraps, §6 judge flow)
   runs on the production URL. This is a gate, not a suggestion.
3. Env: root `.env` carries 005's names (RPC_URL, INTERNAL_API_KEY, MITA_API_KEY, …) plus
   `BUDI_KEY` / `PAKHAJI_KEY` (004). `apps/web/env.example` documents `VITE_API_URL`.
   Secrets are never printed (EnvMissing(<NAME>) names the variable only).
4. **Demo devices** (filming-week prep): the demo iPhone MUST be on iOS 18+ (iCloud
   Keychain is the PRF-capable authenticator — mera-docs-map row 6); the Android phone
   runs Chrome with Google Password Manager as its passkey provider. PRF-incapable
   managers (Bitwarden, Dashlane, Chrome-profile passkeys) fail §2 with
   `PRF_UNAVAILABLE`.

## §1 Setup

```bash
bun install
bun run dev:web        # Vite dev server (laptop: https://localhost with basic-ssl)
bun run typecheck && bun run lint
```

Open the app URL (the §0.2 production domain) on the real phone. Desktop is the companion view automatically.

## §2 Gate — verification-first smoke (BLOCKING: FR-011)

On the **demo phone**, open `<app-url>/smoke/index.html` (the §0.2 production domain) and run the ceremony:

1. Passkey created (PRF present — no `PRF_UNAVAILABLE`).
2. Derived address shown (deterministic — re-run shows the same address).
3. Throwaway test key wrapped into a vault, then unwrapped via the ceremony.
4. Unwrapped key's address == the test key's address.

Expected: **PASS** with each step printed. On any FAIL: **STOP — return to clarify.**
The ladder is Mera vault → own PRF-based wrap (if the platform exposes the prf
extension) → WebAuthn fallback adapter with FR-012's bounty-impact record. Nothing
downstream of this gate may be built on the vault primitive before it passes.

## §3 Gate — session middleware conformance (the five named tests)

```bash
bun test apps/api/src/middleware/session.test.ts
```

Expected: expired → 401 `session_expired` · tampered signature → 401
`session_invalid` · valid → 200 with the correct recovered identity · `/api/p/:id`
→ 200 with **no** session header · MITA purchase route unaffected.

Manual poke (mint a session with any throwaway viem account over the frozen message
`Sign in to Kite\n<wallet>\nuntil <unix>` — helper script in tasks):

```bash
curl -s "$API/api/me" -H "x-kite-session: 0xW…|1730000000|27|0xr…|0xs…"
# 200 + empty-state shape (score 0, maxSupportAusd 600000000, activeIsa null)
curl -s "$API/api/me" -H "x-kite-wallet: 0xW…"        # 401 — asserted identity rejected
curl -s "$API/api/p/<identityHash-or-wallet>"          # 200 — public domain, no session
```

## §4 Gates — vocabulary and bundle hygiene

```bash
bun test apps/web/src/locales              # banned-words scan of every id/ms catalog string
bun test apps/web/src/auth/derive.test.ts  # structural: mnemonic never bound/returned/rendered/persisted
bun run scripts/gates/no-seed-paths.sh     # SC-004 (amended): user-facing-surface scan — zero hits
```

Expected: zero occurrences of wallet / gas / chain / token / onchain transaction /
seed / pending in any catalog string; the derivation module's mnemonic hygiene green;
zero mnemonic-material matches on any user-facing surface (rendered strings, clipboard
writes, localStorage/IndexedDB, network payloads, console/log calls) — raw
`bip39`/`mnemonic` identifiers in the bundle are exempt as the legitimate app-side
derivation path (FR-014 as amended).

## §5 Gate — demo-prep + seeded login (SC-002)

On the laptop (keys from env, each served exactly once):

```bash
bun run scripts/demo/prep-serve.ts   # then follow the printed one-time instructions
```

On each demo phone: open `<app-url>/demo/prep.html` (production domain — the wrap binds that rpId permanently), complete the passkey ceremony
for the offered persona (Budi, then Pak Haji on the second device). The vault ciphertext
stays in the phone's storage; the laptop serve shuts down.

Then on Budi's phone — log in through the **normal** app entry:

- Home shows **score 58** and active deal **remaining 480000000** (480 AUSD) — equal to
  `curl $API/api/me` with a minted session for that wallet (SC-002).
- Sign out → sign in again: one ceremony, same account, same numbers.

## §6 Gate — the judge flow, real phone (SC-001)

On a **clean** device (or after deleting the site's passkeys), with a stopwatch:

1. Open the app → Daftar → one biometric approval.
2. Phone number (local format) → demo identity check (labeled Demo Tool) → account ready.
3. Land on Home: acting account, no crypto vocabulary on any screen.
4. Close the app, return with the existing passkey → lands on Home in ~10 s, no re-onboarding.

Expected: ≤ 2 min first visit / ~10 s return, zero banned words observed (§4 proves it at source). Verify the
read-backs: `GET /api/me/verification` returns `{"identityBound":true,"dripped":true}`
and the relayer shows exactly one `bind_identity` and one `drip` job per wallet
(deterministic clientRefs — re-submitting the verification changes nothing).

## §7 Gate — session behaviors (SC-003)

1. Refresh the page mid-session → straight to Home, no biometric prompt (FR-008).
2. Wait for / force expiry (short-issued test session) → next authenticated call routes
   to sign-in, no opaque error (FR-010).
3. Sign out → local session gone (reopening shows sign-in), device passkey still present
   (passkey picker still lists it) → sign in again with one ceremony (FR-009).

## §8 Done-when checklist + secrets review

- [ ] §2 smoke PASS on the demo phone (vault primitive verified before use)
- [ ] §3 five session tests green; asserted-header curl rejected
- [ ] §4 banned-words + no-seed-paths gates green
- [ ] §5 Budi login shows 58 / 480000000; Pak Haji device logs in
- [ ] §6 judge flow ≤ 2 min first visit / ~10 s return, zero crypto vocabulary
- [ ] §7 refresh / expiry / sign-out round-trip clean
- [ ] Secrets review: no seed-phrase VALUE (a wordlist-word sequence) in any committed
      file or log line; `bip39`/`mnemonic` identifiers confined to `derive.ts` + its
      test (the legitimate derivation path — FR-014 amended); no key value in any
      committed file or log line; vault ciphertexts exist only on devices

All boxes checked = the feature's Done-when (constitution IX).
