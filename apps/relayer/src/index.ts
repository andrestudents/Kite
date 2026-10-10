// @kite/relayer — one process, two halves (D5): the HTTP queue surface below,
// and (from T022) the claim/send worker loop in the same process so exactly
// one transaction is ever in flight per key.
import { makeNeonDb } from "@kite/core/db";
import { createRelayerApp } from "./app.js";
import { relayerEnv } from "./env.js";

const env = relayerEnv();
const app = createRelayerApp({ db: makeNeonDb(env.databaseUrl), internalKey: env.internalKey });

Bun.serve({ fetch: app.fetch, port: env.relayerPort });
console.log(`@kite/relayer listening on :${env.relayerPort}`);
