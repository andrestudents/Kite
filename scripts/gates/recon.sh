#!/usr/bin/env bash
# SC-003 gate — US4 reconciliation (T032/T033). Drives the REAL recon job
# against DATABASE_URL and proves all three verdicts (FR-019..021, D16):
#
#   1. a clean day              → exit 0, verdict ok
#   2. an injected SETTLED buy  → exit 1, mismatch row with BOTH totals,
#                                 injection left untouched (recon never repairs)
#   3. a dead RPC               → exit 2, NO verdict row for that day
#   4. cleanup of everything the gate created
#
# The gate exits 0 only when every step behaved as specified; any other
# outcome exits 1 with the failing step named. Secrets abort by NAME only.
#
# Usage: bash scripts/gates/recon.sh [YYYY-MM-DD]   (default: yesterday UTC)

set -euo pipefail

DAY="${1:-$(date -u -d yesterday +%F)}"
DEAD_DAY="2001-01-01" # pre-baseline and empty — must never receive a verdict
REF="sc003-$(date -u +%s)"
GROSS=500000000
AT="${DAY}T12:00:00Z"
: "${DATABASE_URL:?$DATABASE_URL must be set — source your env first}"
export SC003_REF="$REF" SC003_GROSS="$GROSS" SC003_AT="$AT" SC003_DEAD="$DEAD_DAY" SC003_DAY="$DAY"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

step() { printf '\n== %s ==\n' "$1"; }
fail() { printf 'SC-003 FAIL: %s\n' "$1" >&2; exit 1; }

sql() { # one await-able statement batch via bun -e (run from the repo root)
  bun -e "
    import { neon } from '@neondatabase/serverless';
    const sql = neon(process.env.DATABASE_URL);
    $1
  "
}

count_injected() {
  sql "const r = await sql\`SELECT count(*)::int AS n FROM purchases WHERE purchase_ref = \${process.env.SC003_REF}\`;
       console.log(r[0].n);"
}

step "0/4 precondition: no leftover injection ($REF)"
[ "$(count_injected)" = "0" ] || fail "a previous gate run left $REF behind — clean it first"

step "1/4 clean recon of $DAY (expect exit 0, ok)"
set +e
bun apps/api/src/jobs/recon.ts --day "$DAY" 2>&1 | tee "$TMP/step1.log"
rc=$?
set -e
[ "$rc" = "0" ] || fail "clean recon exited $rc (expected 0) — real traffic may already mismatch"
grep -q " ok" "$TMP/step1.log" || fail "clean recon did not print an ok verdict"

step "2/4 inject one SETTLED buy of $GROSS into $DAY (ref $REF)"
sql "await sql\`INSERT INTO purchases
      (channel_id, isa_id, purchase_ref, gross_ausd, status, mill_sig, settled_at)
      VALUES (1, 3, \${process.env.SC003_REF}, \${process.env.SC003_GROSS}, 'SETTLED',
              \${JSON.stringify({ salt: process.env.SC003_REF, v: 27, r: process.env.SC003_REF, s: process.env.SC003_REF })}::jsonb,
              \${process.env.SC003_AT}::timestamptz)\`;
     console.log('injected');" | grep -q "injected" || fail "injection did not land"

step "3/4 recon again (expect exit 1, mismatch with both totals, injection untouched)"
set +e
bun apps/api/src/jobs/recon.ts --day "$DAY" 2>&1 | tee "$TMP/step3.log"
rc=$?
set -e
[ "$rc" = "1" ] || fail "recon with injected money exited $rc (expected 1)"
grep -q "mismatch" "$TMP/step3.log" || fail "no mismatch verdict printed"
grep -q "backend=$GROSS" "$TMP/step3.log" || fail "backend total missing the injected $GROSS"
[ "$(count_injected)" = "1" ] || fail "recon touched the injection (FR-021: never repair)"

step "4/4 dead RPC (expect exit 2, NO verdict row for $DEAD_DAY)"
set +e
ALCHEMY_RPC_URL="http://127.0.0.1:1" RPC_URL="http://127.0.0.1:1" \
  bun apps/api/src/jobs/recon.ts --day "$DEAD_DAY" 2>&1 | tee "$TMP/step4.log"
rc=$?
set -e
[ "$rc" = "2" ] || fail "dead-RPC recon exited $rc (expected 2)"
dead_rows="$(sql "const r = await sql\`SELECT count(*)::int AS n FROM recon_daily WHERE day = \${process.env.SC003_DEAD}\`;
                  console.log(r[0].n);")"
[ "$dead_rows" = "0" ] || fail "an infra failure wrote a verdict row (never a verdict without evidence)"

step "cleanup: injected purchase + this gate's verdict rows"
sql "await sql\`DELETE FROM purchases WHERE purchase_ref = \${process.env.SC003_REF}\`;
     await sql\`DELETE FROM recon_daily WHERE day = \${process.env.SC003_DAY}\`;
     console.log('cleaned');" | grep -q "cleaned" || fail "cleanup did not complete"

printf '\nSC-003 PASS — ok/mismatch/infra verdicts, no repair, no infra row, clean exit.\n'
