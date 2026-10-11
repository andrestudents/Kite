// @kite/api — boot: guard env, open Neon, build the app, serve (API_PORT/PORT).
import { optionalEnv } from "@kite/core";
import { makeNeonDb } from "@kite/core/db";
import { createApp } from "./app.js";
import { apiEnv } from "./env.js";
import { makeChainClient } from "./services/chain.js";
import { makeRelayerClient } from "./services/relayer-client.js";

const env = apiEnv();
const deps = {
  db: makeNeonDb(env.databaseUrl),
  chain: makeChainClient(),
  mitaKey: env.mitaKey,
  relayer: makeRelayerClient(env.relayerUrl, env.internalKey),
  // Only for direct cross-origin setups; the Vercel /api rewrite keeps the
  // browser same-origin and never needs this.
  corsOrigin: optionalEnv("CORS_ALLOW_ORIGIN"),
};
const app = createApp(deps);
// 0.0.0.0 explicitly (Bun's default, but stated): hosts like Render only
// route traffic to services bound to all interfaces — localhost binds die.
const server = Bun.serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.apiPort });
console.log(`@kite/api listening on :${server.port}`);
