# Research: Monorepo Scaffold (Phase 0)

All Technical Context unknowns were resolved by the user constraint input, PLAN §10–11,
and current documentation (Turborepo, Bun, Biome official guides, checked 2026-10-09).
No NEEDS CLARIFICATION markers remained. Decisions below with rationale and rejected
alternatives.

## D1: Bun + Turborepo wiring

- **Decision**: Root `package.json` declares `"workspaces": ["apps/*", "packages/*"]`
  and `"packageManager": "bun@<pinned>"`; Turborepo is a root devDependency driving
  `turbo.json` tasks (`build`, `lint`, `typecheck`). Bun is the only package manager —
  `bun install` produces the single shared `bun.lock`.
- **Rationale**: Bun workspaces are npm-style; Turborepo orchestrates tasks across them.
  Pinning via `packageManager` keeps contributor machines and (future) CI reproducible
  and avoids Turbo's "no package manager declared" failure mode.
- **Alternatives considered**: pnpm/yarn/npm workspaces — rejected by user constraint
  (frozen stack). Running everything through plain bun scripts without Turborepo —
  rejected: PLAN §10 names Turborepo, and task caching/parallelism pays off across 8
  workspaces from Day 2.

## D2: Biome at root, inherited everywhere

- **Decision**: One `biome.json` at the repository root using recommended rules;
  no per-workspace Biome configs. Root script `bun run lint` → `biome check .`.
- **Rationale**: Biome discovers config by walking up the directory tree, so a single
  root config covers all TS workspaces with zero per-package files — exactly FR-009
  (no divergent lint/format config).
- **Alternatives considered**: Nested per-package `biome.json` overrides — rejected:
  divergence is what FR-009 forbids. ESLint + Prettier — rejected by PLAN §10 (Biome
  at root) and by speed on a hackathon timeline.

## D3: contracts/ is a Foundry unit, not a bun member

- **Decision**: `contracts/` is initialized with `forge init contracts --no-commit`
  and stays outside the bun workspaces globs. The health-check treats it as the ninth
  workspace, its check being "foundry.toml exists AND `forge build` succeeds".
- **Rationale**: Foundry has its own dependency tree (`lib/forge-std`) that must not
  leak into `bun.lock`. `--no-commit` avoids forge touching git while scaffolding
  inside an existing repo.
- **Alternatives considered**: Making `contracts/` also a bun package with forge
  wired as scripts — rejected: couples two dependency managers for zero scaffold
  value. Hardhat — rejected by user constraint and constitution (Hard Constraints:
  "Hardhat is forbidden").

## D4: apps/web placeholder via create-next-app, minimal flags

- **Decision**: Scaffold with `bunx create-next-app` (TypeScript, App Router, no
  Tailwind, no ESLint — Biome owns linting, src-dir layout). The delivered page is a
  single placeholder with no product copy; banned-word check (PLAN §3) applies even
  here as a review step.
- **Rationale**: Non-interactive flags give a reproducible strict-TS App Router base;
  deferring Tailwind/viem/wagmi keeps FR-011 (zero business logic) airtight — UI
  dependencies arrive with the first screen feature (PLAN §8, Day 8–9).
- **Alternatives considered**: Hand-rolled minimal Next config — rejected: more
  files to maintain than the scaffold tool output. Including Tailwind now — rejected:
  unused tooling violates the skeleton-only scope.

## D5: Health-check is a bun TypeScript script

- **Decision**: `scripts/healthcheck.ts`, exposed as root script
  `bun run health`. Sequence: (1) check prerequisites `bun`, `forge` via
  `--version`; (2) for each of the 8 bun workspaces: directory exists, `package.json`
  parses, name resolves against root globs; (3) for `contracts/`: `forge build`;
  (4) print one line per unit + summary; exit 0 all-ok / 1 any workspace fail /
  2 missing prerequisite. Full I/O contract: [contracts/health-check.md](contracts/health-check.md).
- **Rationale**: Bun runs TS directly — no build step for the checker itself. Distinct
  exit codes make FR-008 ("name the missing tool, not a stack trace") testable.
  `forge build` (not just file presence) is the contracts check because
  "compiles" is the actual Day-1 gate (FR-003).
- **Alternatives considered**: Bash script — rejected: Windows contributors get
  inconsistent behavior; TS is the repo's language. A Turborepo task as the health
  check — rejected: turbo tasks are per-workspace pipelines, awkward for
  cross-cutting presence/prerequisite checks and exit-code semantics.

## D6: packages/tsconfig exported bases

- **Decision**: `packages/tsconfig` exports `base.json` (strict flags),
  `nextjs.json` (extends base, Next-specific), `node.json` (extends base, node
  runtime). Every TS workspace's `tsconfig.json` extends one of them via
  `"extends": "@kite/tsconfig/nextjs.json"` (workspace dependency).
- **Rationale**: FR-010 — one source of strictness; runtime variants differ in
  `"lib"`/`"types"` only. Strict-everywhere is the user's constraint.
- **Alternatives considered**: A single `base.json` only — rejected: Next needs its
  own jsx/module settings and node needs different libs; duplicating those per
  workspace re-creates drift. tsconfig paths per app — rejected: drift again.

## D7: Workspace naming scope

- **Decision**: Bun workspace package names use the `@kite/*` scope
  (`@kite/web`, `@kite/api`, `@kite/tsconfig`, …) matching PLAN §10's
  `packages/contracts` reference to `@kite/contracts`.
- **Rationale**: PLAN §7.1 already cites `@kite/contracts` as the published-ABI
  package; adopting the scope now avoids renames later.
- **Alternatives considered**: Unscoped names — rejected: rename churn on Day 4+.

## Sources

- Turborepo — Structuring a repository: https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository
- Bun — Configuring a monorepo using workspaces: https://bun.com/guides/install/workspaces
- Biome — Use Biome in big projects: https://biomejs.dev/guides/big-projects
- Biome — Configuration reference: https://biomejs.dev/reference/configuration
- PLAN.md §10–11 (stack and layout), user constraint input (frozen stack, no alternatives)
