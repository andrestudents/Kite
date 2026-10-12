// T012 — the eight NAMED conformance tests (contracts/jobs-route.md §6) over
// PGlite + fake chain + a queue-mirroring fake relayer (the fake dedupes by
// clientRef, exactly what 005's queue unique-contract does — so the replay
// test can assert ONE job, not just one ref). Every cap test also proves
// NOTHING was enqueued: a refused job never reaches the relayer.
import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import type { Hono } from "hono";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type ApiDeps, createApp } from "../app.js";
import { buildSessionMessage } from "../middleware/session.js";
import type { ChainClient, IsaOnchain } from "../services/chain.js";
import { fakeChain } from "../services/fake-chain.js";
import type { EnqueueInput, EnqueueResult, RelayerClient } from "../services/relayer-client.js";

/** Session header minted by a throwaway account (same recipe as T007/T015). */
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

/** Queue-mirroring relayer fake — replays return the SAME job (005 queue). */
function fakeRelayer(): RelayerClient & { calls: EnqueueInput[] } {
  const calls: EnqueueInput[] = [];
  const seen = new Map<string, number>();
  return {
    calls,
    async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
      const existing = seen.get(input.clientRef);
      if (existing !== undefined) {
        return { jobId: existing, created: false };
      }
      const jobId = calls.length + 1;
      calls.push(input);
      seen.set(input.clientRef, jobId);
      return { jobId, created: true };
    },
  };
}

function appWith(
  db: TestDb,
  chain: ChainClient,
  relayer: RelayerClient,
  mitaKey = "internal-demo-key",
): Hono {
  return createApp({ db, chain, mitaKey, relayer } satisfies ApiDeps);
}

const untilFar = () => Math.floor(Date.now() / 1000) + 3_600;
const R = `0x${"11".repeat(32)}`;
const S = `0x${"22".repeat(32)}`;
const NONCE = `0x${"33".repeat(32)}`;

const SEEKER = privateKeyToAccount(generatePrivateKey()).address; // EIP-55
const OTHER = privateKeyToAccount(generatePrivateKey()).address; // EIP-55

const BASE_ISA: IsaOnchain = {
  principal: 480_000_000,
  shareBps: 1540,
  capMult: 1300,
  termEnd: 1_900_000_000,
  channelId: 1,
  seeker: SEEKER,
  backer: OTHER,
  remaining: 624_000_000,
  activatedAt: 0,
  lastEventAt: 0,
  eventCount: 0,
  status: 1, // Drafted
};

/** Drafted ISA whose seeker's live offer still covers the principal. */
function draftableChain(): ChainClient {
  const base = fakeChain();
  return fakeChain({
    isaOf: async (id) => ({ ...(await base.isaOf(id)), ...BASE_ISA }),
    offerOf: async () => 600_000_000,
    balanceAusd: async () => 2_000_000_000n,
  });
}

const activateBody = {
  kind: "activate_with_permit",
  isaId: "3",
  deadline: "1760000000",
  v: 27,
  r: R,
  s: S,
};

const transferBody = {
  kind: "transfer_with_authorization",
  from: "",
  to: OTHER,
  valueAusd: "1200000000",
  validAfter: "1760000000",
  validBefore: "1760003600",
  nonce: NONCE,
  v: 27,
  r: R,
  s: S,
};

async function post(app: Hono, header: string | undefined, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (header !== undefined) headers["x-kite-session"] = header;
  return app.request("/api/me/jobs", { method: "POST", headers, body: JSON.stringify(body) });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("POST /api/me/jobs (T012 — jobs-route.md §6)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("1. valid activation → 202 with the deterministic clientRef; byte-identical payload relayed", async () => {
    const { header } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const app = appWith(db, draftableChain(), relayer);
    const res = await post(app, header, activateBody);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "1", clientRef: "activate-3" });
    expect(relayer.calls).toHaveLength(1);
    const call = relayer.calls[0];
    if (!call) throw new Error("unreachable");
    expect(call.kind).toBe("activate_with_permit");
    expect(call.clientRef).toBe("activate-3");
    // BYTE-IDENTICAL: the relayed payload is exactly the wire object received.
    expect(JSON.stringify(call.payload)).toBe(
      JSON.stringify({ isaId: "3", deadline: "1760000000", v: 27, r: R, s: S }),
    );
  });

  it("2. transfer with from ≠ session wallet → 422 sender_mismatch (no enqueue)", async () => {
    const { header } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const app = appWith(db, draftableChain(), relayer);
    const res = await post(app, header, { ...transferBody, from: OTHER });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("sender_mismatch");
    expect(relayer.calls).toHaveLength(0);
  });

  it("3. activation on a non-Drafted ISA → 409 isa_not_draftable (no enqueue)", async () => {
    const { header } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const base = fakeChain();
    const active = fakeChain({
      isaOf: async (id) => ({ ...(await base.isaOf(id)), ...BASE_ISA, status: 2 }),
      offerOf: async () => 600_000_000,
    });
    const app = appWith(db, active, relayer);
    const res = await post(app, header, activateBody);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("isa_not_draftable");
    expect(relayer.calls).toHaveLength(0);
  });

  it("4. transfer above live balance → 422 cap_exceeded (no enqueue)", async () => {
    const { header, wallet } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const poor = fakeChain({ balanceAusd: async () => 1_000_000_000n });
    const app = appWith(db, poor, relayer);
    const res = await post(app, header, { ...transferBody, from: wallet });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("cap_exceeded");
    expect(relayer.calls).toHaveLength(0);
  });

  it("5. unknown kind (bind_identity — a real 005 kind) → 422 job_kind_invalid", async () => {
    const { header } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const app = appWith(db, draftableChain(), relayer);
    const res = await post(app, header, {
      kind: "bind_identity",
      identityHash: `0x${"ab".repeat(32)}`,
    });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("job_kind_invalid");
    expect(relayer.calls).toHaveLength(0);
  });

  it("6. replay of the same transfer payload → same clientRef, ONE job (idempotent)", async () => {
    const { header, wallet } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const app = appWith(db, draftableChain(), relayer);
    const body = { ...transferBody, from: wallet };
    const first = await post(app, header, body);
    const second = await post(app, header, body);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const a = (await first.json()) as { jobId: string; clientRef: string };
    const b = (await second.json()) as { jobId: string; clientRef: string };
    expect(b.jobId).toBe(a.jobId);
    expect(b.clientRef).toBe(a.clientRef);
    expect(a.clientRef).toBe(`transfer-${wallet.toLowerCase()}-${NONCE.toLowerCase()}`);
    expect(relayer.calls).toHaveLength(1);
  });

  it("7. no session header → 401 (006 middleware, unchanged)", async () => {
    const relayer = fakeRelayer();
    const app = appWith(db, draftableChain(), relayer);
    const res = await post(app, undefined, activateBody);
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("session_invalid");
    expect(relayer.calls).toHaveLength(0);
  });

  it("8. no response or log line contains credential material (no-key-echo)", async () => {
    const { header, wallet } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const INTERNAL = "internal-demo-key-never-echo";
    const app = appWith(db, draftableChain(), relayer, INTERNAL);
    const res = await post(app, header, { ...transferBody, from: wallet });
    expect(res.status).toBe(202);
    const text = await res.text();
    expect(text.includes(INTERNAL)).toBe(false);
    expect(text.includes(R)).toBe(false);
    expect(text.includes(S)).toBe(false);
    const json = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(["clientRef", "jobId"]);
  });
});

describe("POST /api/me/jobs — shape + offer edges (T012, jobs-route.md §3)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("uint256 wire rule: isaId as a JSON number → 422 naming the FIELD, never the value", async () => {
    const { header } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const app = appWith(db, draftableChain(), relayer);
    const res = await post(app, header, { ...activateBody, isaId: 3 });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("job_payload_invalid");
    expect(body.error.message).toContain("isaId");
    expect(body.error.message).not.toContain("3");
    expect(relayer.calls).toHaveLength(0);
  });

  it("non-EIP-55 from (lowercased hex) → 422 job_payload_invalid naming from", async () => {
    const { header, wallet } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const app = appWith(db, draftableChain(), relayer);
    const res = await post(app, header, { ...transferBody, from: wallet.toLowerCase() });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("job_payload_invalid");
    expect(body.error.message).toContain("from");
    expect(relayer.calls).toHaveLength(0);
  });

  it("live offer dropped below the drafted principal → 409 offer_below_principal", async () => {
    const { header } = await mintHeader(untilFar());
    const relayer = fakeRelayer();
    const base = fakeChain();
    const shrunk = fakeChain({
      isaOf: async (id) => ({ ...(await base.isaOf(id)), ...BASE_ISA }),
      offerOf: async () => 400_000_000, // < principal 480000000
    });
    const app = appWith(db, shrunk, relayer);
    const res = await post(app, header, activateBody);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("offer_below_principal");
    expect(relayer.calls).toHaveLength(0);
  });

  it("unconfigured relayer (005-style deps) → honest 503 relayer_unreachable", async () => {
    const { header } = await mintHeader(untilFar());
    const app = createApp({ db, chain: draftableChain(), mitaKey: "k" });
    const res = await post(app, header, activateBody);
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("relayer_unreachable");
  });
});
