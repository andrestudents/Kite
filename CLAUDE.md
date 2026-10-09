# Kite — rules for every session
Source of truth: PLAN.md (frozen). If code and PLAN.md disagree, PLAN.md wins —
propose a PLAN change first, never deviate silently.

Non-negotiables:
- Money is integers in AUSD base units (6 dp) everywhere (contracts, DB, API). No floats.
  IDR/MYR are display-only, via /api/quote.
- Contracts: Foundry + Solidity 0.8.x + OpenZeppelin 5.x, UUPS + ERC-7201 modules. Never Hardhat.
- Gas measured on Monad (charged on the limit, not used); publish fixed limits to packages/contracts.
- Envio indexer is a projection. The contract is the only authority for score/limits/state.
- RELAYER_ROLE / ORCHESTRATOR_ROLE can never move user funds beyond the functions in PLAN §6.2.
- Pause is asymmetric: block draft/activate; NEVER block receiveIncome / completeAtTerm.
- Simulated components are labeled "Demo Tool" (Mitra console, verification, FX source).
- Banned words in user-facing UI strings: wallet, gas, chain, token, pending, seed (PLAN §3).
- A feature is done ONLY when its "Done when" gate passes with commands I can run myself.

Workflow: we use spec-kit SDD. Every spec/task must cite the PLAN section it implements.
