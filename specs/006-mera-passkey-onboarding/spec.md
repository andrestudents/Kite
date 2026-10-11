# Feature Specification: Invisible Account — Mera Passkey Onboarding

**Feature Branch**: `006-mera-passkey-onboarding`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Feature 006 — Invisible account: Mera passkey onboarding. Source of truth: PLAN §3 steps 1–2, §4 D3, §8 (Onboarding/Verification screens), §12 day 7, §11.2 (Mera docs). Track: Consumer Track 'invisible blockchain' bar — this feature IS the account layer that makes crypto invisible. Deliverables in apps/web: passkey signup via Mera (account derived silently; NO seed phrase, NO extension, NO custody backend in shipped code); phone-number step (local format, no verification this feature — demo); signing session (signed auth message with expiry, header-based, max 7 days, prompt-free after login, survives refresh, clean sign-out/in); demo verification (auto-approve → relayer bindIdentity → one-time MON drip → Home, zero crypto vocabulary); desktop fallback (phone frame + QR per PLAN §8). CRITICAL UNKNOWN — address parity: demo phones must log in as the SEEDED accounts (Budi @ 58/480e6, Pak Haji) created in 004 as plain EOAs; resolve at spec/clarify time, state the mechanism and its disclosure implications. FALLBACK CONSTRAINT: standard WebAuthn passkeys with identical UX are the documented fallback, bounty impact recorded, never silently swapped; spec must define the adapter seam so the swap is one file. Banned words from the first screen; verification copy reads like GoJek/KTP verification, not KYC crypto onboarding. Done when: on a REAL phone a brand-new user reaches a verified, dripped, acting account having never seen a seed phrase, extension, or bought MON; the seeded Budi logs in on the demo phone showing score 58 / remaining 480e6; session survives refresh; sign-out/in works; repo grep finds no seed-phrase/mnemonic code paths in shipped bundles."

**Implements**: PLAN §3 steps 1–2 (signup, verification), §4 D3 (invisible account: passkey EOA, signing session, drip), §8 (Onboarding/Verification screens + desktop behavior), §11.2 (Mera — client-side library, no contract, no API key), §12 Day 7 ("Sign up → verified → account ready, no MON bought"). Bounties: Mera Best UX (passkey signup, signing sessions, no seed phrase/extension/custody backend, stateless test) and the Agora onboarding leg. Constitution I (invisible blockchain — this feature IS principle I), IV (contract is authority — identity binding read back), VIII (demo components labeled), IX (gates before progress). Builds on Feature 004 (seeded demo accounts — Budi, Pak Haji as plain EOAs; DEMO-ACCOUNTS.md) and Feature 005 (the `x-kite-wallet` session seam was designed for exactly this swap; relayer job kinds `bind_identity` `{wallet, identityHash}` and `drip` `{wallet}` with read-backs, per the 005 HTTP contract).

**Facts from prior features and the Mera docs (referenced, not assumed)**:
- `@kite/contracts` KITE_DEPLOYMENT (004): proxy `0x3B6C…C0fD`, MockAUSD `0x0309…05E3` (`ausdIsMock` — Demo Tool), `channelId 1`, `minEventGapSec 60` (compressed-gap seed, disclosed), chain 10143.
- 005 HTTP contract: `/api/me` is the Home screen's single response (chain-authoritative `profile.score`, `activeIsa.remainingAusd`; empty state score 0 / maxSupport 600000000 / `activeIsa: null`); caller identity = the `x-kite-wallet` header, documented as swappable for session auth; job kinds are the snake_case wire values `bind_identity` and `drip`, submitted to the relayer (INTERNAL key) with idempotent `clientRef`; `bind_identity` is confirmed only after the onchain read-back `identityOf(wallet) == identityHash`, and `drip` exactly once per wallet (one-time lock) with a balance-increase read-back.
- Seeded state (004, onchain today): Budi — score 58, active ISA remaining 480,000,000 base units (480 AUSD), progress 3846 bps; Pak Haji — second device, backer side.
- Mera library (docs, mera.category.xyz; package `@category-labs/mera`): the passkey PRF ceremony returns the **same deterministic 32 bytes** on every sign-in (stable built-in salt) — the account address is a pure function of the passkey; **an existing EOA private key cannot be imported into a passkey-derived account**; *secret vaults* can wrap an external secret (e.g., a pre-seeded account key) encrypted by the passkey, decryptable only via the passkey ceremony; signing sessions sign digests in-memory and are explicitly ended (key material zeroed); PRF support in the authenticator is **required** (`PRF_UNAVAILABLE` otherwise — iCloud Keychain / 1Password suggested); passkeys are bound to the site's domain (RP ID); a secure context (HTTPS or localhost) is mandatory; the library is client-side with no custody service and is in preview (API may change pre-1.0).
- Pre-implementation verification (2026-10-11, research/mera-docs-map.md — every claim above mapped to the live docs, all seven rows VERIFIED): account derivation is **app-side** (`prfOutput` → BIP-39 → BIP-32 `m/44'/60'/0'/0/0` via `@scure/bip32` + `@scure/bip39` — the library does not derive accounts); vault APIs confirmed exactly as FR-011 assumes (`createSecretVaultWithNewPasskey` / `decryptSecretVaultWithPasskey` / `parseSecretVault` — AES-256-GCM, fresh random salt per vault, app stores the ciphertext); signing sessions have **no built-in TTL** (our 7-day `until` is purely application-level) and `signDigest` signs a pre-hashed 32-byte digest; the library is serverless (no API keys, no allowlists; runtime deps `@noble/*`/`@scure/*` only); RP-ID binding is **irreversible** ("after a domain migration, passkey accounts can no longer be reproduced and vaults can no longer be decrypted"); phone PRF support confirmed: iPhone iOS 18+ (iCloud Keychain), Android Chrome + Google Password Manager. Current package 0.2.0, pinned exact.

## Clarifications

### Session 2026-10-10

- Q: Which mechanism lets the demo phones log in as the 004-seeded accounts when passkey signup always derives fresh addresses? → A: Option B — passkey-protected seeded keys (Mera secret vaults), with a verification-first smoke-test task, a three-place disclosure, key-hygiene rules, and an origin-agnostic adapter interface (folded into FR-011, FR-012, US3, Edge Cases, Assumptions).
- Q: Should the backend verify the signed session server-side at the 005 seam, or does the session stay client-held with the API trusting the caller-address header? → A: Option A — server-verified session; identity is recovered from the signature, never asserted; frozen message format; a three-domain auth table superseding 005's F1 record; five named tests (folded into FR-007, FR-010, Entities, Assumptions).
- Q: Should signup persist phone and locale to the `users` table 005 scaffolded, or stay device-local only? → A: Option B — device-local only, no new routes (006 read-only against 005's API); display-name source for 007's Dukung flow explicitly deferred to 007's clarify with the PLAN §8 tension flagged now (folded into FR-002, Entities, Edge Cases, Assumptions, Out of scope).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A stranger becomes a working account, invisibly (Priority: P1)

The whole product's first thirty seconds. A brand-new user on a real phone taps "Daftar", approves the device biometric prompt once, and an account exists — derived silently from the passkey; no key words, no downloads, nothing to buy. They enter a phone number (local format, like any local app). The identity check screen reads like a local super-app's verification — photo, selfie — and (demo) approves instantly, visibly labeled as the demo checker. Behind it, the account's identity binding is registered onchain and the account is quietly topped up with the fee allowance it needs — the user sees none of that vocabulary, only "account ready". They land on Home: a working account with balance context, reputation row, and an empty-state deal card. From first tap to Home, zero crypto vocabulary appears on any screen.

**Why this priority**: This is Constitution I's feature — the "invisible blockchain" bar the track is judged on, the Mera UX bounty's exact checklist, and PLAN D3. Every later screen rides on this account existing. If this story fails, nothing above it matters.

**Independent Test**: On a real phone (biometric + PRF-capable authenticator), complete signup → phone → verification → ready, then assert: Home renders the empty-state account (score 0, support limit present), the identity binding reads back from the contract as bound, the fee top-up happened exactly once, and a banned-words scan of every rendered screen string is clean.

**Acceptance Scenarios**:

1. **Given** a brand-new user on a real phone, **When** they sign up with the device biometric, **Then** an account address is derived deterministically — the same passkey always yields the same account — and the user is never shown key material of any kind.
2. **Given** the signup step, **When** the phone-number field is filled, **Then** it accepts the local format (leading zero, as typed locally) without forcing international syntax; no verification message is claimed to have been sent (demo, labeled).
3. **Given** a created account, **When** verification is submitted, **Then** the demo checker auto-approves with its Demo Tool label visible, the identity binding job is submitted (`bind_identity`, confirmed by the contract read-back), and the fee-allowance job (`drip`) completes exactly once.
4. **Given** verification completed, **When** the user lands on Home, **Then** the account is acting (balance context present, actions enabled) and every screen string on the path honors the banned-words list — no wallet, gas, chain, token, onchain transaction, seed, pending.
5. **Given** any step fails (network, job not confirmed), **When** the user retries, **Then** retrying is safe: no duplicate bindings, no duplicate top-up, no dead-end screen.

---

### User Story 2 - The session that stays out of the way (Priority: P2)

After the first login, the app stops asking. Login creates a signing session: an auth message signed by the account with an explicit expiry (at most 7 days), presented to the backend through the header seam Feature 005 reserved for exactly this swap — with the server recovering the caller's identity from the signature (FR-007). While the session is valid, in-app actions are prompt-free — no biometric re-ask per action; the session survives a page refresh (the passkey ceremony happens at app open, not per tap); sign-out destroys the local session cleanly, and the next sign-in is a single biometric approval. The session never outlives its expiry, and an expired session routes the user back to sign-in, not to an error.

**Why this priority**: PLAN D3's second half ("a signing session makes in-app actions prompt-free") and a named Mera-bounty criterion. US1 without US2 is an account you have to re-unlock constantly — visible friction is a Constitution I defect.

**Independent Test**: Log in, refresh the page, and act; assert the session persisted and no per-action prompts appeared. Set the session near expiry, assert re-auth is requested; sign out, assert the session is gone locally and sign-in works again with one ceremony.

**Acceptance Scenarios**:

1. **Given** a valid session, **When** the app reopens or the page refreshes, **Then** the user is taken straight to Home with no new biometric prompt.
2. **Given** a valid session, **When** in-app actions are performed, **Then** no per-action prompt appears; the session signs on the user's behalf until expiry.
3. **Given** a session older than its expiry, **When** any authenticated call is made, **Then** the app routes to sign-in (one ceremony) instead of failing opaquely.
4. **Given** a signed-out device, **When** the user signs in again, **Then** the same passkey recovers the same account (deterministic derivation) and a fresh session begins; sign-out never deletes the device passkey itself.
5. **Given** the backend contract, **When** the session supplies caller identity, **Then** it rides the seam Feature 005 reserved for this swap with paths and payloads unchanged — user-scoped routes verify the signed session server-side (FR-007) while public and service-keyed domains behave exactly as 005 defined.

---

### User Story 3 - The seeded farmer logs in (Priority: P3)

The demo phones must show the story 004 seeded onchain: Budi — reputation 58, active deal remaining 480,000,000 base units — and Pak Haji on the second device. But 004 seeded plain EOAs from operator-held keys, while passkey signup derives new addresses by construction (the Mera docs rule out importing a known key into a passkey account). The parity mechanism — clarified as passkey-protected seeded keys (FR-011): a one-time labeled demo preparation wraps each seeded key into a vault bound to the demo phone's passkey — makes the demo phone log in as the seeded account through the same onboarding UX, with its disclosure written in three places (TRUST.md row, judge instructions, code-level label). The user-visible flow is identical to US1/US2, and the Home numbers equal the contract's.

**Why this priority**: The judging demo runs on these phones; without parity, the app can only ever show empty accounts. But it rides on US1/US2 existing first, and its mechanism is a scoped demo concern, not product surface.

**Independent Test**: On the demo phone, log in as Budi and assert Home shows score 58 and remaining 480,000,000 base units, equal to direct contract reads via `/api/me`; repeat sign-out/in; on the second device, log in as Pak Haji.

**Acceptance Scenarios**:

1. **Given** the demo phone configured per the chosen mechanism, **When** the user completes the standard login, **Then** Home shows the seeded state — score 58, remaining 480,000,000 base units — matching the contract's values exactly.
2. **Given** the one-time demo preparation, **When** a demo phone logs in, **Then** the passkey ceremony unwraps the vault and the resulting account address equals 004's published persona address exactly — the wrap → ceremony → unwrap → correct-address flow is covered by a test.
3. **Given** the demo-derivation mode, **When** it ships, **Then** it is labeled in code and disclosed in TRUST.md and the judge instructions, it makes no bounty claims (the Mera UX claim cites only the fresh-signup path), and the app handles only passkey-encrypted material.
4. **Given** both demo devices, **When** each logs in, **Then** each shows its own persona's state (Budi seeker-side, Pak Haji backer-side) via the same flows as US1/US2.

---

### User Story 4 - Desktop meets the phone where it is (Priority: P4)

A judge (or the user) opens the app on a laptop. The onboarding flow's passkey ceremonies and biometric prompts belong on the phone, so the desktop renders the flow inside a phone frame and offers a QR code that opens the real flow on the real device (PLAN §8's desktop behavior). The desktop never fakes a phone-only ceremony and never becomes a dead end.

**Why this priority**: Judges will open the laptop first; PLAN §8 mandates the behavior. But it is a contained presentation concern that cannot block the account layer.

**Independent Test**: Open the onboarding URL on desktop; assert the phone frame renders with a QR (or equivalent hand-off) that opens the flow on a phone; assert no desktop-only path attempts the biometric ceremony.

**Acceptance Scenarios**:

1. **Given** the onboarding URL opened on desktop, **When** the flow renders, **Then** it appears in a phone frame with a scannable hand-off to the real device.
2. **Given** the hand-off scanned on a phone, **When** the phone completes onboarding, **Then** the desktop view acknowledges completion (or simply stays honest about being the companion view) — it never claims a ceremony it did not perform.

### Edge Cases

- Passkey ceremony cancelled or denied → the app stays on the signup screen with plain-language retry; no partial account state.
- Authenticator lacks PRF support → the Mera path is unavailable (`PRF_UNAVAILABLE`); the documented fallback adapter takes over with identical UX, and the occurrence is surfaced in the write-up, never silently swapped.
- Vault primitive missing or unusable (FR-011's verification-first check) → stop and return to clarify; the fallback ladder — own PRF-based wrap, then the WebAuthn adapter with FR-012's bounty-impact record — is a deliberate decision, never a mid-implementation improvisation.
- User creates a second account on the same device → distinct passkey per account (the platform's passkey picker); creating a passkey with the same site+user identity replaces that credential — the app must not silently overwrite an existing account's passkey.
- Verification submitted twice / job replayed → binding and top-up remain exactly-once (005's one-time locks and idempotent submission); the user sees "ready", never an error.
- Drip already consumed (returning user re-verifying) → treated as already-ready; no duplicate top-up, no failure shown.
- Session expiry mid-action → the action is not half-performed; the user is routed to sign-in and the action re-attemptable.
- Page refresh during the ceremony → no half-derived account; the ceremony simply restarts.
- Phone-number field: local formats only, no international-format coercion, no claimed SMS (demo-labeled).
- Passkey lost → the account is unreachable (known, disclosed risk R5: synced passkeys mitigate; recovery rebind is roadmap) — the disclosure lives in the trust docs, not hidden.
- App opened on a different device with a synced passkey → the same account is recovered (deterministic derivation from the synced passkey).
- Desktop without a camera → the QR is shown for the phone to scan; the desktop never requires one.
- Device loss loses the device-local signup data (phone, locale) along with the account itself — acceptable and R5-adjacent (disclosed); demo personas' display names regenerate from the derivation-mode manifest, not from any server table.

## Requirements *(mandatory)*

### Functional Requirements

**Account creation (PLAN §3 step 1, §4 D3)**

- **FR-001**: Signup MUST create the account from the device passkey — a single biometric approval derives the account deterministically (same passkey ⇒ same account), and the user MUST NEVER be shown or asked to record key material (no seed phrase, no extension, no downloads).
- **FR-002**: The phone-number step MUST accept the local format as typed (no international-syntax coercion) and MUST NOT imply a verification message was sent — it is a labeled demo step in this feature. The captured data (phone, locale) is **device-local only**: this feature adds NO write route — it ships read-only against 005's API, and the `users` table stays dormant (005's scaffold note now pointing at Feature 007 as its likely activator).
- **FR-003**: Every user-facing string on every screen of this feature MUST honor the banned-words list (wallet, gas, chain, token, onchain transaction, seed, pending — constitution I); verification copy MUST read like a local super-app identity check, not crypto onboarding.

**Verification → ready (PLAN §3 step 2, D3/D4; 005 facts)**

- **FR-004**: Verification MUST auto-approve with its demo nature labeled (constitution VIII), then submit the existing 005 relayer job `bind_identity` (payload `{wallet, identityHash}`); the feature MUST treat the binding as done only per 005's contract read-back (the onchain identity map says the wallet is bound).
- **FR-005**: Account readiness MUST include the one-time fee allowance via the existing 005 relayer job `drip` (payload `{wallet}`) — exactly once per account by 005's one-time lock, invisible in vocabulary (constitution I) and capped by 005's daily outflow caps.
- **FR-006**: "Ready" MUST mean landing on Home with an acting account: balance context present, actions enabled, identity bound per the read-back — with no crypto vocabulary anywhere on the path.

**Session (PLAN D3; 005 seam)**

- **FR-007**: Login MUST create a signing session: an auth message with a **frozen format** — the exact string `Sign in to Kite\n<wallet>\nuntil <unix-expiry>` — signed by the account and presented to the backend in a header; the expiry is at most 7 days from issuance. The **digest construction is pinned alongside the message** (EIP-191 `personal_sign` over the exact message — formula in contracts/auth-session.md §1.1): the client feeds `hashMessage(message)` to `signDigest` and the server recovers via `recoverMessageAddress`, so both sides derive the same 32 bytes by construction, not by coincidence. **Identity is recovered, never asserted**: the server MUST derive the caller's address from the signature itself (recovery over the frozen format) and MUST NOT trust any caller-supplied address claim on user-scoped routes — the "anyone who knows an address" impersonation of the 005 header seam dies here. An invalid or expired session → `401` with an error shape the app routes to sign-in (FR-010). The middleware's scope is exactly this auth-domain table — **the single record, superseding and extending 005's F1 decision record; do not relitigate per-feature**:

  | Auth domain | Routes | Auth |
  |-------------|--------|------|
  | User-scoped | `/api/me`; `GET`/`POST /api/me/verification` (this feature — route set extended at plan time, research D4: the browser cannot hold the INTERNAL key, so the verification trigger lives here; it stores no user data) | Signed session — address recovered from the signature, expiry ≤ 7 days, else `401` |
  | Public | `/api/p/:id`, `/api/health`, `/api/quote` | None — MUST remain open (the credit passport is a public artifact; auth-gating it breaks it) |
  | Service-keyed | purchase registry routes (MITA key) · relayer `/jobs` (INTERNAL key) | 005's key domains, unchanged |

  Known limitation, disclosed in TRUST.md: the session token is bearer-like and replayable within its validity window — acceptable for MVP; nonce binding is roadmap. MUST be exercised by named tests: expired session → 401 · tampered signature → 401 · valid session → 200 with the correct recovered identity · `/api/p/:id` still 200 with no session header · a MITA route unaffected by the middleware.
- **FR-008**: A valid session MUST survive page refresh and app reopen without a new biometric prompt; in-app actions MUST be prompt-free while it is valid.
- **FR-009**: Sign-out MUST destroy the local session (signed session state unusable afterwards); the device passkey MUST NOT be deleted; the next sign-in MUST be a single ceremony recovering the same account.
- **FR-010**: An expired session MUST route the user to sign-in, never to an unexplained failure (the server's `401` from FR-007 is the trigger the app routes on); no authenticated action may half-complete across expiry.

**Demo parity (the critical unknown)**

- **FR-011**: The demo phones MUST log in as the seeded accounts through the standard onboarding UX via **passkey-protected seeded keys**: a one-time labeled demo preparation wraps each seeded account key (`BUDI_KEY` / `PAKHAJI_KEY` — env-only, scripts-side) into a Mera secret vault bound to that demo phone's passkey; login = the real passkey ceremony → vault decrypt → signing session over 004's exact published addresses. (Mera-native import of a known EOA is ruled out by the library's design — accounts are always PRF-derived; re-seeding against passkey-derived addresses was considered and set aside: 004's seed needs the seeker's own signatures, which an operator script cannot produce for a passkey address.) Conditions, all mandatory:
  - **Verification-first**: before anything else builds on this mechanism, a task MUST smoke-test the primitive (wrap a test key → unwrap via passkey ceremony). If the vault primitive is missing or unusable, STOP and return to clarify — the fallback ladder is Mera vault → own PRF-based wrap (if the platform supports the prf extension) → WebAuthn fallback adapter as last resort with FR-012's bounty-impact record. Never improvise a substitute mid-implementation.
  - **Disclosure in three places** (same wording family as 004's demo disclosures): a TRUST.md row; the judge instructions ("demo personas are pre-seeded EOAs whose keys are passkey-wrapped on the demo devices; judge signup is pure Mera passkey → fresh address"); and a code-level label on the demo-derivation mode. The mode makes NO bounty claims — the Mera UX claim cites only the fresh-signup path.
  - **Key hygiene**: wrapped key material never enters git or shipped bundles; vault ciphertext is device-bound (useless without that phone's passkey) and lives per-device; plaintext keys remain env-only in scripts/. The wrap → ceremony → unwrap → correct-address flow MUST be covered by a test.

**Fallback seam (bounty honesty)**

- **FR-012**: The auth layer MUST sit behind an origin-agnostic adapter interface — account creation, sign-in, and intent-signing (`createAccount / signIn / signIntent`) — with two implementations: the Mera passkey adapter (primary; FR-011's demo-derivation mode is an internal variant of it, not a fork of the app) and a standard-WebAuthn adapter with identical UX (fallback). The swap is one adapter, not a rewrite; the fallback twin ships interface-complete with its mechanism documented and its activation decision recorded — full construction happens only if the fallback activates, with the bounty impact written down (activation-gated delivery is compliance with this requirement, not a gap); any fallback activation MUST be recorded, never silently swapped.

**Desktop (PLAN §8)**

- **FR-013**: On desktop, the onboarding flow MUST render in a phone frame with a scannable hand-off (QR) to the real device; the desktop MUST NOT simulate phone-only ceremonies.

**Hygiene (constitution I bounty criteria)**

- **FR-014** *(amended 2026-10-11 — the docs-verified derivation path legitimately uses `@scure/bip39` app-side, so the original bundle-identifier grep would false-positive)*: No seed phrase (mnemonic) is ever **SHOWN, STORED, EXPORTED, or LOGGED** — that is the invariant, not "the identifier never appears in the bundle." Verifiable by: (a) a gate scanning **user-facing surfaces only** — rendered strings, clipboard writes, localStorage/IndexedDB persistence, network payloads, console/log calls — for mnemonic material (raw `bip39`/`mnemonic` identifier presence in the bundle is exempt); and (b) a **structural test on the derivation module**: the mnemonic exists ONLY inside the derivation function's scope — an unbound inline intermediate (immutable JS strings cannot be zeroed, so its lifetime is minimized instead; never assigned to a named binding, never returned, rendered, or persisted) — and every byte-array intermediate (PRF output, BIP-39 seed, private key before session hand-off) is zeroed in a `finally` block, the same hygiene as session `end()`. `@scure/bip39` imports are confined to that one module. No custody-backend integration (unchanged).
- **FR-015**: Account secrets MUST NOT leave the device except encrypted by the user's own passkey; no component of this feature may transmit, escrow, or mirror them.
- **FR-016**: Returning vs new users MUST be distinguished by the passkey itself: an existing passkey yields the existing account (no duplicate accounts, no re-onboarding), a new passkey starts US1.

### Key Entities *(include if feature involves data)*

- **Account**: the passkey-derived account (address as its only public identity), plus the device-local signup data (phone number, locale — and, for demo personas, the display name from the derivation-mode manifest, never a server table); created FR-001, identified by FR-016.
- **Session**: the frozen-format signed auth message + expiry, presented in a header; the server recovers the caller's identity from the signature (never a claimed header); lifecycle login → refresh-survival → expiry/sign-out.
- **Verification record**: the demo identity check (auto-approve, labeled) and the resulting onchain identity binding it triggers (the contract's identity map is the authority — constitution IV).
- **Demo persona binding**: the mapping of a demo phone to a seeded account persona (Budi / Pak Haji) per the FR-011 mechanism, with its disclosure trail.
- **Auth adapter**: the seam of FR-012 — one interface, two implementations (passkey-primary, WebAuthn-fallback), the only place account-derivation and session-signing live.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a real phone, a brand-new user reaches a verified, fee-allowanced, acting account in under 2 minutes, and a banned-words scan of every rendered screen string on the path is clean (zero occurrences). A second visit with the existing passkey lands on Home in ~10 seconds (no re-onboarding).
- **SC-002**: The seeded demo account (Budi) logs in on the demo phone and Home shows score 58 and remaining 480,000,000 base units — equal to the contract's values via the 005 read surface.
- **SC-003**: A session survives refresh with no re-prompt; expiry is at most 7 days; sign-out/in round-trips cleanly (verifiable by scripted device steps).
- **SC-004**: A user-run gate proves no mnemonic material reaches any user-facing surface — rendered, stored (localStorage/IndexedDB), exported (clipboard/network), or logged (console) — and the derivation module's structural hygiene test is green (mnemonic confined to the derivation function's scope; byte intermediates zeroed); raw `bip39`/`mnemonic` identifiers in the bundle are exempt as the legitimate derivation path (FR-014 as amended); zero custody-backend paths.
- **SC-005**: Every gate above is demonstrable by commands or scripted device steps the user can run unaided (constitution IX).

## Assumptions

- Mera is a client-side library with no contract, no API key, and no custody service (PLAN §11.2 fact; verified — mera-docs-map row 5); its PRF requirement means demo devices need PRF-capable authenticators: the demo iPhone MUST run iOS 18+ (iCloud Keychain — filming-week device prep), the Android phone Chrome with Google Password Manager as the default provider; 1Password works on either (row 6). PRF-incapable managers (Bitwarden, Dashlane, Chrome-profile passkeys) fail with `PRF_UNAVAILABLE` — a gate diagnostic, not an app bug.
- The account address is a pure function of the passkey (deterministic PRF output with the library's stable salt) — hence no known-EOA import path exists; FR-011 (clarified) uses passkey-wrapped seeded keys for the demo personas instead.
- The app is a PWA on real phones; the prior-cycle answer that a PWA satisfies the track's "mobile app" requirement is re-confirmed (PLAN Q6), and demo hosting must serve HTTPS on a **final, stable domain pinned before any device ceremony** — the production Vercel URL, fixed at T004: passkeys and vaults bind to the RP ID **irreversibly** (mera security model), so no wrap-on-localhost-then-move; a localhost/tunnel rpId is for throwaway ceremonies only.
- The 005 backend + relayer are running for `bind_identity` / `drip`; Home reads `/api/me` (the empty-state shape 005 defined is exactly US1's landing state). 005's quickstart showed `/api/me` identified by the bare `x-kite-wallet` header; under this feature that seam carries the signed session instead (paths and payloads unchanged) — 005's doc curl examples for `/api/me` are superseded when 006 lands, and the 005 gate scripts (gasless-send, purchase-settled, recon) do not call `/api/me`, so no gate breaks.
- Verification auto-approve is a labeled demo component (constitution VIII); real verification is out of scope, as is any SMS infrastructure.
- The per-deal PRF key material (Mera PRF bounty, PLAN Q5) is NOT part of this feature — the docs confirm PRF works, unlocking that later feature; recorded as roadmap.
- The apps/web technical stack, the session message's exact format, and the adapter's internal shape are plan-phase decisions; this spec fixes behavior.
- Locale coverage is Indonesian-first (`id`) with Malaysian (`ms`) strings for the Pak Haji persona; banned-words compliance applies per locale rendered.
- **Deferred to 007's clarify (recorded, not dropped)**: the Dukung flow renders "Budi · Ngawi" on Pak Haji's phone — display-name/discovery data that device-local capture cannot supply cross-device. Candidates: activate the `users` write route then (when a consumer exists), or a display-name field on the public profile. **Latent PLAN tension flagged now**: PLAN §8 says `/p/:id` shows no name, no documents, while the concept board shows display names on the profile and in the Dukung list — 007's clarify must resolve this against the frozen PLAN (likely outcome: a non-verified display name as UI flavor while the passport page stays PII-free — a PLAN §8 clarification line, decided there, never improvised in code).

## Out of scope (this feature)

- Real identity verification / KYC of any kind (demo auto-approve only, labeled).
- Per-deal PRF signing keys (Mera "One Passkey, Many Keys" bounty) — later feature; this feature only confirms PRF availability.
- Home screen content beyond the account-ready state (deal cards, flows, send/receive are the Day 8–9 app feature; this feature lands the empty-state Home and the seeded-state Home).
- Production hosting and domain procurement (the Vercel account/URL are assumed available; HTTPS is a stated dependency — but *pinning* the final URL is in-feature work: T004 fixes it before any device ceremony).
- Passkey-loss recovery/rebind (disclosed risk R5; roadmap).
- Server-side profile data / display names (explicitly deferred to Feature 007's clarify — see Assumptions; the `users` table stays dormant).
- The Mitra console, CRE workflows, indexer-driven history.
