// T007 — the FIVE named conformance tests (FR-007, quickstart §3):
//   1. expired session → 401 session_expired
//   2. tampered signature → 401 session_invalid
//   3. valid session → 200 with the correct recovered identity
//   4. /api/p/:id → 200 with NO session header (public domain intact)
//   5. MITA purchase route → unaffected by the middleware (service domain intact)
// Vectors are signed locally with throwaway viem accounts; no RPC anywhere.
import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { Hono } from "hono";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApp } from "../app.js";
import type { ChainClient } from "../services/chain.js";
import { fakeChain } from "../services/fake-chain.js";
import { buildSessionMessage, sessionAuth } from "./session.js";

const HASH = `0x${"c3".repeat(32)}` as `0x${string}`;

/** Throws-away account + a signed x-kite-session header over `until`. */
async function mintHeader(until: number, key?: `0x${string}`): Promise<string> {
  const account = privateKeyToAccount(key ?? generatePrivateKey());
  const hex = await account.signMessage({ message: buildSessionMessage(account.address, until) });
  return [
    account.address,
    String(until),
    String(parseInt(hex.slice(130), 16)),
    hex.slice(0, 66),
    `0x${hex.slice(66, 130)}`,
  ].join("|");
}

const nowSec = () => Math.floor(Date.now() / 1000);

async function errorCode(res: Response): Promise<unknown> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

/** Minimal probe app with the app-level error mapping for session codes. */
function probeApp(): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err.name === "session_expired" || err.name === "session_invalid") {
      return c.json({ error: { code: err.name, message: err.message } }, 401);
    }
    console.error("[probe]", err);
    return c.json({ error: { code: "internal", message: "internal error" } }, 500);
  });
  app.use("/api/whoami", sessionAuth());
  app.get("/api/whoami", (c) =>
    c.json({ wallet: (c as unknown as { get(key: string): unknown }).get("wallet") }),
  );
  return app;
}

describe("session middleware — the five named tests (FR-007)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("1. expired session → 401 session_expired", async () => {
    const header = await mintHeader(nowSec() - 120); // validly signed, past window
    const res = await probeApp().request("/api/whoami", { headers: { "x-kite-session": header } });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("session_expired");
  });

  it("2. tampered signature → 401 session_invalid", async () => {
    const header = await mintHeader(nowSec() + 3_600);
    const parts = header.split("|");
    const r = parts[3] ?? "";
    parts[3] = `${r.slice(0, -1)}${r.endsWith("a") ? "b" : "a"}`; // flip last hex char
    const res = await probeApp().request("/api/whoami", {
      headers: { "x-kite-session": parts.join("|") },
    });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("session_invalid");
  });

  it("3. valid session → 200 with the correct recovered identity", async () => {
    const header = await mintHeader(nowSec() + 3_600);
    const declared = header.split("|")[0] ?? "";
    const res = await probeApp().request("/api/whoami", { headers: { "x-kite-session": header } });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { wallet: string };
    expect(payload.wallet.toLowerCase()).toBe(declared.toLowerCase());
  });

  it("3b. window beyond 7d+60s → 401 session_invalid; malformed → 401 session_invalid", async () => {
    const app = probeApp();
    const far = await mintHeader(nowSec() + 8 * 24 * 60 * 60);
    const tooLong = await app.request("/api/whoami", {
      headers: { "x-kite-session": far },
    });
    expect(tooLong.status).toBe(401);
    expect(await errorCode(tooLong)).toBe("session_invalid");
    for (const bad of ["", "nonsense", "0xabc|1|27|0xr|0xs"]) {
      const res = await app.request("/api/whoami", { headers: { "x-kite-session": bad } });
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toBe("session_invalid");
    }
    const missing = await app.request("/api/whoami");
    expect(missing.status).toBe(401);
    expect(await errorCode(missing)).toBe("session_invalid");
  });

  it("4. /api/p/:id → 200 with NO session header (public domain intact)", async () => {
    const chain: ChainClient = fakeChain({
      walletOfIdentity: async () => `0x${"a1".repeat(20)}`,
      identityOf: async () => HASH,
      profileOf: async () => ({ totalIsas: 0, completed: 0, qualEvents: 0, distinctBackers: 0 }),
      balanceAusd: async () => 0n,
      scoreOf: async () => 0,
      offerOf: async () => 600_000_000,
    });
    const app = createApp({ db, chain, mitaKey: "k" });
    const res = await app.request(`/api/p/${HASH}`);
    expect(res.status).toBe(200);
  });

  it("5. MITA purchase route → unaffected by the middleware", async () => {
    const app = createApp({ db, chain: fakeChain(), mitaKey: "mita-demo-key" });
    // No session header at all; the service domain answers exactly as 005 —
    // an empty body is the ROUTE's 400 (auth passed; sessionAuth not mounted).
    const res = await app.request("/api/channel/purchases", {
      method: "POST",
      headers: { "x-api-key": "mita-demo-key", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const bodyCode = ((await res.json()) as { error: { code: string } }).error.code;
    expect(bodyCode).not.toMatch(/^session_/);
    // And without the service key it stays 005's own unauthorized — still not
    // a session rejection.
    const noKey = await app.request("/api/channel/purchases", { method: "POST", body: "{}" });
    expect(noKey.status).toBe(401);
    expect(((await noKey.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });
});
