# @kite/relayer on Render — Bun runtime, workspace-aware.
# BUILD CONTEXT IS THE REPO ROOT (render.yaml's dockerfilePath points here;
# Render's Docker build context defaults to the repo root).
# No build step: every workspace package exports TS source and Bun runs it.
# One process, two halves: the HTTP queue + the claim/send worker — one image.
FROM oven/bun:1.4-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Manifests first (layer cache): workspaces resolve by path, so every
# workspace package.json must exist before `bun install`.
COPY package.json bun.lock turbo.json ./
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY apps/relayer/package.json apps/relayer/
RUN bun install --frozen-lockfile

# Sources after install — code changes don't re-download the world.
COPY packages/core packages/core
COPY packages/contracts packages/contracts
COPY apps/relayer apps/relayer

EXPOSE 3001
# Render assigns PORT at runtime (env.ts: RELAYER_PORT ?? PORT ?? 3001) — the
# process binds 0.0.0.0 so the platform can route to it.
CMD ["bun", "run", "apps/relayer/src/index.ts"]
