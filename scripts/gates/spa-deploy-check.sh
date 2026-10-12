#!/usr/bin/env bash
# Deploy check (run AFTER a Vercel deployment goes green): the deep link
# /p/<wallet> must answer 200 + HTML through the REAL edge — the SPA fallback
# proving itself in production, not just in vercel.json. Usage:
#   bash scripts/gates/spa-deploy-check.sh                 # kite-zeta.vercel.app
#   KITE_WEB_ORIGIN=https://x.vercel.app bash scripts/gates/spa-deploy-check.sh
set -eu
ORIGIN="${KITE_WEB_ORIGIN:-https://kite-zeta.vercel.app}"
URL="${ORIGIN}/p/0xDbAc9A1F342a1b5Fb2956e58E6528ca0F8C44aAD"

status=$(curl -sS -o /tmp/kite-spa-check.html -w "%{http_code}" --max-time 60 "$URL")
ctype=$(curl -sS -o /dev/null -w "%{content_type}" --max-time 60 "$URL")

if [ "$status" != "200" ]; then
  echo "== spa-deploy-check: FAIL — $URL → $status (expected 200) ==" >&2
  exit 1
fi
case "$ctype" in
  text/html*) ;;
  *)
    echo "== spa-deploy-check: FAIL — content-type '$ctype' is not HTML (fallback not serving index) ==" >&2
    exit 1
    ;;
esac
echo "== spa-deploy-check: PASS ($URL → 200 text/html) =="
