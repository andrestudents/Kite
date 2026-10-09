# Quickstart: Monorepo Scaffold Validation

Runnable proof that the feature meets its spec end-to-end. Every scenario maps to
a success criterion. Prerequisites: **bun** (pinned version) and **foundry**
(`forge`) installed; nothing else.

## 1. Fresh install (SC-001, FR-002)

```bash
git clone <repo> kite && cd kite
bun install
```

**Expect**: exit 0 in under 5 minutes; a single `bun.lock` at the root; no
per-workspace lockfiles.

## 2. Contract build (SC-002, FR-003)

```bash
cd contracts && forge build
```

**Expect**: exit 0 in under 1 minute; the default scaffold contract compiles.

## 3. Health check (SC-003, FR-001/FR-007)

```bash
bun run health
```

**Expect**: 2 prerequisite lines + 9 workspace lines + `9/9 workspaces ok`,
exit 0, completes in under 1 minute. Output shape: [contracts/health-check.md](contracts/health-check.md).

## 4. Breakage isolation (SC-004 — run once during acceptance)

```bash
mv apps/relayer/package.json /tmp/relayer-pkg.json   # break one workspace
bun run health; echo "exit=$?"
mv /tmp/relayer-pkg.json apps/relayer/package.json   # restore
bun run health                                        # back to 9/9, exit 0
```

**Expect**: first run shows exactly one `FAIL` line (`apps/relayer`) and
`exit=1`; after restore, `9/9` and exit 0.

## 5. Missing prerequisite reporting (FR-008 — optional manual check)

Run with `forge` hidden from PATH (e.g., `env PATH=<minimal-path> bun run health`).

**Expect**: exit 2 and output naming `forge` — not a stack trace.

## 6. Quality baseline (User Story 3, FR-009/FR-010)

```bash
bun run lint        # biome check . — exit 0 on untouched skeletons
grep -r '"extends"' apps/*/tsconfig.json packages/*/tsconfig.json 2>/dev/null
```

**Expect**: lint green; every TS workspace's tsconfig extends
`@kite/tsconfig/*` (no duplicated compiler settings).

## 7. Zero business logic review (SC-005, FR-011)

```bash
ls contracts/src/            # scaffold contract only
ls apps/api/src apps/relayer/src apps/indexer/src apps/orchestration/src
```

**Expect**: no Kite contract functions, endpoints, handlers, screens, or
workflow code anywhere; `apps/web` shows only the placeholder page — and its
copy avoids the PLAN §3 banned words (Constitution I review check).
