# Research: Invisible Account — Mera Passkey Onboarding (Feature 006)

**Input**: spec.md FR-001..FR-016 + Clarifications (2026-10-10) · PLAN §3 steps 1–2, §4 D3, §8, §11.2, §12 Day 7 · constitution I, IV, VI, VIII, IX, X
**Facts on disk**: 005's HTTP contract (`x-kite-wallet` seam, `/api/me` shape, job kinds `bind_identity {wallet, identityHash}` / `drip {wallet}`, INTERNAL-keyed `POST /jobs` with idempotent `clientRef`, drip one-time lock table `drips(wallet PK)`); `@kite/contracts` KITE_DEPLOYMENT; 004's seeded personas (Budi score 58 / remaining 480e6). Mera docs facts (from the spec's Facts block): deterministic PRF (32 bytes, stable salt), **no EOA import**, secret vaults, signing sessions (`signDigest`, `end()`), PRF required, RP-ID binding, HTTPS, preview status.

---

## D1 — apps/web stack: Vite + React + TS + Tailwind + vite-plugin-pwa

- **Decision**: `apps/web` = Vite 7 + React 19 + TypeScript, Tailwind 4 for styling, `vite-plugin-pwa` for manifest/service-worker installability. Locales are hand-rolled typed catalogs (`src/locales/id.ts`, `ms.ts`) — no i18n framework.
- **Rationale**: Mera is a browser JS library; the deliverable is a real-phone PWA (PLAN §8/Q6). Vite dev serves arbitrary HTML entries, which the smoke and demo-prep pages exploit (D2/D5). Typed catalogs make the banned-words test a plain `bun test` over source (D9) instead of a DOM fixture. Two locales don't justify an i18n dependency.
- **Alternatives**: Next.js (SSR weight, no SSR need; competes with the 005 hono/Vercel story); SvelteKit (fine but second ecosystem in the repo); i18next (overkill for 2 catalogs).

## D2 — Verification-first smoke gate: dev-only browser page, PASS/FAIL + STOP ladder

- **Decision**: `apps/web/smoke/index.html` (dev-only, excluded from the build input) runs the FR-011 primitive check in a real ceremony: `createPasskeyWithPrfOutput` (PRF present?) → derive address → `createSecretVaultWithNewPasskey` wrapping a throwaway test key → `decryptSecretVaultWithPasskey` → recovered address equals the test key's address. Prints PASS/FAIL with each step's evidence. FAIL ⇒ **STOP; return to clarify** — the ladder is Mera vault → own PRF-based wrap (if the platform exposes the prf extension) → WebAuthn fallback adapter with FR-012's bounty-impact record. Nothing else in the feature builds on the vault before this gate passes.
- **Rationale**: The clarified parity mechanism rests on one preview-status primitive; FR-011 makes verification-first mandatory. WebAuthn ceremonies cannot run under `bun test` — an in-browser gate is the only honest form; a URL + one biometric tap is user-runnable (constitution IX).
- **Alternatives**: a Node script with a virtual authenticator (would not prove the real phone path); deferring the check to demo day (exactly what FR-011 forbids).

## D3 — Session wire contract: frozen message, `x-kite-session` header, local ecrecover

- **Decision**: The session message is the exact frozen string `Sign in to Kite\n<wallet>\nuntil <unix-expiry>` (wallet in EIP-55 checksum). The browser sends header `x-kite-session: <wallet>|<until>|<v>|<r>|<s>` (hex `0x`-prefixed r/s, decimal v). `apps/api/src/middleware/session.ts` rebuilds the message, recovers the address with viem `recoverMessageAddress` (pure local ecrecover — no RPC), requires recovered == declared wallet, and enforces `now < until ≤ now + 7d + 60s skew`. Failure → `401` with `{error:{code:"session_invalid"}}`; expired → `code:"session_expired"` — both routable to sign-in (FR-010). Full grammar in [contracts/auth-session.md](contracts/auth-session.md).
- **Rationale**: Spec FR-007 (clarified): identity recovered, never asserted; ≤ 7 days; 401 shape the app routes on. `recoverMessageAddress` keeps the middleware pure and testable with locally-signed vectors.
- **Alternatives**: JWT (needs a server store/secret ceremony; nothing to gain at demo scale — and the signed message IS the token); verifying via RPC eth_call (latency + failure mode for a pure function); keeping `x-kite-wallet` as a fallback (asserted identity — explicitly rejected by the clarification).

## D4 — The verification trigger: two user-scoped routes on apps/api (the "read-only" tension, resolved narrowly)

- **Decision**: `apps/api` gains `GET /api/me/verification` → `{identityBound, dripped}` (chain `identityOf` + the `drips` PK — read-backs, constitution IV) and `POST /api/me/verification {identityHash}` → validates the 0x-32-byte hash, enqueues the **existing** relayer jobs via a new INTERNAL-keyed client with **deterministic clientRefs** `bind-<wallet>` / `drip-<wallet>` (replay = same job — idempotent by 005's queue), then returns the same read-back shape. Both sit behind the session middleware. No user data is stored; the users table stays dormant; no new job kinds.
- **Rationale**: The clarify answer "006 ships read-only against 005's API" was about *user-data persistence* (the users-table question). But the Done-when — a brand-new user verified + dripped **unaided on a real phone** — cannot work browser→relayer directly: `POST /jobs` is INTERNAL-keyed and a browser must never hold that key. The narrow reading (no user-data writes) plus this stateless trigger preserves every constraint the answer protected. The spec's auth-domain table (single record) is extended with this route set — documented here, not slipped in silently.
- **Alternatives**: browser holds INTERNAL key (unacceptable — leaks the relayer to every client); operator script watches for signups and enqueues (breaks "unaided", race-prone); new session-authed enqueue on the relayer itself (second auth story, splits the domain table).

## D5 — Demo-prep: dev-only prep page + one-time LAN key serve; ciphertext stays on-device

- **Decision**: Demo-prep runs **on the demo phone**: `apps/web/demo/prep.html` (dev-only, excluded from build) performs the passkey ceremony and wraps the seeded key into a vault; the key reaches the page via `scripts/demo/prep-serve.ts` — a laptop-side one-time HTTPS endpoint that reads `BUDI_KEY`/`PAKHAJI_KEY` from env, serves each key exactly once to the prep page, prints a loud warning, and exits. The vault ciphertext is stored in the phone's IndexedDB (device-bound, useless elsewhere) plus a persona marker (`persona=budi`); plaintext keys never touch disk, git, or bundles (FR-011 key hygiene; env-only, constitution keys rule). Demo personas' display names come from a small manifest shipped with the demo mode — never a server table.
- **Rationale**: `createSecretVaultWithNewPasskey` requires the passkey ceremony in the phone's browser context, so the wrap must happen on-device; the one-time serve is the minimal honest transfer of an already-env-resident demo testnet key. Re-prepping a replacement phone takes minutes (FR-011's recovery argument for option B).
- **Alternatives**: pasting keys into a form (shoulder-surfing + clipboard history); baking keys into a build (violates SC-004); laptop-side wrap (impossible — ceremony is on the phone).

## D6 — identityHash: client-side, 003's pattern (hash of demo documents + wallet)

- **Decision**: The demo verification step computes `identityHash = keccak256(utf8("kite-demo-v1") || keccak(KTP-file bytes) || keccak(selfie bytes) || wallet)` in the browser and submits it to the trigger route; the demo checker's auto-approve is a labeled client-side component.
- **Rationale**: Follows 003's established semantics (identityHash = hash of identity material; the contract stores only the hash — PLAN §8 keeps `/p/:id` PII-free). Deterministic per user+documents; a re-verification produces the same hash, so the bind job replays idempotently.
- **Alternatives**: server-computed hash (uploads documents — PII to the backend, against the profile design); wallet-only hash (two users with identical demo docs would still differ, but the doc material is the story's point).

## D7 — Signing mechanics: one ceremony per app-open; digest-based intent signing

- **Decision**: Login = passkey assertion → PRF output → derived account + in-memory signing session. The session signs the frozen auth message once (FR-007); in-app actions sign via the session's digest API (message → `hashMessage` → `signDigest` → `{v,r,s}`) with no further biometric prompts until expiry. Refresh persistence: the signed session blob (message + signature) survives in localStorage; the *key* does not — a still-valid blob needs no new ceremony, an expired one routes to sign-in (FR-008/FR-010). Sign-out destroys the blob and ends the session (`end()`); the passkey itself is untouched (FR-009).
- **Rationale**: PLAN D3 ("prompt-free in-app actions"). The signature is the proof; the key is only needed to produce new proofs, so refresh-survival without re-prompt is exactly the blob's validity window.
- **Alternatives**: re-asserting the passkey per action (the friction PLAN D3 exists to kill); sending the derived key to the server (custody — banned).

## D8 — Desktop: CSS phone frame + QR hand-off; no simulated ceremonies

- **Decision**: Coarse-pointer/desktop viewports render the flow inside a fixed phone frame (390×844 CSS) with a QR of the current onboarding URL (`qrcode` lib, client-side). The desktop view shows honest companion state only; every passkey/biometric step instructs the user to the phone. Camera-less desktops are fine — the phone scans.
- **Rationale**: FR-013 / PLAN §8. The QR is static URL encoding — no session or key material transits it.
- **Alternatives**: full desktop flow with platform authenticator (a laptop passkey could technically work, but the demo story is the phone; PLAN §8 fixes the behavior); server-generated QR (needless backend).

## D9 — Testing tiers: unit vectors, catalog scan, browser gates, grep gate

- **Decision**: (1) `bun test` in `apps/api`: the five named session tests (expired → 401 · tampered signature → 401 · valid → 200 + recovered identity · `/api/p/:id` 200 with no session header · MITA route unaffected) using viem-locally-signed vectors; verification service tests with mocked chain client + PGlite `drips`. (2) `bun test` in `apps/web`: banned-words scan over every string in both locale catalogs (zero occurrences — constitution I) + session-blob unit tests. (3) Browser gates (user-run): smoke gate D2, demo-prep, device checklists. (4) `scripts/gates/no-seed-paths.sh` over `apps/web/dist` (SC-004): fails on `bip39|mnemonic|seed phrase|generateMnemonic` (case-insensitive) in any built asset.
- **Rationale**: Constitution IX + 005's D17 two-tier pattern adapted to a frontend: catalogs are the complete set of user-visible strings, so the scan is exhaustive at source level; the digest/grep gate covers the shipped bundle.
- **Alternatives**: jsdom component tests (DOM weight without adding coverage over catalog+unit); lint rule for banned words (source-level only, misses built output).

## D10 — Real-phone HTTPS + RP-ID stickiness: tunnel domain, decided EARLY

- **Decision**: Dev/phone access runs through a tunnel (cloudflared) giving a stable hostname with a valid cert; `@vitejs/plugin-basic-ssl` covers laptop-only localhost dev. **The demo domain is fixed before demo-prep runs** — passkeys and vaults are bound to the RP ID (the domain), so a later domain change invalidates every demo passkey and forces re-prep. This ordering is a gate in quickstart §0.
- **Rationale**: WebAuthn requires a secure context; self-signed certs on real phones are unreliable for ceremonies; RP-ID binding is a Mera/WebAuthn fact (spec Facts). Cheapest mitigation is deciding the domain once, first.
- **Alternatives**: LAN IP + self-signed (flaky on iOS); treating the domain as a deploy detail (the classic day-13 disaster).

## D11 — PWA shape: minimal manifest + SW; no offline story

- **Decision**: `vite-plugin-pwa` with a manifest (name/icon/theme) and a no-network-failing service worker (app shell only; API calls always live). No offline data claims anywhere.
- **Rationale**: The track reads it as a mobile app (PLAN Q6); installability is the signal. An offline cache of money state would fight constitution IV (chain is authority) — so the SW never serves API responses.
- **Alternatives**: full offline-first (violates IV's spirit and wastes days); no SW (drops installability).

## D12 — Data placement: nothing new server-side; users table stays dormant

- **Decision**: 006 adds zero tables and zero columns. Signup data (phone, locale) and the demo persona marker are device-local; verification state is **derived** at read time (chain `identityOf` + `drips` PK) — never cached as truth. The 005 scaffold note's likely activator is Feature 007 (display names — spec Assumptions deferral).
- **Rationale**: Clarified FR-002: no write routes for user data; constitution IV: derived-not-stated state.
- **Alternatives**: caching verification state in a table (a second source of truth to invalidate); activating `users` now (explicitly deferred).

## D13 — Contract deltas: recorded in 006's contracts/, never by editing 005's docs

- **Decision**: The `/api/me` auth swap (session header replaces `x-kite-wallet`) and the verification endpoints are documented in [contracts/auth-session.md](contracts/auth-session.md) + [contracts/web-api.md](contracts/web-api.md) as 006 deltas layered on 005's http-api.md. 005's spec files are history — the delta lives with the feature that made it.
- **Rationale**: Same rule as code: one feature owns its changes; merged specs don't get retro-edited (and 005's implementation session shouldn't see its docs move mid-flight).
- **Alternatives**: editing 005's http-api.md in place (rewrites history under an active implementation; loses the delta trail).

## D14 — Mera dependency posture: pinned version, adapter-isolated, preview-risk owned

- **Decision**: `@category-labs/mera` pinned to an exact version in `apps/web`; every import confined to `mera-adapter.ts` and `demo-adapter.ts` behind the FR-012 interface (`createAccount / signIn / signIntent`). The WebAuthn fallback adapter is a first-class twin with identical UX, activated only by an explicit recorded decision (FR-012's bounty-impact rule). The `smoke` gate (D2) doubles as the upgrade check: bumping the pin re-runs the gate.
- **Rationale**: The library is preview-status (API may change) — the spec's fallback constraint demands the swap be one file, and confinement is what makes that true rather than aspirational.
- **Alternatives**: spreading Mera calls across screens (the rewrite the spec forbids); living at a floating tag (silent breakage).
