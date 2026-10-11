// T018 — GET /api/me (005's shape, 006's identity): the caller is the session
// header (x-kite-session) — identity is RECOVERED, never asserted. A bare
// x-kite-wallet is not an identity here anymore; it never reaches the service.
import { Hono } from "hono";
import type { ApiDeps } from "../app.js";
import { sessionAuth } from "../middleware/session.js";
import { getMe } from "../services/me-service.js";

export function meRoutes(deps: ApiDeps): Hono {
  const routes = new Hono();

  routes.use("/api/me", sessionAuth());

  routes.get("/api/me", async (c) =>
    c.json(
      await getMe(
        deps.db,
        deps.chain,
        ((c as unknown as { get(key: string): unknown }).get("wallet") as string | undefined) ??
          undefined,
      ),
    ),
  );
  return routes;
}
