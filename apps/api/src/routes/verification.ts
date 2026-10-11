// T015 — the verification surface (contract web-api.md §2–§3, FR-002): a
// stateless TRIGGER plus derived read-backs. No user data is written here —
// the users table stays dormant; `identityBound` is read back from the chain
// (constitution IV), `dripped` from the 005 one-time lock row. Both routes
// are session-scoped (T007's middleware); enqueue goes through T014's
// INTERNAL-keyed client with deterministic clientRefs — replays are
// idempotent end to end.
import { KiteError } from "@kite/core";
import { type AnyDb, drips } from "@kite/core/db";
import { eq, or } from "drizzle-orm";
import { Hono } from "hono";
import type { ApiDeps } from "../app.js";
import { sessionAuth } from "../middleware/session.js";
import { ZERO_BYTES32 } from "../services/fake-chain.js";
import type { RelayerClient } from "../services/relayer-client.js";
import { jobClientRef } from "../services/relayer-client.js";

const IDENTITY_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** Derived state — never cached (contract §2: "chain read-back + drips PK"). */
async function readBack(db: AnyDb, chain: ApiDeps["chain"], wallet: string) {
  const [identityHash, dripRows] = await Promise.all([
    chain.identityOf(wallet),
    db
      .select()
      .from(drips)
      .where(or(eq(drips.wallet, wallet), eq(drips.wallet, wallet.toLowerCase()))),
  ]);
  return {
    identityBound: identityHash.toLowerCase() !== ZERO_BYTES32,
    dripped: dripRows.length > 0,
  };
}

/** sessionAuth() attached below guarantees this. */
const walletOf = (c: unknown): string =>
  (c as { get(key: string): unknown }).get("wallet") as string;

export function verificationRoutes(deps: ApiDeps & { relayer: RelayerClient }): Hono {
  const routes = new Hono();

  routes.use("/api/me/verification*", sessionAuth());

  routes.get("/api/me/verification", async (c) =>
    c.json(await readBack(deps.db, deps.chain, walletOf(c))),
  );

  routes.post("/api/me/verification", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      identityHash?: unknown;
    } | null;
    const identityHash = body?.identityHash;
    if (typeof identityHash !== "string" || !IDENTITY_HASH_RE.test(identityHash)) {
      throw new KiteError("identity_hash_invalid", "identityHash must be 0x + 64 hex chars");
    }
    const wallet = walletOf(c);
    const relayer = deps.relayer;
    await relayer.enqueue({
      kind: "bind_identity",
      payload: { wallet, identityHash },
      clientRef: jobClientRef("bind", wallet),
    });
    await relayer.enqueue({
      kind: "drip",
      payload: { wallet },
      clientRef: jobClientRef("drip", wallet),
    });
    return c.json({
      ...(await readBack(deps.db, deps.chain, wallet)),
      enqueued: ["bind_identity", "drip"],
    });
  });

  return routes;
}
