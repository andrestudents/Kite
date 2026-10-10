// Purchase registry routes (FR-005..FR-007) — one MITA key owns all three:
// the mill's console authorizes its own payment lifecycle (http-api decision
// record). Bad auth → 401 with no key echo; errors leave via the app-level
// onError as {error:{code,message}}.
import { Hono } from "hono";
import { KiteError, verifyApiKey } from "@kite/core";
import type { ApiDeps } from "../app.js";
import { createPurchase, getPurchase, markPurchasePaid } from "../services/purchase-service.js";

const MITA_ID = "mita";

export function purchasesRoutes(deps: ApiDeps): Hono {
  const routes = new Hono();

  routes.use("/api/channel/purchases*", async (c, next) => {
    if (!verifyApiKey(c.req.header("x-api-key"), deps.mitaKey)) {
      throw new KiteError("unauthorized", "missing or invalid key");
    }
    await next();
  });

  // POST /api/channel/purchases — create intent (idempotent per §7.2 rule 1)
  routes.post("/api/channel/purchases", async (c) => {
    const body = await c.req.json().catch(() => null);
    const { purchase, created } = await createPurchase(deps.db, deps.chain, body);
    return c.json(purchase, created ? 201 : 200);
  });

  // GET /api/channel/purchases/:id — the WF-1 validation read
  routes.get("/api/channel/purchases/:id", async (c) =>
    c.json(await getPurchase(deps.db, c.req.param("id"))),
  );

  // POST /api/channel/purchases/:id/paid — payment recorded (PENDING → PAID)
  routes.post("/api/channel/purchases/:id/paid", async (c) =>
    c.json(await markPurchasePaid(deps.db, c.req.param("id"), MITA_ID)),
  );

  return routes;
}
