// @kite/api — boot: guard env, open Neon, build the app, serve (API_PORT).
import { makeNeonDb } from "@kite/core/db";
import { createApp } from "./app.js";
import { apiEnv } from "./env.js";
import { makeChainClient } from "./services/chain.js";

const env = apiEnv();
const deps = {
  db: makeNeonDb(env.databaseUrl),
  chain: makeChainClient(),
  mitaKey: env.mitaKey,
};
const app = createApp(deps);
const server = Bun.serve({ fetch: app.fetch, port: env.apiPort });
console.log(`@kite/api listening on :${server.port}`);
