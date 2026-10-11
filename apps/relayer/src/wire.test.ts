// T036 rework — the uint256 wire contract, proven at the HTTP surface with the
// gate's EXACT payload shape: scripts/gates/gasless-send.ts POSTs this byte
// stream; the relayer must accept decimal-string uint256 fields at the edge,
// reject malformed ones with bad_request, and hand the handler exact BigInts.
import { describe, expect, it } from "bun:test";
import { type AnyDb, relayerJobs } from "@kite/core/db";
import { makeTestDb } from "@kite/core/testing";
import { eq } from "drizzle-orm";
import { AUSD, addressTopic, TRANSFER_TOPIC } from "./contracts.js";
import { dispatchJob, type RelayerContext } from "./dispatch.js";
import { getJob } from "./queue.js";
import type { MinedReceipt, RelayerWallet, SendPlan } from "./send.js";

// Side-effect handler registration — the same modules index.ts loads.
import "./jobs/transfer-with-authorization.js";

const W = `0x${"a1".repeat(20)}` as `0x${string}`;
const R = `0x${"b2".repeat(20)}` as `0x${string}`;
const NONCE = `0x${"44".repeat(32)}` as `0x${string}`;
const R32 = `0x${"11".repeat(32)}` as `0x${string}`;
const S32 = `0x${"22".repeat(32)}` as `0x${string}`;
const MAX_UINT256 = (2n ** 256n - 1n).toString();

/** The EXACT body the SC-001 gate serializes (uint256 fields = decimal strings). */
function gateBody(overrides: Record<string, unknown> = {}): string {
  const payload = {
    from: W,
    to: R,
    valueAusd: "1000000",
    validAfter: "1791580000",
    validBefore: "1791583600",
    nonce: NONCE,
    v: 27,
    r: R32,
    s: S32,
    ...overrides,
  };
  return JSON.stringify({ kind: "transfer_with_authorization", payload, clientRef: "wire-1" });
}

function post(app: ReturnType<typeof import("./app.js").createRelayerApp>, body: string) {
  return app.request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "k" },
    body,
  });
}

function receivingWallet(seen: { plan?: SendPlan }) {
  const receiptFor = (txHash: string): MinedReceipt | null =>
    txHash === "0xwire7" && seen.plan
      ? {
          status: "success",
          logs: [
            {
              address: AUSD,
              topics: [TRANSFER_TOPIC, addressTopic(W), addressTopic(R)],
              data: `0x${1000000n.toString(16).padStart(64, "0")}`,
            },
          ],
        }
      : null;
  const wallet: RelayerWallet = {
    async transactionCountPending() {
      return 7n;
    },
    async writeCall(plan) {
      seen.plan = plan;
      return "0xwire7" as `0x${string}`;
    },
    async sendNative() {
      throw new Error("no native sends in this test");
    },
    async receiptWithLogs(txHash) {
      return receiptFor(txHash);
    },
    async balanceOfNative() {
      return 0n;
    },
    async identityOf() {
      return `0x${"00".repeat(32)}`;
    },
    async isaStatusOf() {
      return 0;
    },
  };
  return wallet;
}

describe("uint256 wire contract over HTTP (T036 rework)", () => {
  it("accepts the gate's exact decimal-string payload and dispatches exact BigInts", async () => {
    const db = await makeTestDb();
    const { createRelayerApp } = await import("./app.js");
    const app = createRelayerApp({ db: db as unknown as AnyDb, internalKey: "k" });

    const res = await post(app, gateBody());
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: number };
    expect(typeof jobId).toBe("number");

    // The worker dispatches the queued job; the contract call must carry the
    // EXACT BigInts the decimal strings name — not floats, not strings.
    const seen: { plan?: SendPlan } = {};
    const ctx: RelayerContext = {
      db,
      wallet: receivingWallet(seen),
      dripMonWei: 1n,
      dailyCapMonWei: 1n,
    };
    const queued = await getJob(db, jobId);
    const outcome = await dispatchJob(ctx, queued);

    expect(outcome.status).toBe("confirmed");
    expect(seen.plan?.functionName).toBe("transferWithAuthorization");
    expect(seen.plan?.address).toBe(AUSD);
    expect(seen.plan?.args[0]).toBe(W);
    expect(seen.plan?.args[1]).toBe(R);
    expect(seen.plan?.args[2]).toBe(1_000_000n); // "1000000" → exact BigInt
    expect(seen.plan?.args[3]).toBe(1_791_580_000n);
    expect(seen.plan?.args[4]).toBe(1_791_583_600n);
    expect(seen.plan?.args[5]).toBe(NONCE);
    expect(seen.plan?.args[6]).toBe(27); // v stays a number for viem's uint8
    expect((await getJob(db, jobId)).status).toBe("confirmed");
  });

  it("accepts MAX_UINT256 as a decimal string (JSON numbers could never carry it)", async () => {
    const db = await makeTestDb();
    const { createRelayerApp } = await import("./app.js");
    const app = createRelayerApp({ db: db as unknown as AnyDb, internalKey: "k" });

    const res = await post(app, gateBody({ valueAusd: MAX_UINT256 }));
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: number };
    const rows = await db.select().from(relayerJobs).where(eq(relayerJobs.id, jobId)).limit(1);
    const payload = rows[0]?.payloadJson as Record<string, unknown> | undefined;
    expect(payload?.valueAusd).toBe(MAX_UINT256);
  });

  it.each([
    ["exponent form", "1e6"],
    ["float string", "12.5"],
    ["negative", "-1"],
    ["padded", " 1000000"],
    ["empty", ""],
    ["non-integer number", 1_000_000.5],
  ])("rejects %s with 400 bad_request", async (_label, bad) => {
    const db = await makeTestDb();
    const { createRelayerApp } = await import("./app.js");
    const app = createRelayerApp({ db: db as unknown as AnyDb, internalKey: "k" });

    const res = await post(app, gateBody({ valueAusd: bad as string }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("bad_request");
    // Refused at the edge — no row was ever stored.
    expect(await db.select().from(relayerJobs)).toEqual([]);
  });
});

describe("GET /health (Fly liveness probe)", () => {
  it("answers 200 ok with NO key and tells nothing else", async () => {
    const db = await makeTestDb();
    const { createRelayerApp } = await import("./app.js");
    const app = createRelayerApp({ db: db as unknown as AnyDb, internalKey: "k" });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
