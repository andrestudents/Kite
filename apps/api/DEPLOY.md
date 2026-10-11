# Deploying @kite/api — Fly.io (Bun)

Hosts the long-running API for the demo/judging week. Nothing here routes
through a laptop tunnel; the API stays up on its own. The Vercel web app
proxies `/api/*` to this deployment (same-origin — no CORS needed).

## One-time setup

From the repo root:

```sh
fly launch --no-deploy        # finds apps/api/fly.toml; name: kite-api
fly secrets set \
  DATABASE_URL='postgresql://…neon.tech/…?sslmode=require' \
  MITA_API_KEY='…' \
  RELAYER_URL='https://kite-relayer.fly.dev' \
  INTERNAL_API_KEY='…'
fly deploy
```

Then push the DB schema once from the laptop (not in the image):

```sh
DATABASE_URL='postgresql://…' bun run db:push
```

## Runtime env vars — @kite/api (Fly secrets)

| Name | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Neon Postgres (add `?sslmode=require`). Migrations are NOT run by the image — `bun run db:push` from the laptop, once per database. |
| `MITA_API_KEY` | yes | Mitra console demo integration (005). Demo Tool. |
| `RELAYER_URL` | yes | Public base URL of `apps/relayer`. **Verification (bind + drip) needs the relayer reachable too** — see below. |
| `INTERNAL_API_KEY` | yes | Shared secret for the API→relayer `/api/jobs` hop. Must equal the relayer's `INTERNAL_API_KEY`. Never logged. |
| `API_PORT` | no | Default 3000 — keep it: `fly.toml` probes `/api/health` on 3000. |
| `ALCHEMY_RPC_URL` / `RPC_URL` | no | Monad testnet RPC override. Default: the public RPC recorded in `KITE_DEPLOYMENT.rpcUrl` (throttles ~25 req/s; Alchemy free tier is calmer). |
| `KITE_GETLOGS_CHUNK` / `KITE_GETLOGS_CONCURRENCY` | no | Settlement-scan tuning (defaults 100 / 16; public RPC cap is 100, Alchemy free is 10). |
| `CORS_ALLOW_ORIGIN` | no | Only if a site calls the API DIRECTLY cross-origin. With the Vercel `/api` rewrite, leave unset. |

## Build-time env vars — apps/web (Vercel)

| Name | Where | What it is |
|---|---|---|
| `API_ORIGIN` | Vercel project env | e.g. `https://kite-api.fly.dev`. Consumed by the `/api/:path*` rewrite in `apps/web/vercel.json` — the browser stays same-origin, so **no `VITE_API_URL` and no CORS are needed**. Set it BEFORE the next Vercel deploy: unset, the rewrite destination collapses and `/api` breaks. |
| `VITE_API_URL` | Vercel build env | Leave UNSET with the rewrite. Only for calling the API directly (then also set `CORS_ALLOW_ORIGIN` on the API). |

## The relayer must be public too

`POST /api/me/verification` enqueues `bind_identity` + `drip` through
`RELAYER_URL` — without a hosted relayer the trigger is an honest `503
relayer_unreachable`. The relayer has its own scaffold of this exact shape:
[`apps/relayer/Dockerfile`](../relayer/Dockerfile) + `fly.toml` +
[`apps/relayer/DEPLOY.md`](../relayer/DEPLOY.md) (shared Neon DB, same
`INTERNAL_API_KEY`, plus the funded `RELAYER_KEY` secret). Deploy it FIRST,
then point this app's `RELAYER_URL` at `https://kite-relayer.fly.dev`.

## Smoke checks after deploy

```sh
curl https://kite-api.fly.dev/api/health        # {"status":"ok",...} — probes db + chain
curl https://kite-zeta.vercel.app/api/health    # same JSON through the Vercel rewrite
curl https://kite-zeta.vercel.app/api/quote?pair=USD_IDR
```
