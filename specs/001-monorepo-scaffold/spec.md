# Feature Specification: Monorepo Scaffold

**Feature Branch**: `001-monorepo-scaffold`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "Feature 001 — Monorepo scaffold. Source of truth: PLAN.md §10 (repo layout) and §12 day 1. Build the workspace skeleton only, zero business logic: Bun + Turborepo workspaces — apps/web (Next.js placeholder), apps/api, apps/relayer, apps/indexer, apps/orchestration (empty CRE workspace), contracts/ (Foundry init), packages/contracts, packages/core, packages/tsconfig — Biome at root. Done when: bun install succeeds, forge build succeeds, and one health-check script prints the status of every workspace."

**PLAN citation**: §10 (Repo layout), §12 Day 1 (29 Sep — new repo, monorepo). The plan file is currently named `Plan-Kite.md`; this spec cites it as "PLAN" per CLAUDE.md convention.

## User Scenarios & Testing *(mandatory)*

The user of this feature is the **project contributor** (developer or agent session).
Value delivered: every later feature lands into a workspace that already installs,
builds, and reports its status — nobody scaffolds by hand again.

### User Story 1 - Fresh clone reaches green in two commands (Priority: P1)

A contributor clones the repository onto a machine with the standard toolchain
already installed and runs the root install command, then the contract build
command. Both succeed with no manual per-workspace setup.

**Why this priority**: this is the PLAN §12 Day-1 gate and the foundation every
other feature stands on; if it fails, nothing else can be built or verified.

**Independent Test**: on a fresh clone, run the root install command (all JS/TS
workspaces resolve and install) and the contract build command inside `contracts/`
(the scaffold contract compiles). No other feature is needed to verify this.

**Acceptance Scenarios**:

1. **Given** a fresh clone and the standard toolchain present, **When** the
   contributor runs the root install command, **Then** it exits zero and creates
   a single shared lockfile covering every workspace member.
2. **Given** a completed install, **When** the contributor runs the contract
   build command in `contracts/`, **Then** it exits zero and compiles the default
   scaffold contract.
3. **Given** any workspace member referenced by the root manifest, **When** the
   install completes, **Then** every declared member directory exists and is
   recognized as part of the workspace (no orphan or phantom members).

---

### User Story 2 - One health-check prints the status of every workspace (Priority: P2)

A contributor runs a single health-check script from the repository root and sees
one status line per workspace (9 total: five under `apps/`, `contracts/`, three
under `packages/`), plus an overall pass/fail summary. The script exits non-zero
if any workspace fails its check.

**Why this priority**: the PLAN's verification culture ("done when" gates the user
can run unaided — Constitution IX) needs one command that answers "is the repo
healthy?" without knowing the internal layout.

**Independent Test**: run the script; verify it lists all nine workspaces with a
green status and exits zero. Break one workspace on purpose (e.g., temporarily
rename a manifest) and verify the script reports it red and exits non-zero.

**Acceptance Scenarios**:

1. **Given** a fully installed and buildable repository, **When** the contributor
   runs the health-check script, **Then** it prints one status line for each of
   the nine workspaces and exits zero.
2. **Given** a workspace that fails its check (missing, unresolvable, or
   non-building), **When** the contributor runs the health-check script, **Then**
   that workspace is reported as failing and the script exits non-zero.
3. **Given** a machine missing a prerequisite tool, **When** the contributor runs
   the health-check script, **Then** the output names the missing prerequisite
   instead of failing obscurely.

---

### User Story 3 - Uniform quality baseline from the first commit (Priority: P3)

A contributor editing any TypeScript workspace gets the same lint/format rules
and the same compiler settings as every other workspace, because both are defined
once at the root and consumed by members. No workspace carries its own divergent
configuration.

**Why this priority**: prevents drift across eight TS workspaces over a 15-day
build; cheap to do now, expensive to retrofit.

**Independent Test**: run the root lint/format check; it applies to all TS
workspaces. Verify each TS workspace's compiler config extends the shared one.

**Acceptance Scenarios**:

1. **Given** the scaffold is complete, **When** the contributor runs the root
   lint command, **Then** it applies to every TypeScript workspace member and
   exits zero on the untouched skeletons.
2. **Given** any TypeScript workspace, **When** inspected, **Then** its compiler
   configuration extends the shared root TypeScript package rather than
   duplicating settings.

### Edge Cases

- A machine missing one of the prerequisite tools (package runtime, build
  toolkit): the health-check MUST name the missing tool and which gate needs it,
  rather than printing a raw stack trace.
- Workspaces that are intentionally empty skeletons (indexer, orchestration,
  packages/contracts, packages/core): the health-check MUST report them as
  present-and-healthy skeletons, not as failures for having no code.
- A renamed or deleted workspace directory that is still referenced by the root
  manifest: install MUST fail loudly (broken reference), and the health-check
  MUST flag the mismatch.
- Corrupted or stale lockfile: a clean reinstall from the committed lockfile
  MUST reproduce a working state.
- Running the health-check twice in a row MUST be idempotent (no side effects,
  same result).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST contain exactly the nine PLAN §10 workspaces:
  `apps/web`, `apps/api`, `apps/relayer`, `apps/indexer`, `apps/orchestration`,
  `contracts/`, `packages/contracts`, `packages/core`, `packages/tsconfig`,
  all recognized as members of the single root workspace.
- **FR-002**: The root install command MUST succeed on a fresh clone and produce
  one shared lockfile covering all workspace members.
- **FR-003**: `contracts/` MUST be a Foundry project in which the build command
  succeeds against the default scaffold contract.
- **FR-004**: `apps/web` MUST serve a placeholder page only — no PLAN §8 screens,
  no routing beyond the scaffold default, no business logic.
- **FR-005**: `apps/api`, `apps/relayer`, `apps/indexer`, and
  `apps/orchestration` MUST exist as resolvable, buildable/typecheckable empty
  skeletons with zero business logic (no endpoints, no handlers, no job code).
- **FR-006**: `packages/contracts` and `packages/core` MUST exist as empty
  package skeletons (no generated ABIs, no helpers yet — later features fill
  them).
- **FR-007**: One root health-check script MUST print a status line for each of
  the nine workspaces plus an overall summary, and MUST exit non-zero when any
  workspace fails its check (mirroring the PLAN's never-fail-silently
  convention).
- **FR-008**: The health-check script MUST detect and clearly report missing
  prerequisite tools.
- **FR-009**: Code quality tooling MUST be configured once at the root and apply
  to all TypeScript workspaces; no per-workspace divergent lint/format config.
- **FR-010**: Shared TypeScript compiler configuration MUST live in
  `packages/tsconfig` and be extended by every TypeScript workspace.
- **FR-011**: The scaffold MUST contain zero business logic: no Kite contract
  functions, no API endpoints, no UI screens, no indexer handlers, no workflow
  code (PLAN §6–§8 arrive as later features).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a fresh clone with the standard toolchain present, a
  contributor reaches a fully installed repository with one install command in
  under 5 minutes.
- **SC-002**: The contract build command succeeds from a clean state in under
  1 minute.
- **SC-003**: The single health-check script reports all nine workspaces green
  and exits zero, completing in under 1 minute.
- **SC-004**: A deliberate single-workspace breakage is correctly isolated by
  the health-check (exactly one red line, non-zero exit) — verified once during
  acceptance.
- **SC-005**: Review confirms zero business logic: no product behavior exists
  anywhere in the scaffold beyond placeholder content.

## Assumptions

- The standard toolchain (the Bun runtime, Foundry) is installed on contributor
  machines; the health-check verifies presence and reports absences (FR-008)
  rather than performing installation.
- `apps/indexer` (Envio) and `apps/orchestration` (CRE) remain empty skeletons
  in this feature — their real scaffolds arrive with their Day-10 features
  (PLAN §12), after Q3/Q4 (CRE API verification) are answered.
- Deployment targets (Vercel, Neon, Envio hosted, Alchemy) are out of scope;
  this feature is local-repo only.
- The web placeholder page is acceptable for now; PLAN §8 screens are a later
  feature.
- Biome, Turborepo, Bun, and Foundry versions are pinned at whatever the plan
  phase selects; this spec fixes only their presence and placement (PLAN §10).
- The plan file is currently named `Plan-Kite.md` while CLAUDE.md and this spec
  cite "PLAN"; renaming is a pending decision from the constitution TODO.
