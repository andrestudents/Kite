# Deploying @kite/relayer — Fly.io (Bun)

The relayer is what makes verification real: `bind_identity` + `drip` ride its
job queue. Without a hosted relayer, the web app's verify step is an honest
`503 relayer_unreachable` (that is the "ada kendala" family of failures).
One process, two halves in one image: the INTERNAL-keyed HTTP queue AND the
claim/send worker — deploy it once, both run.

## One-time setup

From the repo root:

```sh
fly launch --no-deploy --name kite-relayer   # finds apps/relayer/fly.toml
fly secrets set \
  DATABASE_URL='postgresql://…neon.tech/…?sslmode=require' \
  INTERNAL_API_KEY='…' \
  RELAYER_KEY='0x…'
fly deploy
```

- `DATABASE_URL`: **the same Neon database as the API** — `relayer_jobs` and
  `drips` live in the shared `packages/core` schema, so the one
  `bun run db:push` you ran for the API already covers this app. No second DB.
- `INTERNAL_API_KEY`: the **same value** the API holds — it authenticates the
  API→relayer `/api/jobs` hop.
- `RELAYER_KEY`: the funded `RELAYER_ROLE` holder. **Env/Fly-secret only —
  never a build arg, never in git, never printed.** Fund it with MON for gas;
  the drip budget below draws from the same balance.

## Runtime env vars — @kite/relayer (Fly secrets)

| Name | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Shared Neon Postgres (same as the API). |
| `INTERNAL_API_KEY` | yes | Shared secret for `/api/jobs`. Same value as the API's. |
| `RELAYER_KEY` | yes | The funded RELAYER_ROLE account's private key (`0x` + 64 hex). Sends every relayed transaction; the worker keeps exactly one tx in flight per key. |
| `RELAYER_PORT` | no | Default 3001 — keep it: `fly.toml` probes `/health` on 3001. |
| `DRIP_MON_WEI` | no | Drip size in wei (default `50000000000000000` = 0.05 MON). |
| `RELAYER_DAILY_CAP_MON_WEI` | no | Daily drip budget cap (default `2000000000000000000` = 2 MON). |
| `ALCHEMY_RPC_URL` / `RPC_URL` | no | Monad testnet RPC override (same priority as the API; default is the public RPC in `KITE_DEPLOYMENT.rpcUrl`). Worth setting if drips start hitting rate limits. |

## Wire-up order

1. Deploy this app first (or together with the API).
2. Point the API's `RELAYER_URL` at it: `https://kite-relayer.fly.dev`
   (`fly secrets set RELAYER_URL=… -a kite-api && fly deploy -a kite-api`).
3. Then the web app's verify step goes green end to end.

## Smoke checks after deploy

```sh
curl https://kite-relayer.fly.dev/health          # {"status":"ok"} — liveness only
curl -s https://kite-relayer.fly.dev/api/jobs -X POST \
  -H 'content-type: application/json' -d '{}'                     # 401 — key wall is up
curl -s https://kite-zeta.vercel.app/api/health                   # through the Vercel rewrite
```
