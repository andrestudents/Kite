// @kite/relayer — one process, two halves (D5): the HTTP queue surface and
// the claim/send worker below, so exactly one transaction is ever in flight
// per key. The worker's per-kind handlers register below (side effects).
import { makeNeonDb } from "@kite/core/db";
import { createRelayerApp } from "./app.js";
import { type RelayerContext } from "./dispatch.js";
import { makeRelayerWallet } from "./send.js";
import { relayerEnv } from "./env.js";
import { startWorker } from "./worker.js";
import "./jobs/activate-with-permit.js";
import "./jobs/bind-identity.js";
import "./jobs/drip.js";
import "./jobs/transfer-with-authorization.js";

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
console.log("[relayer-worker] started — handlers: activate_with_permit, transfer_with_authorization, bind_identity, drip");

process.on("SIGINT", () => {
  worker.stop();
  process.exit(0);
});
