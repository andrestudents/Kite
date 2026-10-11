#!/usr/bin/env bash
# T036 — the ONE command: every gate, one runner.
#
#   bash scripts/gates/run-all.sh
#
# Runs, in order:
#   1. bun test            — the full unit/integration suite
#   2. gasless-send.ts     — SC-001 (boots a real relayer on RELAYER_PORT,
#                            stops it afterwards; refuses to shadow a listener)
#   3. purchase-settled.ts — SC-002 (self-contained; needs a live deal)
#   4. recon.sh            — SC-003 (ok / mismatch / infra verdicts)
#
# Prints one PASS/FAIL row per gate and exits non-zero if ANY gate failed.
# Secrets are required by NAME only — values are never echoed.

set -uo pipefail

cd "$(dirname "$0")/../.." # repo root — every path below is repo-relative

# bash does not auto-load .env the way bun does — load it ourselves, WITHOUT
# executing it (CRLF-safe; the name checks below give the real error).
# shellcheck disable=SC1091
if [ -f scripts/gates/load-env.sh ]; then . scripts/gates/load-env.sh; fi

PORT="${RELAYER_PORT:-3001}"
export RELAYER_URL="${RELAYER_URL:-http://127.0.0.1:$PORT}"

missing=""
for name in DATABASE_URL INTERNAL_API_KEY DEPLOYER_KEY MITA_API_KEY MILL_KEY ORCHESTRATOR_KEY; do
  [ -n "${!name:-}" ] || missing="$missing $name"
done
if [ -n "$missing" ]; then
  printf 'run-all: missing env names:%s — put them in .env\n' "$missing" >&2
  exit 2
fi

TMP="$(mktemp -d)"
RELAYER_PID=""
cleanup() {
  if [ -n "$RELAYER_PID" ]; then
    kill "$RELAYER_PID" 2>/dev/null
    wait "$RELAYER_PID" 2>/dev/null
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

results=()

record() { # record <name> <rc> <log-file> — keep the tail as evidence
  local name="$1" rc="$2" log="$3" ev verdict
  ev="$(tail -n 3 "$log" | tr '\n' ' ' | tr -s ' ' | cut -c1-110)"
  if [ "$rc" = "0" ]; then verdict="PASS"; else verdict="FAIL"; fi
  results+=("$name|$verdict|$rc|$ev")
}

probe() { # exit 0 iff something answers HTTP on the relayer (any status code)
  bun -e "const t=setTimeout(()=>process.exit(1),1500);
    fetch('$RELAYER_URL/api/jobs/1',{headers:{'x-api-key':'run-all-probe'}})
      .then(()=>{clearTimeout(t);process.exit(0)},()=>{clearTimeout(t);process.exit(1)})" 2>/dev/null
}

echo "== T036 run-all: bun test · gasless-send · purchase-settled · recon =="

echo "--- gate 1/4: bun test ---"
bun run test 2>&1 | tee "$TMP/1-bun-test.log"
record "bun test" "$?" "$TMP/1-bun-test.log"

echo "--- gate 2/4: gasless-send (SC-001) ---"
if probe; then
  echo "run-all: something already answers on $RELAYER_URL — stop it, or set RELAYER_URL/RELAYER_PORT" >&2
  record "gasless-send" "2" "/dev/null"
else
  bun apps/relayer/src/index.ts >"$TMP/relayer.log" 2>&1 &
  RELAYER_PID=$!
  up=""
  for _ in $(seq 1 60); do
    if probe; then up="1"; break; fi
    if ! kill -0 "$RELAYER_PID" 2>/dev/null; then break; fi
    sleep 0.5
  done
  if [ -z "$up" ]; then
    echo "run-all: relayer failed to start — log follows" >&2
    cat "$TMP/relayer.log" >&2
    record "gasless-send" "2" "/dev/null"
  else
    bun scripts/gates/gasless-send.ts 2>&1 | tee "$TMP/2-gasless-send.log"
    record "gasless-send" "$?" "$TMP/2-gasless-send.log"
  fi
fi

echo "--- gate 3/4: purchase-settled (SC-002) ---"
bun scripts/gates/purchase-settled.ts 2>&1 | tee "$TMP/3-purchase-settled.log"
record "purchase-settled" "$?" "$TMP/3-purchase-settled.log"

echo "--- gate 4/4: recon (SC-003) ---"
bash scripts/gates/recon.sh 2>&1 | tee "$TMP/4-recon.log"
record "recon" "$?" "$TMP/4-recon.log"

echo ""
echo "== T036 gate summary =="
printf '%-18s %-6s %-5s %s\n' "GATE" "RESULT" "EXIT" "EVIDENCE (tail)"
failed=""
for row in "${results[@]}"; do
  IFS='|' read -r name verdict rc ev <<<"$row"
  printf '%-18s %-6s %-5s %s\n' "$name" "$verdict" "$rc" "$ev"
  [ "$verdict" = "PASS" ] || failed="1"
done

if [ -n "$failed" ]; then
  echo "T036: FAIL — at least one gate did not pass."
  exit 1
fi
echo "T036: ALL GATES PASS"
