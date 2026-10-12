#!/usr/bin/env bash
# Gate: the production bundle never aims at an API dev base (ports 3000–3009
# on localhost/127.0.0.1). The deployed client speaks same-origin RELATIVE
# /api/* only (vercel.json rewrite → Render); a configured VITE_API_URL is
# discarded in production builds (resolveApiBase, data/bootstrap.ts).
# Scoped to the :300xx class on purpose: 006's demo persona-prep tooling
# (prep server on :8787, its tunnel instructions, its loopback check) is
# deliberate Demo-Tool surface that stays in the bundle (TRUST.md row 4).
# Wired into apps/web's build script; runs on every deploy (Vercel included).
set -eu
cd "$(dirname "$0")/../../apps/web"
if [ ! -d dist ]; then
  echo "== no-dev-base: FAIL — dist/ missing (run vite build first) ==" >&2
  exit 1
fi
hits=$(grep -rlE "(localhost|127\.0\.0\.1):300[0-9]" dist --include="*.js" --include="*.html" || true)
if [ -n "$hits" ]; then
  echo "== no-dev-base: FAIL — API dev base reachable in the production bundle: ==" >&2
  echo "$hits" >&2
  exit 1
fi
echo "== no-dev-base: PASS (no localhost:300xx / 127.0.0.1:300xx in dist) =="
