// @kite/relayer — one process, two halves (D5): the HTTP queue surface and
// the claim/send worker below, so exactly one transaction is ever in flight
// per key. The worker's per-kind handlers register from ./jobs/*.
import { makeNeonDb } from "@kite/core/db";
import { createRelayerApp } from "./app.js";
import { type RelayerContext } from "./dispatch.js";
import { makeRelayerWallet } from "./send.js";
import { relayerEnv } from "./env.js";
import { startWorker } from "./worker.js";

const env = relayerEnv();
const db = makeNeonDb(env.databaseUrl);

const app = createRelayerApp({ db, internalKey: env.internalKey });
Bun.serve({ fetch: app.fetch, port: env.relayerPort });
console.log(`@kite/relayer listening on :${env.relayerPort}`);

const ctx: RelayerContext = {
  db,
  wallet: makeRelayerWallet(env.relayerKey),
  dripMonWei: env.dripMonWei,
  dailyCapMonWei: env.dailyCapMonWei,
};
const worker = startWorker(ctx);
console.log("[relayer-worker] started — handlers register from ./jobs/*");

process.on("SIGINT", () => {
  worker.stop();
  process.exit(0);
});
