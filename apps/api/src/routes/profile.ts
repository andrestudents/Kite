// T030 — GET /api/p/:id (FR-004): public, keyless, personal-data-free.
import { Hono } from "hono";
import type { ApiDeps } from "../app.js";
import { getProfile } from "../services/profile-service.js";

export function profileRoutes(deps: ApiDeps): Hono {
  const routes = new Hono();
  routes.get("/api/p/:id", async (c) =>
    c.json(await getProfile(deps.db, deps.chain, c.req.param("id"))),
  );
  return routes;
}
