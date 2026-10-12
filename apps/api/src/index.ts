// @kite/api — boot: guard env, open Neon, build the app, serve (API_PORT/PORT).
import { optionalEnv } from "@kite/core";
import { makeNeonDb } from "@kite/core/db";
import { createApp } from "./app.js";
import { apiEnv } from "./env.js";
import { processNewRegistryLogs } from "./jobs/watch-registry.js";
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

// T019 — registry catch-up BEFORE serving: a cold boot (Render spin-up) must
// answer the share link correctly on its FIRST request — a drafted ISA that
// landed while asleep has to be in the isas cache by then, or /api/p answers
// deals:[] and the [Dukung] CTA has nothing to render (FR-019). A failed pass
// logs and serves anyway; the interval below keeps retrying.
try {
  const boot = await processNewRegistryLogs(deps.db, deps.chain);
  console.log(
    `[watch-registry] boot catch-up: channels=${boot.channels} isas=${boot.isas} ` +
      `blocks=${boot.fromBlock}-${boot.toBlock}`,
  );
} catch (err) {
  console.error("[watch-registry] boot catch-up failed — continuing", err);
}

const app = createApp(deps);
// 0.0.0.0 explicitly (Bun's default, but stated): hosts like Render only
// route traffic to services bound to all interfaces — localhost binds die.
const server = Bun.serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.apiPort });
console.log(`@kite/api listening on :${server.port}`);

// While warm, drafts/activations reach the cache within seconds (each idle
// pass is a handful of topic-filtered getLogs). The timer never holds the
// process open, and free-tier sleep simply resumes at the next boot catch-up.
const registryTimer = setInterval(() => {
  void processNewRegistryLogs(deps.db, deps.chain).catch((err: unknown) => {
    console.error("[watch-registry] pass failed — retrying next tick", err);
  });
}, 10_000);
registryTimer.unref?.();
