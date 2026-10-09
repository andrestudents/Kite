# Implementation Plan: Monorepo Scaffold

**Branch**: `001-monorepo-scaffold` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-monorepo-scaffold/spec.md`
**PLAN citation**: §10 (repo layout), §11 (networks/services — only toolchain selection applies), §12 Day 1

## Summary

Build the PLAN §10 workspace skeleton with zero business logic: a Bun + Turborepo
monorepo whose eight TypeScript workspaces (`apps/web`, `apps/api`, `apps/relayer`,
`apps/indexer`, `apps/orchestration`, `packages/contracts`, `packages/core`,
`packages/tsconfig`) live under one root manifest with one shared lockfile, plus a
separate Foundry project in `contracts/` where the default scaffold contract compiles.
Biome is configured once at the root and inherited by every TS workspace. One
health-check script reports the status of all nine workspaces and exits non-zero on
any failure — the first instance of the repo's "done when you can run it yourself"
gate culture (Constitution IX).

## Technical Context

**Language/Version**: TypeScript (strict) on the Bun runtime; Solidity via Foundry's
default scaffold contract only. Bun version pinned via `"packageManager"` in the root
manifest (resolved at implementation time to the current stable).

**Primary Dependencies**: Bun (package manager + script runtime), Turborepo (task
orchestrator), Biome (lint + format, root only), Next.js App Router (placeholder page
in `apps/web` only), Foundry (`forge`) for `contracts/`.

**Storage**: N/A — no database, no chain calls, no persistence (per user constraint).

**Testing**: The scaffold's gates ARE its tests — `bun install` (FR-002), `forge build`
(FR-003), and the health-check script (FR-007). Formal test suites arrive with the
features that own logic.

**Target Platform**: Contributor machines (WSL2/Linux, macOS); local repository only.

**Project Type**: Monorepo scaffold (build infrastructure).

**Performance Goals**: SC-001 fresh install < 5 min; SC-002 `forge build` < 1 min;
SC-003 health-check < 1 min.

**Constraints**: No DB, no chain calls, no CI, no deployment. Stack is frozen per
user constraint: no pnpm/yarn/npm, no Hardhat, no Python. Zero business logic
(FR-011).

**Scale/Scope**: 8 bun workspace members + 1 Foundry project = 9 health-check lines;
~20 files of config/placeholder total.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Invisible Blockchain | N/A | No consumer UI in this feature; the web placeholder copy MUST NOT use banned words (PLAN §3) — noted in quickstart as a review check |
| II | Fairness Is Physics | N/A | No deal logic exists (FR-011) |
| III | Atomic Settlement | N/A | No money paths exist |
| IV | Contract Is the Only Authority | N/A | Nothing indexed, no chain reads |
| V | Facts vs Decisions | N/A | No orchestration exists yet |
| VI | Integer Money | N/A | No money code at all; arrives with feature 002+ |
| VII | Humane by Design | N/A | No stream/pause logic exists |
| VIII | Honesty Boundary | N/A | Nothing simulated in this feature; health-check is real tooling |
| IX | Gates Before Progress | **PASS** | The feature exists to build the gate: health-check exits non-zero on failure (FR-007), mirroring never-fail-silently |
| X | Honest Git History | **PASS** | Commits land inside the hackathon window, one feature per merge, on `001-monorepo-scaffold` |

**Post-Phase-1 re-check**: PASS — the design (research.md, data-model.md, contracts/)
introduces no violations; no complexity justifications required.

## Project Structure

### Documentation (this feature)

```text
specs/001-monorepo-scaffold/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── health-check.md  # CLI contract of the health-check script
│   └── root-scripts.md  # Root package.json scripts contract
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
.
├── package.json           # root: workspaces ["apps/*", "packages/*"], packageManager bun@x, scripts
├── bun.lock               # single shared lockfile (generated)
├── turbo.json             # task pipeline: build, lint, format, typecheck
├── biome.json             # ONE root config; TS workspaces inherit by directory walk-up
├── scripts/
│   └── healthcheck.ts     # the FR-007 health-check (run: bun run health)
├── apps/
│   ├── web/               # Next.js App Router, TS strict, single placeholder page, no screens
│   ├── api/               # empty skeleton: package.json + src/index.ts placeholder + tsconfig
│   ├── relayer/           # empty skeleton: same shape as api
│   ├── indexer/           # empty skeleton: same shape as api (Envio arrives Day 10)
│   └── orchestration/     # empty skeleton: same shape as api (CRE arrives Day 10)
├── contracts/             # Foundry project (NOT a bun member): foundry.toml, src/, test/, lib/forge-std
└── packages/
    ├── contracts/         # empty package skeleton (ABIs arrive with contract features)
    ├── core/              # empty package skeleton (helpers arrive with money features)
    └── tsconfig/          # exported bases: base.json (strict), nextjs.json, node.json
```

**Structure Decision**: PLAN §10 monorepo. Eight bun workspaces resolve through the
root manifest globs `["apps/*", "packages/*"]`; `contracts/` is deliberately outside
the bun workspace — it is a Foundry unit governed by `forge`, tracked by the
health-check as the ninth workspace (see research.md D3). The spec's "members of the
single root workspace" is read as: declared repo units under one root manifest /
health-check umbrella — bun membership for TS, Foundry membership for `contracts/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. The nine-unit structure is PLAN §10-mandated, not a speculative choice.
