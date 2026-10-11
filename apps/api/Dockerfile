# @kite/api on Render — Bun runtime, workspace-aware.
# BUILD CONTEXT IS THE REPO ROOT (render.yaml's dockerfilePath points here;
# Render's Docker build context defaults to the repo root).
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
# Render assigns PORT at runtime (env.ts: API_PORT ?? PORT ?? 3000) — the
# process binds 0.0.0.0 so the platform can route to it.
CMD ["bun", "run", "apps/api/src/index.ts"]
