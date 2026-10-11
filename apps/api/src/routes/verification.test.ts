// T015 — the verification surface over PGlite + fake chain + a capturing
// fake relayer (contract web-api.md §2–§3): derived read-backs, 422 on a
// malformed hash, idempotent replays via identical clientRefs, honest 503
// when the relayer is unreachable, and session auth on both routes.
import { beforeEach, describe, expect, it } from "bun:test";
import { KiteError } from "@kite/core";
import { drips } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import type { Hono } from "hono";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type ApiDeps, createApp } from "../app.js";
import { buildSessionMessage } from "../middleware/session.js";
import type { ChainClient } from "../services/chain.js";
import { fakeChain } from "../services/fake-chain.js";
import type { EnqueueInput, EnqueueResult, RelayerClient } from "../services/relayer-client.js";

/** Session header minted by a throwaway account (same recipe as T007). */
async function mintHeader(until: number): Promise<{ header: string; wallet: string }> {
  const account = privateKeyToAccount(generatePrivateKey());
  const hex = await account.signMessage({
    message: buildSessionMessage(account.address, until),
  });
  const header = [
    account.address,
    String(until),
    String(parseInt(hex.slice(130), 16)),
    hex.slice(0, 66),
    `0x${hex.slice(66, 130)}`,
  ].join("|");
  return { header, wallet: account.address };
}

/** Capturing relayer fake — records every enqueue; replays echo the same jobId. */
function fakeRelayer(): RelayerClient & { calls: EnqueueInput[] } {
  const calls: EnqueueInput[] = [];
  return {
    calls,
    async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
      calls.push(input);
      return { jobId: calls.length, created: true };
    },
  };
}

function appWith(db: TestDb, chain: ChainClient, relayer: RelayerClient): Hono {
  return createApp({ db, chain, mitaKey: "mita-key", relayer } satisfies ApiDeps);
}

const untilFar = () => Math.floor(Date.now() / 1000) + 3_600;
const HASH = `0x${"ab".repeat(32)}`;

async function errorCode(res: Response): Promise<unknown> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("GET /api/me/verification (T015)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("session-authed: identityBound and dripped both derive false on fresh state", async () => {
    const { header } = await mintHeader(untilFar());
    const app = appWith(db, fakeChain(), fakeRelayer());
    const res = await app.request("/api/me/verification", {
      headers: { "x-kite-session": header },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ identityBound: false, dripped: false });
  });

  it("reads back bound identity and the drips row (either casing)", async () => {
    const { header, wallet } = await mintHeader(untilFar());
    const chain = fakeChain({ identityOf: async () => HASH });
    const relayer = fakeRelayer();
    const app = appWith(db, chain, relayer);
    // Seed the lock row the way 005's drip handler does — payload casing.
    await db.insert(drips).values({ wallet: wallet.toLowerCase(), txHash: `0x${"aa".repeat(32)}` });
    const res = await app.request("/api/me/verification", {
      headers: { "x-kite-session": header },
    });
    expect(await res.json()).toEqual({ identityBound: true, dripped: true });
  });

  it("no session header → 401 session_invalid", async () => {
    const app = appWith(db, fakeChain(), fakeRelayer());
    const res = await app.request("/api/me/verification");
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("session_invalid");
  });
});

describe("POST /api/me/verification (T015)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("enqueues bind_identity + drip with deterministic clientRefs; no user rows written", async () => {
    const { header, wallet } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const app = appWith(db, fakeChain(), relayer);
    const res = await app.request("/api/me/verification", {
      method: "POST",
      headers: { "x-kite-session": header, "content-type": "application/json" },
      body: JSON.stringify({ identityHash: HASH }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      identityBound: false,
      dripped: false,
      enqueued: ["bind_identity", "drip"],
    });
    expect(relayer.calls).toHaveLength(2);
    const [bind, drip] = relayer.calls;
    if (!bind || !drip) throw new Error("unreachable");
    expect(bind.kind).toBe("bind_identity");
    expect(bind.payload).toEqual({ wallet, identityHash: HASH });
    expect(bind.clientRef).toBe(`bind-${wallet.toLowerCase()}`);
    expect(drip.kind).toBe("drip");
    expect(drip.payload).toEqual({ wallet });
    expect(drip.clientRef).toBe(`drip-${wallet.toLowerCase()}`);
  });

  it("double-POST replays carry IDENTICAL clientRefs — the idempotency mechanism", async () => {
    const { header } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const app = appWith(db, fakeChain(), relayer);
    const body = JSON.stringify({ identityHash: HASH });
    const init = {
      method: "POST",
      headers: { "x-kite-session": header, "content-type": "application/json" },
      body,
    };
    await app.request("/api/me/verification", init);
    await app.request("/api/me/verification", init);
    const refs = relayer.calls.map((call) => call.clientRef);
    expect(refs).toHaveLength(4);
    expect(new Set(refs).size).toBe(2); // exactly one bind- and one drip- ref, replayed
    expect(refs.filter((r) => r.startsWith("bind-"))).toHaveLength(2);
  });

  it("malformed hash → 422 identity_hash_invalid and NOTHING enqueued", async () => {
    const { header } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const app = appWith(db, fakeChain(), relayer);
    for (const bad of ["nope", HASH.slice(2), `0x${"ab".repeat(31)}`, `0x${"zz".repeat(32)}`]) {
      const res = await app.request("/api/me/verification", {
        method: "POST",
        headers: { "x-kite-session": header, "content-type": "application/json" },
        body: JSON.stringify({ identityHash: bad }),
      });
      expect(res.status).toBe(422);
      expect(await errorCode(res)).toBe("identity_hash_invalid");
    }
    expect(relayer.calls).toHaveLength(0);
  });

  it("unreachable relayer → 503 relayer_unreachable (trigger is a no-op route-side)", async () => {
    const { header } = await mintHeader(untilFar());
    const relayer: RelayerClient = {
      async enqueue() {
        throw new KiteError("relayer_unreachable", "down");
      },
    };
    const app = appWith(db, fakeChain(), relayer);
    const res = await app.request("/api/me/verification", {
      method: "POST",
      headers: { "x-kite-session": header, "content-type": "application/json" },
      body: JSON.stringify({ identityHash: HASH }),
    });
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("relayer_unreachable");
  });

  it("no configured relayer (005-style deps) → still honestly 503", async () => {
    const { header } = await mintHeader(untilFar());
    const app = createApp({ db, chain: fakeChain(), mitaKey: "k" });
    const res = await app.request("/api/me/verification", {
      method: "POST",
      headers: { "x-kite-session": header, "content-type": "application/json" },
      body: JSON.stringify({ identityHash: HASH }),
    });
    expect(res.status).toBe(503);
  });
});
