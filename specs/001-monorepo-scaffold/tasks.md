---
description: "Task list for Feature 001 — Monorepo Scaffold"
---

# Tasks: Monorepo Scaffold

**Input**: Design documents from `/specs/001-monorepo-scaffold/`
(plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: No test-framework tasks — the spec defines the gates themselves
(`bun install`, `forge build`, `bun run health`). Verification tasks run the
quickstart.md scenarios.

**Organization**: Grouped by user story; each story is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3)
- Exact file paths in every description

## Path Conventions

Monorepo per plan.md: `apps/*`, `packages/*` (bun workspaces) + `contracts/`
(Foundry unit). Root-level config at repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Root manifests and toolchain config — no workspace content yet.

- [x] T001 Create feature branch `001-monorepo-scaffold` from `main` (constitution X: one feature per merge)
- [x] T002 Create root `package.json`: `"workspaces": ["apps/*", "packages/*"]`, `"packageManager": "bun@<current stable>`, devDependencies `turbo` + `@biomejs/biome`, and scripts exactly per `specs/001-monorepo-scaffold/contracts/root-scripts.md` (`build`, `lint`, `format`, `typecheck`, `health`)
- [x] T003 [P] Create `turbo.json` defining `build`, `lint`, `typecheck` tasks (no outputs caching for `lint`; `build` outputs per package defaults)
- [x] T004 [P] Create root `biome.json` (recommended rules, per research.md D2 — single root config, no per-package overrides)
- [x] T005 [P] Create root `.gitignore`: `node_modules/`, `apps/web/.next/`, `contracts/out/`, `contracts/cache/`, `.turbo/` — commit `bun.lock` and `contracts/lib/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: All nine workspace skeletons exist and the monorepo installs — US1/US2/US3 all build on this.

**⚠️ CRITICAL**: No user-story work can begin until T015 passes.

- [x] T006 [P] Create `packages/tsconfig/package.json` (`@kite/tsconfig`) exporting `tsconfig/base.json` (strict flags only), `tsconfig/nextjs.json` (extends base), `tsconfig/node.json` (extends base, node libs/types) per research.md D6
- [x] T007 [P] Create `packages/core/package.json` (`@kite/core`) + `src/index.ts` empty placeholder + `tsconfig.json` extending `@kite/tsconfig/node.json`
- [x] T008 [P] Create `packages/contracts/package.json` (`@kite/contracts`) + `src/index.ts` empty placeholder + `tsconfig.json` extending `@kite/tsconfig/node.json`
- [x] T009 [P] Create `apps/api/package.json` (`@kite/api`, `type: module`) + `src/index.ts` placeholder + `tsconfig.json` extending `@kite/tsconfig/node.json`
- [x] T010 [P] Create `apps/relayer/package.json` (`@kite/relayer`) + same skeleton shape as T009
- [x] T011 [P] Create `apps/indexer/package.json` (`@kite/indexer`) + same skeleton shape as T009 (Envio arrives Day 10 — empty is correct)
- [x] T012 [P] Create `apps/orchestration/package.json` (`@kite/orchestration`) + same skeleton shape as T009 (CRE arrives Day 10 — empty is correct)
- [x] T013 [P] Scaffold `apps/web` via `bunx create-next-app` (TypeScript, App Router, src-dir, NO Tailwind, NO ESLint — Biome owns linting, per research.md D4); replace the page content in `apps/web/src/app/page.tsx` with a placeholder whose copy avoids all PLAN §3 banned words
- [x] T014 Initialize Foundry project: `forge init contracts --no-commit` — verify `contracts/foundry.toml`, `contracts/src/`, `contracts/test/`, `contracts/lib/forge-std` exist (per research.md D3; NOT a bun workspace member)
- [x] T015 Run `bun install` from repo root: exit 0, single `bun.lock` at root, all 8 bun members resolve (FR-002; quickstart §1)

**Checkpoint**: Foundation ready — 8 bun workspaces + Foundry unit exist and install.

---

## Phase 3: User Story 1 — Fresh clone reaches green in two commands (Priority: P1) 🎯 MVP

**Goal**: `bun install` and `forge build` both succeed from a fresh clone (FR-002, FR-003, SC-001, SC-002).

**Independent Test**: quickstart.md §1 and §2 pass verbatim.

### Implementation for User Story 1

- [x] T016 [US1] Verify the install gate: remove `node_modules/` if present, run `bun install`, confirm exit 0 and that only `bun.lock` exists (no per-workspace lockfiles) — quickstart §1
- [x] T017 [US1] Verify the build gate: run `forge build` in `contracts/` (scaffold contract compiles, < 1 min), then run root `bun run build` and confirm the turbo pipeline + forge both succeed — quickstart §2
- [x] T018 [US1] Fresh-clone rehearsal: `git clone` the branch to a temp dir, run `bun install` + `forge --root contracts build`, confirm both green (SC-001 end-to-end), then delete the temp clone

**Checkpoint**: User Story 1 independently functional — the PLAN §12 Day-1 build gate passes.

---

## Phase 4: User Story 2 — One health-check prints every workspace status (Priority: P2)

**Goal**: `bun run health` reports 2 prerequisites + 9 workspaces with exit-code semantics (FR-001, FR-007, FR-008, SC-003, SC-004).

**Independent Test**: quickstart.md §3, §4, §5 pass verbatim.

### Implementation for User Story 2

- [x] T019 [US2] Implement `scripts/healthcheck.ts` exactly per `specs/001-monorepo-scaffold/contracts/health-check.md`: prerequisite checks (`bun`, `forge` via `--version`), 9 workspace checks in PLAN §10 order (bun members: dir + parseable `package.json` + resolves in root globs; `contracts/`: `foundry.toml` + `forge build`), summary line `N/9 workspaces ok`, exit codes 0/1/2, no side effects
- [x] T020 [US2] Wire `health` root script to `bun scripts/healthcheck.ts` in `package.json` (per contracts/root-scripts.md) and confirm `bun run health` prints 11 lines + summary, exit 0 — quickstart §3
- [x] T021 [US2] Breakage-isolation verification: temporarily move `apps/relayer/package.json` away, confirm exactly one `FAIL` line and `exit=1`, restore, confirm `9/9` + exit 0 (SC-004) — quickstart §4
- [x] T022 [US2] Prerequisite-reporting verification: run with `forge` hidden from PATH, confirm exit 2 and output naming `forge` (not a stack trace) — quickstart §5

**Checkpoint**: Stories 1 AND 2 both independently functional.

---

## Phase 5: User Story 3 — Uniform quality baseline (Priority: P3)

**Goal**: One root lint/format config and one strict TS source, inherited by every TS workspace (FR-009, FR-010).

**Independent Test**: quickstart.md §6 passes verbatim.

### Implementation for User Story 3

- [x] T023 [US3] Run `bun run lint` (`biome check .`): green on untouched skeletons; fix any config issue at ROOT only — never add a per-workspace biome config (FR-009)
- [x] T024 [US3] Verify inheritance: `grep -r '"extends"' apps/*/tsconfig.json packages/*/tsconfig.json` shows every TS workspace extending `@kite/tsconfig/*` (web → nextjs.json; others → node.json) — quickstart §6

**Checkpoint**: All stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Whole-feature acceptance before merge.

- [x] T025 Run the full `specs/001-monorepo-scaffold/quickstart.md` end-to-end (§1–§6) — all green (constitution IX: gates before progress)
- [x] T026 Zero-business-logic review (SC-005, FR-011): no Kite contract functions, endpoints, handlers, screens, or workflow code anywhere; `apps/web` placeholder copy avoids PLAN §3 banned words — quickstart §7
- [x] T027 Commit history check + merge: commits land in-window with one logical commit per task group (constitution X), then merge `001-monorepo-scaffold` (one feature per merge)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately (T002 before T015; T003–T005 parallel)
- **Foundational (Phase 2)**: depends on Phase 1 — T006–T014 are mutually parallel; T015 depends on ALL of T006–T014
- **User Stories (Phases 3–5)**: each depends on T015; stories are otherwise independent (US2/US3 do not require US1's verification tasks to pass, but run them in priority order when solo)
- **Polish (Phase 6)**: depends on all user stories complete

### User Story Dependencies

- **US1 (P1)**: after T015 — no other-story dependencies
- **US2 (P2)**: after T015 — needs the 9 units to exist (T014 included), not US1's verifications
- **US3 (P3)**: after T015 — needs TS workspaces to exist, not US1/US2 outcomes

### Within Each User Story

- Verify gates in quickstart order (install → build → health → lint)
- T019 → T020 → T021 → T022 are sequential (implement → wire → verify → verify)

### Parallel Opportunities

- T003, T004, T005 (different root files)
- T006–T013 (eight independent workspace skeletons)
- US1 §rehearsal (T018) can run while US2 implementation (T019) proceeds — different concerns
- T025/T026 are independent reviews (different checks) once stories are done

---

## Parallel Example: Phase 2 skeletons

```bash
# Eight workspace skeletons are independent files — launch together:
Task T006: "packages/tsconfig bases in packages/tsconfig/"
Task T007: "packages/core skeleton in packages/core/"
Task T008: "packages/contracts skeleton in packages/contracts/"
Task T009: "apps/api skeleton in apps/api/"
Task T010: "apps/relayer skeleton in apps/relayer/"
Task T011: "apps/indexer skeleton in apps/indexer/"
Task T012: "apps/orchestration skeleton in apps/orchestration/"
Task T013: "apps/web Next.js placeholder in apps/web/"
# Then the gate: T015 bun install must see all of them.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (setup) → Phase 2 (skeletons + install green)
2. Phase 3: verify install + build gates
3. **STOP and VALIDATE**: fresh clone passes both commands — this alone satisfies the PLAN Day-1 gate
4. Continue to US2 (health-check) and US3 (quality baseline) as time allows

### Incremental Delivery

1. Setup + Foundational → repo installs
2. US1 → two-command green (MVP)
3. US2 → single-command health visibility
4. US3 → uniform quality baseline
5. Polish → full quickstart pass, zero-logic review, in-window merge

---

## Notes

- [P] tasks = different files, no dependencies
- Every verification task cites its quickstart.md section — run it verbatim
- No test-framework tasks: the gates ARE the tests for a scaffold (per spec/plan)
- Commit after each task group; never commit a red `bun run health`
- Frozen stack: no pnpm/yarn/npm, no Hardhat, no Python — reject any task solution introducing them
