// T029 — GET /api/me (FR-003): the demo identity header (x-kite-wallet),
// swappable for Mera sessions in a later feature. Missing/invalid → 400.
import { Hono } from "hono";
import type { ApiDeps } from "../app.js";
import { getMe } from "../services/me-service.js";

export function meRoutes(deps: ApiDeps): Hono {
  const routes = new Hono();
  routes.get("/api/me", async (c) =>
    c.json(await getMe(deps.db, deps.chain, c.req.header("x-kite-wallet"))),
  );
  return routes;
}
