# TRUST.md — what to trust, what not to, stated plainly

Source of truth for the full trust narrative: [PLAN.md §9](PLAN.md). This file is
built up feature by feature through the PLAN §12 days; today it carries the
disclosures the testnet deployment owes a judge (Feature 004, spec FR-018).

## Demo deployment disclosures

These rows apply to the Monad testnet deployment recorded in
[contracts/script/DEMO-ACCOUNTS.md](contracts/script/DEMO-ACCOUNTS.md) and published
to [`packages/contracts`](packages/contracts/src/addresses.ts). They are repeated at
every deployment run — the deploy script prints them; nothing relies on this file
being read alone.

| # | Disclosure | Detail |
|---|-----------|--------|
| 1 | **Composed event gap: 60 seconds (demo), not production** | Production deployments initialize `minEventGap` to **60 days** (PLAN §6.2 clarification, 2026-10-10). The demo deployment initializes it to **60 s** so a seeded, mid-season profile can be built in ~5 minutes of wall-clock instead of ~120 days. The gap is a governed `initialize()` parameter — **init-once, no setter** — so the demo value is permanent for this deployment and visible to anyone via `minEventGap()` on the proxy. The seeded income history is therefore *compressed-time*, not spontaneous: every qualifying event still waited ≥ the configured gap, and the contract-enforced rule is identical, only the constant differs. |
| 2 | **Settlement asset (`ausdIsMock`)** | The demo deployment settles in **MockAUSD — a "Demo Tool"**, a 6-decimal ERC-20 with ERC-2612 permit + ERC-3009 transfer-with-authorization surface, unless a real AUSD address was attached via `AUSD_ADDRESS` at deploy time (preflight: code, 6 decimals, funded holder). `ausdIsMock: true/false` is published in `addresses.ts` and printed by the deploy script. KiteCore takes the asset as an `initialize()` parameter — swapping in production AUSD requires no contract change, only a fresh deployment. |
| 3 | **Throwaway ISA (manual proof loop)** | The judge-runnable loop in [contracts/script/MANUAL-LOOP.md](contracts/script/MANUAL-LOOP.md) uses **throwaway keys generated with `cast wallet new`**, funded by the deployer, and leaves one extra ISA in the on-chain state. It is a prepared demonstration of the draft → activate → receiveIncome → CompletedCapped path, not organic user activity. |

## What this feature does NOT yet claim

- Verification status lives at the gate, not in prose: a contract is "verified" only
  while its Monadscan URL shows source (SC-003). Re-check the URLs in
  DEMO-ACCOUNTS.md rather than trusting any statement here.
- The full §9 table (split honesty, operator centralization, backer risk "this is not
  a bond", collusion open problem, regulation/Sharia posture) lands with the
  integration days of PLAN §12 and is **not** part of this feature's rows.
