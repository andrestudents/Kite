---
description: "Task list for Feature 006 — Invisible Account: Mera Passkey Onboarding"
---

# Tasks: Invisible Account — Mera Passkey Onboarding

**Input**: Design documents from `/specs/006-mera-passkey-onboarding/`
(plan.md, spec.md, research.md, data-model.md, contracts/auth-session.md,
contracts/web-api.md, quickstart.md)

**Tests**: Unit tests ARE part of the deliverable — the spec names them (FR-007's five
session tests, FR-011's wrap-flow test, the banned-words scan) and quickstart §3–§4 runs
them. Tests colocate with code (`*.test.ts` beside the module); browser-only ceremonies
are covered by the quickstart's device gates, not by unit tests (research D9).

**Organization**: Grouped by user story (US1 stranger→account = MVP, US2 session,
US3 seeded login, US4 desktop). Setup + Foundational block everything; the smoke gate
(T005) blocks ALL Mera-dependent work (FR-011 verification-first).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story (US1, US2, US3, US4)
- Exact file paths + verbatim constraints in every description

## Path Conventions

Bun/Turborepo workspaces at repo root (PLAN §10). Run from repo root:
`bun install`, `bun run dev:web` / `dev:api` / `dev:relayer`, `bun test`,
`bun run scripts/gates/no-seed-paths.sh`. Addresses/ABIs from `@kite/contracts`;
shared types from `@kite/core`. Env: root `.env` (gitignored; names in env.example
files); secrets never printed — `EnvMissing(<NAME>)` names the variable only.

---

## Phase 1: Setup

**Purpose**: Workspace slot + the RP-ID decision that everything device-side inherits.

- [ ] T001 Verify branch `006-mera-passkey-onboarding` is cut from `main` **after 005's merge** (constitution X — one feature per merge; the API files this feature edits must be 005's merged versions). If 005 is still open: STOP, do not start.

- [ ] T002 [P] Scaffold `apps/web/` as a workspace package: `package.json` (deps `react`, `react-dom`, `@category-labs/mera` **pinned exact (current 0.2.0)**, `@scure/bip32` + `@scure/bip39` **pinned exact** — mera does not derive accounts itself; PRF→BIP-39→BIP-32 is app-side (research/mera-docs-map.md row 1), `viem`, `qrcode`; devDeps `vite`, `@vitejs/plugin-react`, `tailwindcss`, `vite-plugin-pwa`, `@vitejs/plugin-basic-ssl`, `@types/bun`), `vite.config.ts` with `build.rollupOptions.input` = `index.html` + `smoke/index.html` + `demo/prep.html` — the smoke and prep pages MUST deploy to the production domain, because their ceremonies bind to its rpId (T005's gate, T024's wraps); they stay unlinked from the app shell (no nav/route references), and the prep page is inert without the laptop's one-time key server. (Amended with FR-014: the old must-never-reach-dist rule existed for the dist grep, which is gone — hygiene is now proven by T009's surface scan + T011's structural test.) Also `index.html`, `src/main.tsx`, root script `dev:web`, turborepo wiring. Gate: `bun install && bun run dev:web` serves on localhost HTTPS.

- [ ] T003 [P] Create `apps/web/env.example` (names + non-secret defaults only): `VITE_API_URL=http://localhost:3000`; add `RELAYER_URL=http://localhost:3001` to the root `env.example` (005's list + this one name — the API→relayer hop's base URL). Create `apps/web/src/locales/id.ts` + `ms.ts` typed catalogs (one `Locale` type, keys per screen, Indonesian-first) and `src/lib/` scaffold. Banned-words compliance is per-locale-rendered (spec Assumption).

- [ ] T004 Fix the demo domain NOW (quickstart §0.2, research D10, mera-docs-map "RP-ID stickiness"): the rpId is the **FINAL Vercel production hostname** — deploy the T002 scaffold to Vercel production (or otherwise reserve the final URL) BEFORE any device ceremony, record the hostname, point `apps/web/.env` (local, gitignored) and the phones at it. **No wrap-on-localhost-then-move**: passkeys and demo vaults are PERMANENTLY bound to whatever rpId was live at ceremony time (mera security model: "after a domain migration, passkey accounts can no longer be reproduced and vaults can no longer be decrypted") — the demo phones' wrapped persona keys (T023–T025) live and die with this URL. A localhost or throwaway-tunnel rpId is acceptable ONLY for ceremonies nothing depends on; every ceremony meant to survive (T005's gate PASS, demo-prep wraps, judge-flow passkeys, T020/T022 validation) runs on the production URL. Notarize the hostname + deploy URL in the task note.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The verification-first gate, the session contract on both sides of the wire, the curl-mint helper, and the hygiene gates. Nothing story-shaped starts before T005.

- [X] T005 **BLOCKING — verification-first smoke gate (FR-011)**: Create `apps/web/smoke/index.html` + its TS entry (dev-only). Sequence with real ceremonies: (1) `createPasskeyWithPrfOutput({rp, user})` — PRF present, no `PRF_UNAVAILABLE`; (2) derive the address twice — `entropyToMnemonic(prfOutput, wordlist)` → `mnemonicToSeedSync` → `HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0")` → `createSecp256k1SigningSession({privateKey})` → `getEvmAddress(session.publicKey)` — same EIP-55 address both times; (3) wrap a throwaway test key via `createSecretVaultWithNewPasskey({rp, user, secret})`; (4) unwrap via `parseSecretVault(stored)` + `decryptSecretVaultWithPasskey({rpId, vault})` (one assertion ceremony); (5) unwrapped key's address (`createSecp256k1SigningSession` → `getEvmAddress(session.publicKey)`) == test key's address. Exact signatures + cited URLs: research/mera-docs-map.md. Print PASS/FAIL per step with evidence. **Mera vault primitive missing or unusable → HALT: return to clarify; fallback ladder per FR-011/FR-012; no mid-implementation substitutes.** The ladder (Mera vault → own PRF-based wrap if the platform exposes the prf extension → WebAuthn fallback adapter with the bounty-impact record) is printed on the page itself. No adapter, screen, or prep tool may be built on the vault before this gate PASSes on the demo phone.
  - Evidence (operator, 2026-10-12): smoke 5/5 PASS on the real phone at https://kite-zeta.vercel.app/smoke — passkey confirmed 2–3× across create → wrap → unwrap; rpId pinned to kite-zeta.vercel.app.

- [ ] T006 [P] Create `apps/web/src/auth/types.ts` — the origin-agnostic adapter interface `createAccount / signIn / signIntent` (FR-012: the demo-derivation mode is an implementation, never an app fork) — and `apps/web/src/auth/session.ts` + `session.test.ts`: frozen message builder producing EXACTLY `Sign in to Kite\n<wallet>\nuntil <unix>` (EIP-55 wallet, decimal unix seconds), header serializer `x-kite-session: <wallet>|<until>|<v>|<r>|<s>` (r/s `0x`-prefixed 64 hex, v 27|28), and the SessionBlob localStorage store (data-model §2.2: wallet, until, sig — never the key). Digest pinning follows contracts/auth-session.md §1.1 (viem `hashMessage` → `signDigest`; the formula lives in the contract, not duplicated in code). Tests: format round-trip, header parse/reject, blob lifecycle.

- [ ] T007 [P] Create `apps/api/src/middleware/session.ts` + `session.test.ts`: parse per contracts/auth-session.md §2 → rebuild the frozen message → `recoverMessageAddress` (local ecrecover, no RPC) → require `recovered == declared` → require `now < until ≤ now + 7d + 60s` (skew allowance) → attach wallet to context. **This file owns ALL FIVE named tests (FR-007)**, vectors signed locally with throwaway viem accounts: expired → 401 `session_expired` · tampered signature → 401 `session_invalid` · valid → 200 + correct recovered identity · `/api/p/:id` → 200 with NO session header · MITA purchase route unaffected. Error envelope is 005's `{error:{code,message}}`. Downstream route work (T015, T018) is attachment-only — the primitives live here.

- [ ] T008 [P] Fill `apps/web/src/locales/{id,ms}.ts` initial strings and create `apps/web/src/locales/banned-words.test.ts`: scan EVERY string in both catalogs and fail on any of `wallet | gas | chain | token | onchain transaction | seed | pending` (constitution I). The harness starts green over the initial catalog and grows with every screen task (research D9).

- [ ] T009 [P] Create `scripts/gates/no-seed-paths.sh` (SC-004, FR-014 **as amended**): the invariant is "no seed phrase is ever SHOWN, STORED, EXPORTED, or LOGGED" — NOT "the identifier never appears in the bundle" (the derivation path legitimately uses `@scure/bip39` app-side; raw identifiers are exempt). The gate scans **user-facing surfaces** over `apps/web/src/**` (no dist build): (a) **sink scan** — any line referencing mnemonic material (`mnemonic | seedPhrase | seed_phrase | entropyToMnemonic | mnemonicToSeedSync`) that also touches a user-facing sink (`console.`, `navigator.clipboard`, `localStorage`, `indexedDB`, `fetch(`/`apiFetch`, JSX-rendered text) → fail listing file:line; (b) **import confinement** — `@scure/bip39`/`@scure/bip32` and `entropyToMnemonic`/`mnemonicToSeedSync` appear ONLY in `apps/web/src/auth/derive.ts` and its colocated `derive.test.ts` (the test references the identifiers to police them — assertions only, never computing a mnemonic); nowhere else in `apps/web/src/**`; (c) zero custody-backend integration (unchanged intent). Exit 0 with evidence / exit 1 listing matches. Root script `no-seed-paths`. The derivation module's own hygiene is proven by T011's structural test, not this grep.

- [ ] T010 [P] Create `scripts/gates/mint-session.ts`: signs the frozen message (`Sign in to Kite\n<wallet>\nuntil <unix>`) with a throwaway viem account and prints the ready-to-paste `x-kite-session` header value — the curl helper quickstart §3 references. **Labeled dev tooling (Demo Tool banner); lives in scripts/gates/, never imported by app code, never bundled.**

**Checkpoint**: Smoke gate PASS on the demo phone; session contract testable on both sides; curl helper + hygiene gates live. User story work may begin.

---

## Phase 3: User Story 1 — A stranger becomes a working account, invisibly (Priority: P1) 🎯 MVP

**Goal**: Signup → phone step → demo verification → `bind_identity` + `drip` via the existing relayer jobs → Home with an acting account, zero crypto vocabulary — including the returning-user fast path.

**Independent Test**: quickstart §6 judge flow (real phone, ≤ 2 min first visit; ~10 s second visit, zero crypto vocabulary both times) + §3 curls (`GET /api/me/verification` → `{"identityBound":true,"dripped":true}`; `/api/me` via session header; bare `x-kite-wallet` rejected).

- [X] T011 [US1] Create `apps/web/src/auth/mera-adapter.ts` (primary adapter; ALL `@category-labs/mera` imports confined here — research D14) **plus `apps/web/src/auth/derive.ts` + `derive.test.ts` — the derivation module is the ONLY importer of `@scure/bip32`/`@scure/bip39`** (T009's confinement target; it stays mera-free, the adapter wraps its output in a session): `derivePrivateKey(prfOutput)` runs `mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist))` with the mnemonic as an **unbound inline intermediate** (JS strings are immutable and cannot be zeroed — lifetime is minimized instead; never assigned to a named binding) and zeroes every byte intermediate (prfOutput copy, 64-byte seed, private key before session hand-off) in `finally` — the same hygiene as session `end()` (FR-014 as amended). Structural test beside it: (i) the return value contains ONLY the 32-byte key (no wordlist words in anything it returns); (ii) spies prove no console/clipboard/localStorage/indexedDB/network access during derivation; (iii) source assertion — `derive.ts` binds no mnemonic variable (`const|let|var mnemonic` zero matches) and its `finally` zeroes each byte intermediate. Adapter surface: `createAccount` = `createPasskeyWithPrfOutput({rp, user})` → `derivePrivateKey` → `createSecp256k1SigningSession({privateKey})` → `getEvmAddress(session.publicKey)` (EIP-55, synchronous, no extra prompt); `signIn` = `getPasskeyPrfOutput({rpId, credential})` (default salt `sha256("mera.prf.salt.v1")`, stable across library versions → same bytes → same account) → same derivation; `signIntent` = message → viem `hashMessage` → `session.signDigest(digest)` → `{v: 27 + sig.recovery, r, s}` from `compact` r‖s (low-S normalized; no biometric re-prompt — research D7). Unit-test the pure parts (encoding/serialization); the ceremony itself is covered by T005's gate.

- [X] T012 [P] [US1] Create `apps/web/src/auth/webauthn-adapter.ts` — the FR-012 fallback twin behind the SAME interface: WebAuthn assertion gates a device-bound session key; mechanism documented in-file; **stub-level implementation with the activation decision recorded** — full build happens only if the fallback activates (bounty impact written down, never silently swapped; FR-012's activation-gated clause). Do not gold-plate a path the primary may never need.

- [X] T013 [P] [US1] Create `apps/web/src/api/` client: `apiFetch` attaching `x-kite-session` from the blob; `me()`, `verificationGet()`, `verificationPost(identityHash)`, `quote()`; 401 handling routes to sign-in (FR-010). Plus `apps/web/src/lib/money.ts` display helper: integer base units × locked quote `rate / 10^scale`, IDR/MYR display-only, never stored (constitution VI).

- [X] T014 [US1] Create `apps/api/src/services/relayer-client.ts` + `relayer-client.test.ts`: INTERNAL-keyed `POST /jobs` client (base URL `RELAYER_URL` from root env — T003; key checked with 005's `verifyApiKey` from `@kite/core`, never logged); **deterministic clientRefs `bind-<wallet>` / `drip-<wallet>`** so replays return the same job (idempotent enqueue, 005 queue contract); retry once on transport failure; `503 relayer_unreachable` surfaced to the caller.

- [X] T015 [US1] Create `apps/api/src/routes/verification.ts` + `verification.test.ts` and mount in `apps/api/src/index.ts`: `GET /api/me/verification` → `{identityBound, dripped}` (chain `identityOf` read-back + `drips` PK — derived, never cached; constitution IV); `POST /api/me/verification {identityHash}` → validate **exactly `0x` + 64 hex** else `422 identity_hash_invalid` → enqueue `bind_identity {wallet, identityHash}` + `drip {wallet}` via T014 → same read-back shape + `enqueued`. Both routes attach T007's session middleware (attachment-only). Tests (PGlite + mocked chain client): read-backs, malformed hash 422, double-POST idempotent (same clientRefs, no duplicate jobs), 503 path stores nothing. **No user data is written; the users table stays dormant (FR-002).**

- [X] T016 [P] [US1] Create onboarding screens + `apps/web/src/lib/identityHash.ts`: Signup (one biometric approval, account derived silently — FR-001: the user is NEVER shown key material), Phone (local format as typed, leading zero, no international coercion; labeled demo step; device-local storage only — FR-002), Verify (**Demo Tool** label, constitution VIII; auto-approve; `identityHash = keccak256("kite-demo-v1" ‖ keccak(ktpBytes) ‖ keccak(selfieBytes) ‖ wallet)` — D6, documents never leave the device), then POST + poll `GET /api/me/verification` (≥ 2 s interval, plain-language retry, no dead end — US1-AC5). All strings into the id/ms catalogs (T008's test grows here).

- [X] T017 [US1] Implement the returning-user fast path in the app entry (`apps/web/src/app/` state machine, FR-016): an existing passkey yields the existing account — straight to Home, **no re-onboarding** (second-visit target ~10 s, part of SC-001's judge flow) — via **credential pinning**: persist `{credentialId, transports}` from `createPasskeyWithPrfOutput`'s result and pass it back as `credential` to `getPasskeyPrfOutput` so the browser reuses the same passkey instead of offering a chooser (mera-docs-map row 1); a new passkey starts the T016 onboarding; no duplicate accounts are ever created. Tests: both entry paths (existing passkey → Home; new passkey → Signup) with a mocked adapter.

- [X] T018 [P] [US1] Swap `/api/me` caller identity: edit `apps/api/src/routes/me.ts` (+ `me.test.ts`) from the `x-kite-wallet` header to T007's session middleware — identity is recovered, never asserted (clarified FR-007); response shape unchanged (005's contract); attachment-only (primitives and all five tests live in T007). Add the rejection case to `me.test.ts`: bare `x-kite-wallet` → 401. Update nothing else in 005's routes (auth-domain table rows Public/Service-keyed untouched).

- [X] T019 [US1] Create the Home screen (`apps/web/src/screens/Home.tsx`): `/api/me` render via T013's session-authed client — balanceAusd, profile score row, activeIsa (empty state: score 0, maxSupportAusd 600000000, `activeIsa: null` per 005's shape), IDR display via `/api/quote` lock with "≈"; actions enabled only when `identityBound && dripped` (FR-006). Zero crypto vocabulary in any rendered string.

- [ ] T020 [US1] **Validation gate (quickstart §6 + §3)**: on a real phone via the tunnel, complete the judge flow with a stopwatch — first visit ≤ 2 min, **second visit (existing passkey) lands on Home in ~10 s** (T017's fast path, SC-001); assert `GET /api/me/verification` reaches `{"identityBound":true,"dripped":true}`; `/api/me` answers the session header and rejects bare `x-kite-wallet` (T010's minted session); relayer shows exactly one `bind_identity` and one `drip` job for the wallet; re-submitting verification changes nothing. Record evidence in the task note.

**Checkpoint**: US1 functional — a stranger becomes a working, verified, dripped account end to end, and comes back in ten seconds.

---

## Phase 4: User Story 2 — The session that stays out of the way (Priority: P2)

**Goal**: Login → signed session (≤ 7 d) → refresh-survival, prompt-free actions, clean expiry routing and sign-out/in.

**Independent Test**: quickstart §7 (refresh no-prompt · forced expiry routes to sign-in · sign-out/in round-trip).

- [X] T021 [US2] Implement session lifecycle in `apps/web/src/auth/session.ts` + screens wiring + tests (injected clock): login signs the frozen message once and stores the blob (data-model §2.2: `issuedAt < until ≤ issuedAt + 7d`); page refresh restores from blob with NO new ceremony while valid (FR-008); `401 session_expired`/`session_invalid` from any call routes to sign-in, never an opaque error (FR-010); sign-out wipes the blob and ends the signing session (`end()`), the device passkey itself is untouched (FR-009).

- [ ] T022 [US2] **Validation gate (quickstart §7)**: refresh mid-session → straight to Home, no biometric prompt; short-issued test session expired → next authenticated call routes to sign-in and the interrupted action is re-attemptable; sign-out → sign-in round-trips with one ceremony and the same account. Record evidence.

**Checkpoint**: US1 + US2 both independently green.

---

## Phase 5: User Story 3 — The seeded farmer logs in (Priority: P3)

**Goal**: Demo phones log in as 004's exact personas (Budi, Pak Haji) through the standard UX via passkey-wrapped keys.

**Independent Test**: quickstart §5 / SC-002 — Budi's phone shows score 58 and remaining 480000000, equal to `/api/me` for that wallet; Pak Haji on the second device.

- [X] T023 [US3] Create `apps/web/src/auth/demo-adapter.ts` + `apps/web/src/lib/persona.ts`: the demo-derivation mode behind the SAME adapter interface — login runs the real passkey ceremony — `parseSecretVault(stored)` (the validation boundary for untrusted stored JSON) → `decryptSecretVaultWithPasskey({rpId, vault})` (one assertion, pinned to the vault's credential) → `createSecp256k1SigningSession({privateKey})` over 004's exact address with `getEvmAddress(session.publicKey)` asserted equal; zero the decrypted bytes in `finally` (mera recipe hygiene) — vault JSON `{version:1, credential, prfSalt, nonce, ciphertext}` lives in IndexedDB (data-model §2.3); **code-level label on the mode** (FR-011 disclosure place 3; makes NO bounty claims). Persona manifest carries `persona` (`"budi" | "pakhaji"`) and `displayName` ("Budi · Ngawi" / "Pak Haji") — **from the manifest, never a server table**. The wrap → ceremony → unwrap → correct-address flow is covered by T005's gate on-device (headless parts unit-tested).

- [X] T024 [P] [US3] Create `scripts/demo/prep-serve.ts` + `apps/web/demo/prep.html` (both labeled Demo Tool, constitution VIII): laptop script reads `BUDI_KEY`/`PAKHAJI_KEY` from env, serves each key **exactly once** over the tunnel to the prep page, prints loud warnings, exits; the phone page runs the passkey ceremony — `createSecretVaultWithNewPasskey({rp: {id: rpId, name}, user, secret})` (fresh random 32-byte PRF salt per vault; JSON-safe `{version, credential, prfSalt, nonce, ciphertext}`) — stores the vault JSON + persona marker on-device, and never displays or transmits the key again (FR-011 hygiene: ciphertext device-bound, plaintext env-only — nothing enters git or bundles).

- [ ] T025 [US3] **Validation gate (quickstart §5 / SC-002)**: prep both demo phones (Budi, then Pak Haji); shut the laptop serve down; on Budi's phone log in through the NORMAL app entry → Home shows score 58 / remaining 480000000, equal to a minted-session `/api/me` read (T010 helper); sign-out → sign-in again (one ceremony, same numbers); repeat on Pak Haji's device. Record evidence.

**Checkpoint**: All four stories' mechanisms live.

---

## Phase 6: User Story 4 — Desktop meets the phone where it is (Priority: P4)

**Goal**: Desktop renders the onboarding in a phone frame with a QR hand-off; no simulated ceremonies.

**Independent Test**: US4's independent test — desktop URL renders frame + scannable QR; no desktop path attempts the biometric ceremony.

- [X] T026 [P] [US4] Create `apps/web/src/screens/DesktopFrame.tsx` + QR: coarse-pointer/desktop viewport renders the flow in a 390×844 phone frame with a QR of the current onboarding URL (`qrcode`, client-side, static URL only — no session/key material in it); companion state is honest (acknowledges or stays a companion); every ceremony step instructs to the phone (FR-013). Strings into catalogs (T008's test grows).

- [ ] T027 [US4] **Validation gate**: open the tunnel URL on desktop — frame + QR render; scan with a phone → the real flow opens and completes; confirm no desktop-only path triggers a passkey prompt. Record evidence.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: PWA posture, the three-place disclosure, tooling, and the final Done-when pass.

- [X] T028 Wire PWA posture (research D11): `vite-plugin-pwa` manifest (name/icons/theme) + an app-shell-only service worker that **never serves API responses** (constitution IV — the chain stays the authority; no offline money state). Verify installability on the real phone.

- [X] T029 Write the FR-011 disclosure in its three places (same wording family as 004's): (1) TRUST.md row — demo personas are pre-seeded EOAs whose keys are passkey-wrapped on the demo devices, judge signup is pure Mera passkey → fresh address; (2) judge instructions with that sentence verbatim; (3) audit the code-level demo-mode label from T023. Plus the TRUST.md row for the session's known limitation: bearer-like, replayable within its window, nonce binding roadmap (FR-007). If the fallback ladder ever activated, its bounty-impact record lives here too.

- [X] T030 Wire + verify root tooling: `dev:web`, `no-seed-paths` scripts present; `bun run typecheck` green; `bun run lint` (biome) clean; `bun test` green across apps/api + apps/web additions.

- [ ] T031 Full quickstart §0–§8 pass (the feature Done-when, constitution IX): every gate green with printed evidence — §2 smoke, §3 session tests + curls, §4 banned-words + no-seed-paths, §5 Budi 58/480000000 + Pak Haji, §6 judge flow ≤ 2 min first visit / ~10 s second visit, §7 session behaviors, §8 secrets review (no seed-phrase VALUE — a wordlist-word sequence — in any committed file or log line; `bip39`/`mnemonic` identifiers confined to `derive.ts` + its test, the legitimate derivation path per amended FR-014, with T009's gate green; no key value in any committed file or log line; vault ciphertexts only on devices).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first; T002/T003 parallel; T004 needs the tunnel decision, blocks all device validation.
- **Foundational (Phase 2)**: T005 needs T002 (served page) — **blocks T011, T023, T024 and every device ceremony**; T006/T007/T008/T009/T010 parallel among themselves.
- **User Stories**: after Phase 2, independent of each other; priority order US1 → US2 → US3 → US4 (US3's validation wants US1's Home to show the seeded numbers).
- **Polish**: after all stories.

### User Story Dependencies

- **US1**: T011 → T016 (adapter before screens); T012 ∥ T013 ∥ T014 (distinct files) once T011 lands; T014 → T015 (client before routes); T016 ∥ T017 ∥ T018 (screens / returning-user entry / api me-route swap — distinct files; T018 needs only Phase-2 T007); T019 needs T013 + T015 + T016 + T018; T020 last.
- **US2**: T021 → T022.
- **US3**: T023 → T025; T024 ∥ T023; T025 needs T019 (Home) + T024.
- **US4**: T026 → T027; T026 parallel to US3's tasks (distinct files).

### Parallel Opportunities

- Phase 1: T002 ∥ T003. Phase 2: T006 ∥ T007 ∥ T008 ∥ T009 ∥ T010 (after T005 for anything Mera-touching).
- US1: T012 ∥ T013 ∥ T014 while T011 lands; then T016 ∥ T017 ∥ T018.
- US3: T024 ∥ T023. US4: T026 anytime after Phase 2.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + 2 (scaffold, tunnel domain, **smoke gate PASS**, session contract + curl helper, hygiene gates).
2. Phase 3 (US1) — stranger → verified → dripped → acting account, plus the ten-second return.
3. **STOP and VALIDATE**: quickstart §6 judge flow on a real phone (first + second visit).
4. This alone proves PLAN §12's Day-7 gate ("Sign up → verified → account ready, no MON bought") and the Mera UX bounty's fresh-signup checklist.

### Incremental Delivery

US2 adds prompt-free persistence → US3 adds the seeded demo continuity (SC-002) → US4 adds the desktop companion → Polish adds PWA + disclosure + the full Done-when. Nothing later rewrites anything earlier; the adapter seam absorbs US3 without forking the app.

---

## Notes

- Commit after each task or logical group (constitution X: window-dated, one feature per merge).
- The STOP ladder is real: if T005 fails, do not improvise — halt, return to clarify (FR-011 verification-first; no mid-implementation substitutes).
- Banned words apply to every string the catalogs render, in both locales, from the first screen (constitution I).
- Gas/limits: this feature sends no transactions itself; bind/drip ride 005's relayer at published fixed limits.
- Secrets: env-only, never printed; demo-prep serves each key once and exits; the mint-session helper is dev tooling, never bundled; vault ciphertext never enters git or the build.
- Demo devices (filming-week prep): iPhone on iOS 18+ (iCloud Keychain supplies PRF — mera-docs-map row 6); Android phone on Chrome with Google Password Manager; a PRF-incapable manager fails T005 with `PRF_UNAVAILABLE` (diagnostic, not an app bug).
