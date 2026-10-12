#!/usr/bin/env bash
# T005 — wrapper for the catalogs-only string gate (no-jsx-prose.ts):
# shell entry keeps the gate invocable as `bun run no-jsx-prose` (quickstart
# §2). The engine is TypeScript for real literal extraction — grep cannot
# tell a string literal from a property name, and false FAILs would rot the
# gate. See no-jsx-prose.ts for the (a)/(b)/(c) rules.
set -u
cd "$(dirname "$0")/../.." || exit 1
exec bun scripts/gates/no-jsx-prose.ts
