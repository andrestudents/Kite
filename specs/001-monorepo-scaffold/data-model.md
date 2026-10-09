# Data Model: Monorepo Scaffold (Phase 1)

This feature persists nothing — every entity below is structural (repo shape) or
ephemeral (a single health-check run). They exist so tasks and the health-check
contract share one vocabulary.

## Workspace

A repo unit tracked by the root manifest and reported by the health-check.
Nine exist per FR-001.

| Field | Type | Values / Validation |
|---|---|---|
| name | string | package name for bun members (`@kite/web`, …); `contracts` for the Foundry unit |
| path | string | `apps/web`, `apps/api`, `apps/relayer`, `apps/indexer`, `apps/orchestration`, `contracts`, `packages/contracts`, `packages/core`, `packages/tsconfig` |
| kind | enum | `app` · `package` · `foundry` |
| membership | enum | `bun-workspace` (8 members, resolved via root globs `apps/*`, `packages/*`) · `foundry` (contracts/ only) |
| healthCheck | rule | bun member: directory exists AND `package.json` parses AND name resolves in root globs. foundry: `foundry.toml` exists AND `forge build` exits 0 |

Rules: no orphan members (declared but missing) and no phantom members
(directories present but unresolvable) — both are health failures (spec edge
case 3). Exactly one Foundry unit.

## Prerequisite

A tool the contributor must have before any gate can run.

| Field | Type | Values / Validation |
|---|---|---|
| tool | enum | `bun` · `forge` |
| detected | boolean | `<tool> --version` exits 0 |
| version | string? | first line of `--version` output, shown when detected |

Note: `turbo` and `biome` are workspace dependencies invoked through bun, not
prerequisites. Missing prerequisite → health-check exit code 2 and the tool name
in output (FR-008).

## HealthReport

Ephemeral output of one health-check run (see [contracts/health-check.md](contracts/health-check.md)).

| Field | Type | Values |
|---|---|---|
| lines | list[Workspace or Prerequisite] | prerequisites first, then the 9 workspaces, PLAN §10 order |
| status | enum | `ok` · `fail` |
| detail | string | one-line reason on failure |
| exitCode | enum | 0 all ok · 1 any workspace fail · 2 missing prerequisite |

Aggregation rule: overall exit is the worst status encountered; never
silently repairs or skips a failing unit (mirrors the PLAN's reconciliation
convention).
