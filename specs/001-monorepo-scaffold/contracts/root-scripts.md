# Contract: Root `package.json` Scripts

The contributor-facing command surface of the scaffold. Names are fixed so the
PLAN §12 "done when" gates and all later feature docs can cite them verbatim.

| Script | Command (illustrative) | Gate it serves |
|---|---|---|
| `postinstall` | (none — keep install side-effect free) | — |
| `build` | `turbo run build` + `forge --root contracts build` | FR-003, PLAN Day-1 build check |
| `lint` | `biome check .` | FR-009, User Story 3 |
| `format` | `biome check --write .` | FR-009 |
| `typecheck` | `turbo run typecheck` | FR-010 observability |
| `health` | `bun scripts/healthcheck.ts` | FR-007/FR-008 — see [health-check.md](health-check.md) |

Rules:

- `bun install` is the only supported install path (no `npm`/`pnpm`/`yarn`
  scripts, lockfiles, or documentation references — frozen-stack constraint).
- Every script exits non-zero on failure; none prints only-happy paths.
- Adding a later script requires updating this contract first (constitution:
  no silent deviation).
