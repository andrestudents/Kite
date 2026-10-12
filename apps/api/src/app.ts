// Hono app factory: every error leaves as {error:{code,message}} with a
// mapped HTTP status — no stack traces, no env/key echo. Route modules mount
// here as they land; tests build the app over a PGlite db + fake chain.

import { KiteError } from "@kite/core";
import type { AnyDb } from "@kite/core/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health.js";
import { jobsMeRoutes } from "./routes/jobs-me.js";
import { meRoutes } from "./routes/me.js";
import { profileRoutes } from "./routes/profile.js";
import { purchasesRoutes } from "./routes/purchases.js";
import { quoteRoutes } from "./routes/quote.js";
import { verificationRoutes } from "./routes/verification.js";
import type { ChainClient } from "./services/chain.js";
import { makeUnreachableRelayerClient, type RelayerClient } from "./services/relayer-client.js";

export interface ApiDeps {
  db: AnyDb;
  chain: ChainClient;
  mitaKey: string;
  /** T014 client; absent (tests of 005 routes) → the trigger is honestly 503. */
  relayer?: RelayerClient;
  /** Optional CORS origin (CORS_ALLOW_ORIGIN). Unset with the Vercel /api
   *  rewrite — the browser then talks same-origin and CORS never applies. */
  corsOrigin?: string;
}

const STATUS_BY_CODE: Record<string, 400 | 401 | 404 | 409 | 422 | 503> = {
  bad_request: 400,
  unknown_pair: 400,
  unknown_kind: 400,
  invalid_wallet: 400,
  unauthorized: 401,
  session_invalid: 401,
  session_expired: 401,
  relayer_unreachable: 503,
  identity_hash_invalid: 422,
  // T012 — jobs-route.md §4 codes.
  job_kind_invalid: 422,
  job_payload_invalid: 422,
  sender_mismatch: 422,
  cap_exceeded: 422,
  isa_not_draftable: 409,
  offer_below_principal: 409,
  purchase_not_found: 404,
  profile_not_found: 404,
  job_not_found: 404,
  not_found: 404,
  purchase_ref_conflict: 409,
  invalid_transition: 409,
  money_must_be_integer: 422,
  unknown_channel: 422,
  unknown_isa: 422,
  invalid_signature: 422,
};

export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();

  if (deps.corsOrigin) {
    app.use("*", cors({ origin: deps.corsOrigin }));
  }

  app.onError((err, c) => {
    if (err instanceof KiteError) {
      const status = STATUS_BY_CODE[err.code] ?? 500;
      return c.json({ error: { code: err.code, message: err.message } }, status);
    }
    // Server log only — the response stays shapeless.
    console.error("[api]", err);
    return c.json({ error: { code: "internal", message: "internal error" } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: "not_found", message: "no such route" } }, 404));

  mountRoutes(app, deps);
  return app;
}

function mountRoutes(app: Hono, deps: ApiDeps): void {
  app.route("/", purchasesRoutes(deps));
  app.route("/", healthRoutes(deps));
  app.route("/", quoteRoutes(deps));
  app.route("/", meRoutes(deps));
  app.route("/", profileRoutes(deps));
  app.route(
    "/",
    verificationRoutes({ ...deps, relayer: deps.relayer ?? makeUnreachableRelayerClient() }),
  );
  // T012 — the ONE 007 surface, same INTERNAL-keyed relayer client as 006.
  app.route(
    "/",
    jobsMeRoutes({ ...deps, relayer: deps.relayer ?? makeUnreachableRelayerClient() }),
  );
}
