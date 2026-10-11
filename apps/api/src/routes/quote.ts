// T028 — GET /api/quote?pair=USD_IDR|USD_MYR (FR-002). Display-only; the
// default pair is USD_IDR. Unknown pairs are a 400, not a guess.
import { Hono } from "hono";
import type { ApiDeps } from "../app.js";
import { getQuote } from "../services/quote-service.js";

export function quoteRoutes(deps: ApiDeps): Hono {
  const routes = new Hono();
  routes.get("/api/quote", async (c) =>
    c.json(await getQuote(deps.db, c.req.query("pair") ?? "USD_IDR")),
  );
  return routes;
}
