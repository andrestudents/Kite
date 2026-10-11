// T027 — GET /api/health (FR-001): both dependencies are actually probed and
// a failure flips its entry AND the top-level status — never a false ok.
// Probe failure details stay shapeless (no internal error text is echoed).
import type { AnyDb } from "@kite/core/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { ApiDeps } from "../app.js";
import type { ChainClient } from "../services/chain.js";

interface DbProbe {
  ok: boolean;
  detail?: string;
}
interface RpcProbe {
  ok: boolean;
  detail?: string;
  chainId?: number;
  blockNumber?: number;
}

export async function healthPayload(
  db: AnyDb,
  chain: ChainClient,
): Promise<{
  status: "ok" | "degraded";
  db: DbProbe;
  rpc: RpcProbe;
  time: string;
}> {
  let dbProbe: DbProbe;
  try {
    await db.execute(sql`SELECT 1`);
    dbProbe = { ok: true, detail: "select 1" };
  } catch {
    dbProbe = { ok: false, detail: "db unreachable" };
  }

  let rpcProbe: RpcProbe;
  try {
    const [chainId, blockNumber] = await Promise.all([chain.chainId(), chain.blockNumber()]);
    rpcProbe = { ok: true, chainId, blockNumber: Number(blockNumber) };
  } catch {
    rpcProbe = { ok: false, detail: "rpc unreachable" };
  }

  return {
    status: dbProbe.ok && rpcProbe.ok ? "ok" : "degraded",
    db: dbProbe,
    rpc: rpcProbe,
    time: new Date().toISOString(),
  };
}

export function healthRoutes(deps: ApiDeps): Hono {
  const routes = new Hono();
  routes.get("/api/health", async (c) => c.json(await healthPayload(deps.db, deps.chain)));
  return routes;
}
