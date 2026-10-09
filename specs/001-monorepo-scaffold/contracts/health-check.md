# Contract: Health-Check Script (`bun run health`)

The one external interface this feature exposes to contributors: a single command
that answers "is the repo healthy?" (spec User Story 2, FR-007/FR-008).

## Command

```
bun run health
```

Runs from the repository root. No arguments, no flags, no side effects
(idempotent — spec edge case 5). Implementation: `bun scripts/healthcheck.ts`.

## Output format (stdout)

```
prereq  bun    ok      1.2.x
prereq  forge  ok      0.9.x
ws      apps/web             ok  package.json resolves
ws      apps/api             ok  package.json resolves
ws      apps/relayer         ok  package.json resolves
ws      apps/indexer         ok  package.json resolves
ws      apps/orchestration   ok  package.json resolves
ws      contracts            ok  forge build
ws      packages/contracts   ok  package.json resolves
ws      packages/core        ok  package.json resolves
ws      packages/tsconfig    ok  package.json resolves
9/9 workspaces ok
```

- One line per prerequisite (2) then per workspace (9), PLAN §10 order.
- Failing line format: `…  FAIL  <one-line reason>` (e.g. `missing package.json`,
  `not resolved by root workspaces`, `forge build exited 1`).
- Summary line is always printed last: `N/9 workspaces ok`.

## Exit codes

| Code | Meaning | Spec hook |
|---|---|---|
| 0 | all prerequisites present, all 9 workspaces pass | FR-007, SC-003 |
| 1 | one or more workspaces fail their check | FR-007, SC-004 |
| 2 | a prerequisite tool is missing — its name is printed | FR-008 |

## Guarantees

- Exactly one status line per unit — a single breakage isolates to exactly one
  red line (SC-004).
- Intentionally-empty skeletons (indexer, orchestration, packages/contracts,
  packages/core) report `ok` — emptiness is not a failure (spec edge case 2).
- The script never modifies files, never installs anything, and never repairs
  a failing unit.
