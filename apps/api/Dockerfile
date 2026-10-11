# @kite/api on Fly.io — Bun runtime, workspace-aware.
# BUILD CONTEXT IS THE REPO ROOT (fly.toml points here):
#   fly deploy            (from the repo root, or `fly launch` picks this up)
# No build step: every workspace package exports TS source and Bun runs it.
FROM oven/bun:1.4-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Manifests first (layer cache): workspaces resolve by path, so every
# workspace package.json must exist before `bun install`.
COPY package.json bun.lock turbo.json ./
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY apps/api/package.json apps/api/
RUN bun install --frozen-lockfile

# Sources after install — code changes don't re-download the world.
COPY packages/core packages/core
COPY packages/contracts packages/contracts
COPY apps/api apps/api

EXPOSE 3000
# API_PORT must match fly.toml's internal_port (default 3000).
CMD ["bun", "run", "apps/api/src/index.ts"]
