# Deploying the Kite backend — Render free tier

Both backend services (`kite-api`, `kite-relayer`) live on Render's free tier,
defined by [`render.yaml`](render.yaml) at the repo root. Nothing routes through
a laptop tunnel; the Vercel web app proxies `/api/*` to `kite-api` (same-origin —
no CORS, no `VITE_API_URL`).

**Live URLs (2026-10-12)**: `https://kite-api-ghoi.onrender.com` and
`https://kite-relayer.onrender.com`. Render suffixes a subdomain when the bare
name is already taken on onrender.com — `kite-api` was, hence `-ghoi`; the
relayer kept its bare name. Use the `-ghoi` host everywhere `kite-api` appears
below (`API_ORIGIN`, UptimeRobot, smoke curls).

Primary: **Render free** (below). Fallback: **EC2** (end of this file) — only
if the free tier misbehaves during judging week.

## One-time setup

1. Push this repo to GitHub (Render builds from the connected repo).
2. Render dashboard → **New → Blueprint** → pick the repo. Render reads
   `render.yaml` and prompts once for each `sync: false` secret — fill them
   from the tables below. That is the ONLY time CLI-free secrets are entered;
   afterwards they're dashboard-managed (**Environment** per service).
3. Both services build from the existing Dockerfiles (`runtime: docker` —
   Render has no native Bun runtime; the build context is the repo root,
   which the Dockerfiles already assume).
4. Push the DB schema once from the laptop (never in the image):

   ```sh
   DATABASE_URL='postgresql://…neon.tech/…?sslmode=require' bun run db:push
   ```

   One push covers BOTH services — `relayer_jobs` + `drips` live in the
   shared `packages/core` schema. No second database, no Render Postgres.

## Env vars — kite-api

| Name | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Neon Postgres (add `?sslmode=require`). |
| `MITA_API_KEY` | yes | Mitra console demo integration (005). Demo Tool. |
| `RELAYER_URL` | yes | In render.yaml as `https://kite-relayer.onrender.com`. |
| `INTERNAL_API_KEY` | yes | Shared secret for the API→relayer `/api/jobs` hop. **Same value as the relayer's.** Never logged. |
| `ALCHEMY_RPC_URL` / `RPC_URL` | no | Monad testnet RPC override (dashboard). Default: the public RPC in `KITE_DEPLOYMENT.rpcUrl` (throttles ~25 req/s; Alchemy free is calmer). |
| `KITE_GETLOGS_CHUNK` / `KITE_GETLOGS_CONCURRENCY` | no | Settlement-scan tuning (defaults 100 / 16; public RPC cap 100, Alchemy free 10). |
| `CORS_ALLOW_ORIGIN` | no | Only if a site calls the API DIRECTLY cross-origin. With the Vercel `/api` rewrite: leave unset. |
| `API_PORT` | no | Dev-only override. Render injects `PORT` — **never set `API_PORT` there.** |

## Env vars — kite-relayer

| Name | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Same Neon database as kite-api. |
| `INTERNAL_API_KEY` | yes | Same value as kite-api's. |
| `RELAYER_KEY` | yes | The funded `RELAYER_ROLE` account's private key (`0x` + 64 hex). Sends every relayed transaction; one tx in flight per key. **Env/dashboard only — never a build arg, never in git, never printed.** Fund it with MON; the drip budget draws from the same balance. |
| `DRIP_MON_WEI` | no | Drip size in wei (default `50000000000000000` = 0.05 MON). |
| `RELAYER_DAILY_CAP_MON_WEI` | no | Daily drip budget cap (default `2000000000000000000` = 2 MON). |
| `ALCHEMY_RPC_URL` / `RPC_URL` | no | Same priority as the API; worth setting if drips hit rate limits. |
| `RELAYER_PORT` | no | Dev-only override. Never set on Render (`PORT` is injected). |

## Ports (the #1 Render bug — already handled in code)

Render assigns `PORT` and only routes to services bound to **`0.0.0.0`**. Both
services do it right: `API_PORT ?? PORT ?? 3000` (api) and
`RELAYER_PORT ?? PORT ?? 3001` (relayer), and both `Bun.serve` calls pass
`hostname: "0.0.0.0"` explicitly. Don't define `PORT` anywhere — Render owns it.

## REQUIRED after first deploy: UptimeRobot keep-alive

Render **free** web services spin down after ~15 min without inbound traffic,
and a cold boot takes ~a minute — dead air mid-demo. Render's own
`healthCheckPath` does NOT count as traffic. Two monitors, before judging week:

1. <https://uptimerobot.com> → Add New Monitor → **HTTPS**,
   URL `https://kite-api-ghoi.onrender.com/api/health`, interval **5 minutes**.
2. Same for `https://kite-relayer.onrender.com/health`.

If a monitor ever reports "down" while the service is merely spun down, that's
expected on the first ping after a gap — the request still wakes it.

## Vercel side (web)

`apps/web/vercel.json` rewrites `/api/:path*` to `${API_ORIGIN}/api/:path*`.
Set the project env var `API_ORIGIN=https://kite-api-ghoi.onrender.com` **BEFORE the
next Vercel deploy** (unset, the rewrite destination collapses and `/api`
breaks). Leave `VITE_API_URL` unset — the rewrite keeps the browser
same-origin.

## Smoke checks after deploy

```sh
curl https://kite-relayer.onrender.com/health      # {"status":"ok"} — liveness only (first hit may take ~1 min: cold boot)
curl -s https://kite-relayer.onrender.com/api/jobs -X POST \
  -H 'content-type: application/json' -d '{}'       # 401 — the key wall is up
curl https://kite-api-ghoi.onrender.com/api/health  # probes db + chain
curl https://kite-zeta.vercel.app/api/health        # same JSON through the Vercel rewrite
```

## Fallback: EC2 (1 GB free tier) — only if Render free misbehaves

Same Docker images, self-hosted. From the repo root:

```sh
docker build -f apps/api/Dockerfile -t kite-api .      # build context = repo root
docker build -f apps/relayer/Dockerfile -t kite-relayer .
docker run -d --restart=always --name kite-api -p 80:3000 \
  -e DATABASE_URL=… -e MITA_API_KEY=… -e INTERNAL_API_KEY=… \
  -e RELAYER_URL=http://<ec2-host>:81 kite-api          # or run both behind nginx/caddy
```

`docker run` passes env inline — prefer an env-file kept on the instance
(`--env-file`, chmod 600) so `RELAYER_KEY` never lands in shell history. An
EC2 instance never spins down, so UptimeRobot is optional there (still useful
as an alerting canary). Keep Neon external. 1 GB RAM is enough for Bun but not
for much else — no Neon, no indexer on the same box.
