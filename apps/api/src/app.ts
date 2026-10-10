// Hono app factory: every error leaves as {error:{code,message}} with a
// mapped HTTP status — no stack traces, no env/key echo. Route modules mount
// here as they land; tests build the app over a PGlite db + fake chain.
import { Hono } from "hono";
import { KiteError } from "@kite/core";
import type { AnyDb } from "@kite/core/db";
import type { ChainClient } from "./services/chain.js";

export interface ApiDeps {
  db: AnyDb;
  chain: ChainClient;
  mitaKey: string;
}

const STATUS_BY_CODE: Record<string, 400 | 401 | 404 | 409 | 422> = {
  bad_request: 400,
  unknown_pair: 400,
  unknown_kind: 400,
  invalid_wallet: 400,
  unauthorized: 401,
  purchase_not_found: 404,
  profile_not_found: 404,
  job_not_found: 404,
  not_found: 404,
  purchase_ref_conflict: 409,
  invalid_transition: 409,
  money_must_be_integer: 422,
};

export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof KiteError) {
      const status = STATUS_BY_CODE[err.code] ?? 500;
      return c.json({ error: { code: err.code, message: err.message } }, status);
    }
    // Server log only — the response stays shapeless.
    console.error("[api]", err);
    return c.json({ error: { code: "internal", message: "internal error" } }, 500);
  });

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "no such route" } }, 404),
  );

  mountRoutes(app, deps);
  return app;
}

function mountRoutes(app: Hono, deps: ApiDeps): void {
  // routes/health.ts (T027) · routes/quote.ts (T028) · routes/me.ts (T029) ·
  // routes/profile.ts (T030) · routes/purchases.ts (T014) mount here.
  void app;
  void deps;
}
