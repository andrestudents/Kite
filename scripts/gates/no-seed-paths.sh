#!/usr/bin/env bash
# T009 — SC-004 gate (FR-014 as amended): no seed phrase is ever SHOWN,
# STORED, EXPORTED, or LOGGED. NOT "the identifier never appears in the
# bundle" — the derivation path legitimately uses @scure/bip39 app-side, so
# raw identifiers are exempt. The gate scans USER-FACING SURFACES over
# apps/web/src/** (no dist build needed):
#   (a) sink scan   — any line touching mnemonic material that ALSO touches a
#                     user-facing sink (console/clipboard/localStorage/IndexedDB/
#                     network) fails, listing file:line.
#   (b) confinement — @scure/bip39|@scure/bip32|entropyToMnemonic|
#                     mnemonicToSeedSync appear ONLY in apps/web/src/auth/
#                     derive.ts and its colocated derive.test.ts (the test
#                     polices the module — assertions only, never computing a
#                     mnemonic).
#   (c) custody     — zero custody-backend integration: no operator key env
#                     names anywhere in the app tree.
# Exit 0 with evidence / exit 1 listing matches. The derivation module's own
# hygiene is proven by derive.test.ts (T011), not by this grep.
set -u
cd "$(dirname "$0")/../.." || exit 1

SRC="apps/web/src"
fail=0

echo "== no-seed-paths: user-facing-surface scan over $SRC =="

# (a) A mnemonic-material line that reaches a user-facing sink on the same line.
#     Line-level AND via two greps: material pattern first, sink pattern second.
sink_hits=$(grep -rnE 'mnemonic|seedPhrase|seed_phrase|entropyToMnemonic|mnemonicToSeedSync' "$SRC" 2>/dev/null \
  | grep -E 'console\.|navigator\.clipboard|localStorage|indexedDB|indexeddb|fetch\(|apiFetch' || true)
if [ -n "$sink_hits" ]; then
  echo "FAIL (a) mnemonic material reaches a user-facing sink:"
  echo "$sink_hits"
  fail=1
else
  echo "PASS (a) no mnemonic material on any sink line (console/clipboard/storage/network)"
fi

# (b) Import confinement: the derivation identifiers live ONLY in the derive
#     module and its structural test.
stray_hits=$(grep -rnE '@scure/bip39|@scure/bip32|entropyToMnemonic|mnemonicToSeedSync' "$SRC" 2>/dev/null \
  | grep -vE '^apps/web/src/auth/derive\.test\.ts:' \
  | grep -vE '^apps/web/src/auth/derive\.ts:' || true)
if [ -n "$stray_hits" ]; then
  echo "FAIL (b) derivation identifiers outside apps/web/src/auth/derive.ts(+test):"
  echo "$stray_hits"
  fail=1
else
  echo "PASS (b) bip39/bip32 + derivation calls confined to apps/web/src/auth/derive.ts(+test)"
fi

# (c) Custody-backend integration stays zero: operator/demo key env names
#     never enter the app tree (keys are env-only, scripts-side).
custody_hits=$(grep -rnE 'BUDI_KEY|PAKHAJI_KEY|INTERNAL_API_KEY|MITA_API_KEY' "$SRC" 2>/dev/null || true)
if [ -n "$custody_hits" ]; then
  echo "FAIL (c) key material names inside the app tree:"
  echo "$custody_hits"
  fail=1
else
  echo "PASS (c) zero custody-backend integration (no key env names in the app tree)"
fi

if [ "$fail" -ne 0 ]; then
  echo "== no-seed-paths: FAIL =="
  exit 1
fi
echo "== no-seed-paths: PASS =="
