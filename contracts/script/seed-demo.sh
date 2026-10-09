#!/usr/bin/env bash
# seed-demo.sh — Demo Tool: drive the five seed stages with the per-event waits.
#
# The gap guard is PER EVENT (qualifying status is decided per event), so the
# driver sleeps DEMO_GAP_SECONDS + 10 BEFORE EACH qualifying income event after
# the first — i.e. before stages 2, 3, 4 and 5 (E2, E3, E4, E5): four sleeps.
# The Solidity script never sleeps; a forge run broadcasts at one point in real
# time, so one qualifying event per stage is the minimal structure (research D5).
#
# Reads every secret from the environment (see contracts/script/env.example) —
# this file contains and prints no values (spec FR-005).
#
# Usage:  bash contracts/script/seed-demo.sh          # from anywhere
#   env:  DEMO_GAP_SECONDS (default 60; 0 is refused)
#         RPC_URL       (default https://testnet-rpc.monad.xyz)
#         + every key KiteScriptCommon requires (DEPLOYER_KEY, RELAYER_KEY,
#           ORCHESTRATOR_KEY, BUDI_KEY, SITI_KEY, WATI_KEY, PAKHAJI_KEY,
#           MILL_KEY, KITE_CORE_ADDRESS)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

GAP="${DEMO_GAP_SECONDS:-60}"
if [ "$GAP" -eq 0 ]; then
  echo "refusing DEMO_GAP_SECONDS=0 — the qualifying bar must be > 0 (FR-016)" >&2
  exit 1
fi
SLEEP=$((GAP + 10))
RPC_URL="${RPC_URL:-https://testnet-rpc.monad.xyz}"

# Wall-clock estimate FIRST (per the amended T016): four sleeps, one before
# each qualifying event after E1.
EST_MIN=$(( (SLEEP * 4 + 59) / 60 ))
echo "=== seed-demo (Demo Tool) ==="
echo "gap: ${GAP}s — sleeping ${SLEEP}s before EACH qualifying event after the first (4 sleeps)"
echo "estimated wall-clock: ~${EST_MIN} min of waits + stage broadcast time"
echo "chain: Monad testnet (10143) — every stage aborts on the wrong chain"
echo

run_stage() {
  echo "── SEED_STAGE=$1 ──"
  SEED_STAGE="$1" forge script contracts/script/SeedDemo.s.sol \
    --root contracts \
    --rpc-url "$RPC_URL" \
    --broadcast --slow -g 115
}

run_stage 1
for STAGE in 2 3 4 5; do
  echo
  echo "waiting ${SLEEP}s before qualifying event E${STAGE} (stage ${STAGE})..."
  sleep "$SLEEP"
  run_stage "$STAGE"
done

echo
echo "seed complete — verify with (addresses from the deploy manifest):"
echo "  cast call \$KITE_CORE 'scoreOf(address)' \$BUDI --rpc-url \$RPC_URL   # expect 58"
echo "  cast call \$KITE_CORE 'isaOf(uint256)' 3 --rpc-url \$RPC_URL          # P 600e6 / remaining 480e6 / status 2"
