#!/usr/bin/env bash
# Kite toolchain inside WSL — one wrapper so every harness command sees the
# same environment: node 22 (nvm), bun, foundry. Usage:
#   bash scripts/dev/kite-env.sh '<shell command relative to the repo root>'
set -u
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
  nvm use 22 >/dev/null 2>&1 || true
fi
export PATH="$HOME/.bun/bin:$HOME/.foundry/bin:$PATH"
cd /home/andreas/Hackathon/metropolis/Kite || exit 1
exec sh -c "$1"
