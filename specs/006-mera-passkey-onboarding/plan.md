# Implementation Plan: Invisible Account — Mera Passkey Onboarding

**Branch**: `006-mera-passkey-onboarding` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-mera-passkey-onboarding/spec.md`
(clarified 2026-10-10: parity = passkey-protected seeded keys; server-verified session;
device-local signup data, no user-data writes).

**Builds on**: Feature 005 **merged** (constitution X — branch from its merge; the API
extensions below edit files 005 created). 006 must not begin implementation in the tree
while 005 is still open.

## Summary

A new `apps/web` PWA makes the account invisible: a single biometric approval creates a
Mera passkey-derived account; a phone step and a labeled demo verification follow; the
backend binds the identity and drips the fee allowance via the two existing 005 relayer
jobs; the user lands on Home with zero crypto vocabulary. Login creates a signing
session over a frozen message format, verified server-side by ecrecover (identity
recovered, never asserted) on user-scoped routes. Demo phones log in as 004's seeded
personas through passkey-wrapped keys (Mera secret vaults), prepared by a labeled
one-time demo-prep flow, with a verification-first smoke gate before anything builds on
the primitive. Desktop renders the flow in a phone frame with a QR hand-off. Technical
approach: Vite + React + TypeScript PWA; `@category-labs/mera` behind an origin-agnostic
auth adapter (`createAccount / signIn / signIntent`) with a WebAuthn fallback twin; small
`apps/api` additions (session middleware, verification trigger routes, relayer enqueue
client); **no schema changes, no new job kinds, no contract changes**.

## Technical Context

**Language/Version**: TypeScript throughout; Bun 1.4.2 (repo pin) for install/test/tooling; `apps/web` served by Vite dev server and built to static `dist/`.

**Primary Dependencies**: `@category-labs/mera` (client-side passkey/vault/session), `viem` (browser signing + server-side `recoverMessageAddress`), React 19 + Vite 7 + Tailwind 4 + `vite-plugin-pwa` (`apps/web`), `qrcode` (desktop hand-off), Hono middleware additions (`apps/api`). ABIs/addresses only from `@kite/contracts`.

**Storage**: No server schema changes (users table stays dormant — research D12). Device-local only: session blob, signup data (phone/locale), demo persona marker + vault ciphertext (IndexedDB/localStorage). The shared Neon DB is read (not written) for the drip read-back.

**Testing**: `bun test` — session middleware (5 named vectors), verification service, locale banned-words scan, `derive.test.ts` structural hygiene (amended FR-014). Browser smoke gate (wrap → ceremony → unwrap → correct address). `scripts/gates/no-seed-paths.sh` — user-facing-surface scan + import confinement (SC-004 as amended). Device checklist gates in [quickstart.md](quickstart.md) (SC-001/002/003).

**Target Platform**: Mobile PWA on real iOS/Android phones (secure context mandatory); desktop companion view. Monad testnet 10143.

**Project Type**: web-app (PWA) + minimal extensions to the existing API service.

**Performance Goals**: SC-001 — brand-new user to acting account ≤ 2 minutes on a real phone; first load < 3 s on 4G; zero per-action prompts while a session is valid.

**Constraints**: HTTPS + **final production RP ID pinned at T004, before any device ceremony** (passkeys/vaults bind to the rpId irreversibly — research D10, mera-docs-map); banned words zero in rendered strings; session expiry ≤ 7 days; no mnemonic material on any user-facing surface and no custody backend (SC-004 as amended — raw `bip39` identifiers in the bundle are the legitimate app-side derivation path); money display-only via `/api/quote` (integers everywhere).

**Scale/Scope**: Demo scale — 2 seeded personas + judge fresh signups; ~6 screens.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Basis |
|-----------|---------|-------|
| I — Invisible blockchain | PASS | The feature IS principle I; banned-words is a test over locale catalogs (research D9), not a promise |
| II — Foundry/OZ contracts | PASS (N/A) | No contract changes; bind/drip already exist from 003–005 |
| III — Gas on the limit | PASS (N/A) | No new tx senders; relayer jobs reuse published limits |
| IV — Contract is authority | PASS | Readiness = `identityOf` read-back + drip balance read-back; nothing user-asserted |
| V — Anti-collusion | PASS (N/A) | No new money paths |
| VI — Integer money | PASS | AUSD base units to the UI; IDR/MYR display-only via `/api/quote` lock |
| VII — Pause asymmetry | PASS (N/A) | No pausable surface touched |
| VIII — Demo Tool labels | PASS | Demo verification checker, demo-prep tooling, smoke page all labeled |
| IX — User-runnable gates | PASS | quickstart.md §2–§8: every gate a command or scripted device step |
| X — One feature per merge | PASS | Branches from 005's merge; window-dated commits |

Hard constraints: keys env-only (demo-prep serves them one-time from env, never into git/bundles); PLAN frozen (the PLAN §8 display-name tension is flagged for 007's clarify, not improvised here).

**Post-Phase-1 re-check**: unchanged — the design adds no tables, no job kinds, no contract calls beyond existing ones. **No Complexity Tracking entries (no violations).**

## Project Structure

### Documentation (this feature)

```text
specs/006-mera-passkey-onboarding/
├── plan.md              # This file
├── research.md          # Phase 0 output — D1–D14
├── data-model.md        # Phase 1 output — device-local + derived entities, DTOs
├── quickstart.md        # Phase 1 output — validation/run guide (gates §2–§8)
├── contracts/
│   ├── auth-session.md  # Frozen session format + the single auth-domain record
│   └── web-api.md       # Verification endpoints + /api/me usage delta
└── tasks.md             # /speckit-tasks output (next command)
```

### Source Code (repository root)

```text
apps/web/                        # NEW — the PWA
├── index.html                   # shipped entry (the only build input)
├── smoke/index.html             # dev-only verification-first gate — excluded from build
├── demo/prep.html               # dev-only demo-prep page — excluded from build
├── vite.config.ts               # build input = index.html ONLY
├── env.example                  # VITE_API_URL (names only)
└── src/
    ├── main.tsx
    ├── auth/                    # THE seam (FR-012)
    │   ├── types.ts             # createAccount / signIn / signIntent interface
    │   ├── mera-adapter.ts      # PRF derivation + signing sessions (primary)
    │   ├── webauthn-adapter.ts  # identical-UX fallback twin
    │   ├── demo-adapter.ts      # vault-wrapped seeded keys — labeled demo mode
    │   └── session.ts           # frozen-format auth message + header builder
    ├── api/                     # /api/me, /api/me/verification, /api/quote clients
    ├── screens/                 # Signup, Phone, Verify (Demo Tool), Home, DesktopFrame+QR
    ├── locales/                 # id.ts / ms.ts typed catalogs (banned-words fixtures)
    └── lib/                     # money display, identityHash, qr, persona manifest
apps/api/                        # 005 tree, EXTENDED
├── src/middleware/session.ts    # NEW — ecrecover + expiry (contracts/auth-session.md)
├── src/routes/verification.ts   # NEW — GET/POST /api/me/verification
├── src/services/relayer-client.ts # NEW — INTERNAL-keyed enqueue (deterministic clientRefs)
└── src/routes/me.ts             # EDIT — swap x-kite-wallet for session middleware
scripts/
├── gates/no-seed-paths.sh       # NEW — SC-004 (amended): user-facing-surface scan + bip39 import confinement
└── demo/prep-serve.ts           # NEW — one-time LAN key server for demo-prep (env keys)
packages/contracts, packages/core  # UNCHANGED
```

**Structure Decision**: `apps/web` is the PLAN §10 workspace slot for the consumer app —
no new package beyond it. The tooling pages (`smoke/`, `demo/`) live inside `apps/web`
as separate HTML entries and ARE build inputs, deployed to the production domain: their
ceremonies bind to the production rpId (T005's gate, T024's wraps — amended with the
final-URL-first rule), and they stay unlinked from the app shell (no nav/route
references; the prep page is inert without the laptop's one-time key server). API additions stay
in the existing `apps/api` service — a second backend app would need constitution
justification and has none.
