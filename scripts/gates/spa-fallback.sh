#!/usr/bin/env bash
# Gate: the SPA fallback exists in apps/web/vercel.json and sits AFTER the
# /api rewrite (order matters — Vercel matches rewrites top-down, and static
# files still win over rewrites, so hashed assets keep serving untouched).
# Without the catch-all, every client route — /p/:id share links above all
# (FR-019, the acquisition path) — answered 404 from Vercel's edge: the app
# never booted. Runs on EVERY deploy (wired into the Vercel buildCommand).
set -eu
cd "$(dirname "$0")/../../apps/web"

verdict=$(bun -e '
const v = require("./vercel.json");
const r = v.rewrites ?? [];
const api = r.findIndex((x) => x.source === "/api/:path*");
const spa = r.findIndex((x) => x.destination === "/index.html");
if (api === -1) { console.log("FAIL: /api/:path* rewrite missing"); process.exit(1); }
if (spa === -1) { console.log("FAIL: SPA fallback (/index.html) missing"); process.exit(1); }
if (spa < api) { console.log("FAIL: SPA fallback must come AFTER the /api rewrite"); process.exit(1); }
console.log("ok");
')

if [ "$verdict" != "ok" ]; then
  echo "== spa-fallback: ${verdict} ==" >&2
  exit 1
fi
echo "== spa-fallback: PASS (vercel.json rewrites: /api first, /index.html catch-all after) =="
