// T023–T025: the four job handlers, against a scriptable mock wallet —
// per-kind D7 proofs (identityOf equality / balance ≥ drip / the AUSD Transfer
// LOG / isaOf status 2), the drips PK once-lock + daily cap, and the
// bad_request fast-terminal for malformed payloads. No network here.
import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { type AnyDb, drips, relayerJobs } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { AUSD, CORE, TRANSFER_TOPIC, addressTopic } from "./contracts.js";
import { dispatchJob, type RelayerContext } from "./dispatch.js";
import { enqueue, getJob, setJobStatus } from "./queue.js";
import { MAX_ATTEMPTS, type MinedReceipt, type RelayerWallet, type SendPlan } from "./send.js";

// Side-effect handler registration — the same modules index.ts loads.
import "./jobs/activate-with-permit.js";
import "./jobs/bind-identity.js";
import "./jobs/drip.js";
import "./jobs/transfer-with-authorization.js";

const W = `0x${"a1".repeat(20)}` as `0x${string}`;
const R = `0x${"b2".repeat(20)}` as `0x${string}`;
const HASH = `0x${"c3".repeat(32)}` as `0x${string}`;
const NONCE = `0x${"44".repeat(32)}` as `0x${string}`;
const SIG = {
  v: 27,
  r: `0x${"11".repeat(32)}` as `0x${string}`,
  s: `0x${"22".repeat(32)}` as `0x${string}`,
};
const DRIP_MON_WEI = 50_000_000_000_000_000n;

interface Script {
  pendingCount?: bigint;
  transactionCountPending?: () => Promise<bigint>;
  onWrite?: (plan: SendPlan, nonce: number) => void;
  writeHash?: (plan: SendPlan, nonce: number) => string;
  onNative?: (to: string, valueWei: bigint, nonce: number) => void;
  nativeHash?: (to: string, valueWei: bigint, nonce: number) => string;
  receiptFor?: (txHash: string) => MinedReceipt | null;
  identityOf?: (wallet: string) => Promise<string>;
  isaStatusOf?: (isaId: number) => Promise<number>;
  balanceOfNative?: (wallet: string) => Promise<bigint>;
}

function jobWallet(script: Script): RelayerWallet {
  return {
    async transactionCountPending() {
      return script.transactionCountPending ? script.transactionCountPending() : (script.pendingCount ?? 0n);
    },
    async writeCall(plan, nonce) {
      script.onWrite?.(plan, nonce);
      if (!script.writeHash) {
        throw new Error("no scripted write hash");
      }
      return script.writeHash(plan, nonce) as `0x${string}`;
    },
    async sendNative(to, valueWei, nonce) {
      script.onNative?.(to, valueWei, nonce);
      if (!script.nativeHash) {
        throw new Error("no scripted native hash");
      }
      return script.nativeHash(to, valueWei, nonce) as `0x${string}`;
    },
    async receiptWithLogs(txHash) {
      return script.receiptFor ? script.receiptFor(txHash) : null;
    },
    async balanceOfNative(wallet) {
      return script.balanceOfNative ? script.balanceOfNative(wallet) : 0n;
    },
    async identityOf(wallet) {
      return script.identityOf ? script.identityOf(wallet) : `0x${"00".repeat(32)}`;
    },
    async isaStatusOf(isaId) {
      return script.isaStatusOf ? script.isaStatusOf(isaId) : 0;
    },
  };
}

function testCtx(db: AnyDb, wallet: RelayerWallet, dailyCapMonWei = 2_000_000_000_000_000_000n): RelayerContext {
  return { db, wallet, dripMonWei: DRIP_MON_WEI, dailyCapMonWei };
}

async function seedJob(
  db: AnyDb,
  kind: string,
  payload: Record<string, unknown>,
  opts: { status?: string; txHash?: string } = {},
): Promise<Awaited<ReturnType<typeof getJob>>> {
  const { job } = await enqueue(db, { kind, payload });
  if (opts.status && opts.status !== "pending") {
    await setJobStatus(db, job.id, opts.status);
  }
  if (opts.txHash) {
    await db.update(relayerJobs).set({ txHash: opts.txHash }).where(eq(relayerJobs.id, job.id));
  }
  return getJob(db, job.id);
}

/** The AUSD Transfer(from, to, value) event exactly as a receipt would carry it. */
function transferLog(from: string, to: string, valueWei: bigint) {
  return {
    address: AUSD,
    topics: [TRANSFER_TOPIC, addressTopic(from), addressTopic(to)],
    data: `0x${valueWei.toString(16).padStart(64, "0")}`,
  };
}

describe("bind_identity (T023)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("broadcasts bindIdentity at the published limit and confirms on the identityOf proof", async () => {
    const calls: { plan: SendPlan; nonce: number }[] = [];
    let bound = false;
    const wallet = jobWallet({
      pendingCount: 12n,
      writeHash: (_plan, n) => `0xbind${n}`,
      onWrite: (plan) => {
        calls.push({ plan, nonce: 12 });
        bound = true;
      },
      identityOf: async () => (bound ? HASH : `0x${"00".repeat(32)}`),
      receiptFor: (tx) => (tx === "0xbind12" ? { status: "success", logs: [] } : null),
    });
    const job = await seedJob(db, "bind_identity", { wallet: W, identityHash: HASH });
    const outcome = await dispatchJob(testCtx(db, wallet), job);

    expect(outcome.status).toBe("confirmed");
    expect(calls.length).toBe(1);
    expect(calls[0]?.plan.address).toBe(CORE);
    expect(calls[0]?.plan.functionName).toBe("bindIdentity");
    expect(calls[0]?.plan.args).toEqual([W, HASH]);
    expect(calls[0]?.plan.gasFixedLimit).toBe(158_000); // published fixedLimit (§6.1)
    expect(calls[0]?.nonce).toBe(12); // resynced from the chain count

    const row = await getJob(db, job.id);
    expect(row.status).toBe("confirmed");
    expect(row.txHash).toBe("0xbind12");
  });

  it("a re-claimed sent job confirms from the read-back with NO second broadcast (FR-013)", async () => {
    let writes = 0;
    const wallet = jobWallet({
      identityOf: async () => HASH, // the effect already landed
      receiptFor: () => ({ status: "success", logs: [] }),
      writeHash: () => {
        writes++;
        return "0xnever";
      },
    });
    const job = await seedJob(db, "bind_identity", { wallet: W, identityHash: HASH }, { status: "sent", txHash: "0xseedtx" });
    const outcome = await dispatchJob(testCtx(db, wallet), job);
    expect(outcome.status).toBe("confirmed");
    expect(writes).toBe(0);
    expect((await getJob(db, job.id)).status).toBe("confirmed");
  });

  it("a malformed payload is terminal immediately — no retries burned on a deterministic failure", async () => {
    const wallet = jobWallet({});
    const job = await seedJob(db, "bind_identity", { wallet: W }); // identityHash missing
    const outcome = await dispatchJob(testCtx(db, wallet), job);
    expect(outcome.status).toBe("terminal");
    const row = await getJob(db, job.id);
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.terminalAt).not.toBeNull();
    expect(row.lastError).toContain("payload.identityHash");
  });
});

describe("drip (T023, FR-017)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("sends exactly DRIP_MON_WEI once, then locks the drips row on the balance proof", async () => {
    const natives: { to: string; valueWei: bigint; nonce: number }[] = [];
    const balances = new Map<string, bigint>();
    const wallet = jobWallet({
      pendingCount: 5n,
      nativeHash: (_to, _v, n) => `0xdrip${n}`,
      onNative: (to, valueWei) => {
        natives.push({ to, valueWei, nonce: 5 });
        balances.set(to, DRIP_MON_WEI); // the drip lands
      },
      balanceOfNative: async (wlt) => balances.get(wlt) ?? 0n,
      receiptFor: (tx) => (tx === "0xdrip5" ? { status: "success", logs: [] } : null),
    });
    const ctx = testCtx(db, wallet);
    const job = await seedJob(db, "drip", { wallet: W });
    const outcome = await dispatchJob(ctx, job);

    expect(outcome.status).toBe("confirmed");
    expect(natives.length).toBe(1);
    expect(natives[0]?.to).toBe(W);
    expect(natives[0]?.valueWei).toBe(DRIP_MON_WEI);

    const rows = await db.select().from(drips);
    expect(rows.length).toBe(1);
    expect(rows[0]?.wallet).toBe(W);
    expect(rows[0]?.txHash).toBe("0xdrip5");
  });

  it("a wallet with a drips row confirms duplicates with NO send (the PK once-lock)", async () => {
    await db.insert(drips).values({ wallet: W, txHash: "0xprior" });
    const natives: unknown[] = [];
    const wallet = jobWallet({
      nativeHash: () => {
        natives.push("sent");
        return "0xnever";
      },
    });
    const job = await seedJob(db, "drip", { wallet: W });
    const outcome = await dispatchJob(testCtx(db, wallet), job);
    expect(outcome.status).toBe("confirmed");
    expect(natives.length).toBe(0);
    expect((await db.select().from(drips)).length).toBe(1); // no second row
  });

  it("refuses to send past the day's ceiling — daily_cap_exceeded, no broadcast", async () => {
    const natives: unknown[] = [];
    const wallet = jobWallet({
      nativeHash: () => {
        natives.push("sent");
        return "0xnever";
      },
    });
    const ctx = testCtx(db, wallet, DRIP_MON_WEI - 1n); // cap below one drip
    const job = await seedJob(db, "drip", { wallet: W });
    const outcome = await dispatchJob(ctx, job);

    expect(outcome.status).toBe("retryable"); // the cap may free up tomorrow
    expect(natives.length).toBe(0);
    const row = await getJob(db, job.id);
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("daily_cap_exceeded");
    expect(row.terminalAt).toBeNull();
  });
});

describe("transfer_with_authorization (T024)", () => {
  let db: TestDb;
  const VALUE = 250_000_000n; // 250 AUSD in base units

  beforeEach(async () => {
    db = await makeTestDb();
  });

  const payload = () => ({
    from: W,
    to: R,
    valueAusd: Number(VALUE),
    validAfter: 1_000,
    validBefore: 9_000,
    nonce: NONCE,
    ...SIG,
  });

  it("relays at the published limit and confirms on the AUSD Transfer log", async () => {
    const calls: { plan: SendPlan; nonce: number }[] = [];
    let mined = false;
    const wallet = jobWallet({
      pendingCount: 3n,
      writeHash: (_plan, n) => `0xauth${n}`,
      onWrite: (plan) => calls.push({ plan, nonce: 3 }),
      receiptFor: (tx) =>
        tx === "0xauth3" && mined ? { status: "success", logs: [transferLog(W, R, VALUE)] } : null,
    });
    const job = await seedJob(db, "transfer_with_authorization", payload());
    // The receipt mines WITH the transfer event — the D7 proof passes.
    mined = true;
    const outcome = await dispatchJob(testCtx(db, wallet), job);

    expect(outcome.status).toBe("confirmed");
    expect(calls.length).toBe(1);
    expect(calls[0]?.plan.address).toBe(AUSD);
    expect(calls[0]?.plan.functionName).toBe("transferWithAuthorization");
    expect(calls[0]?.plan.args).toEqual([W, R, VALUE, 1_000n, 9_000n, NONCE, 27, SIG.r, SIG.s]);
    expect(calls[0]?.plan.gasFixedLimit).toBe(157_000);
    expect((await getJob(db, job.id)).status).toBe("confirmed");
  });

  it("a success receipt WITHOUT the event is retryable; the later proof confirms with no resend", async () => {
    const calls: { plan: SendPlan; nonce: number }[] = [];
    let logs: unknown[] = []; // first poll: success receipt, no Transfer event yet
    const wallet = jobWallet({
      pendingCount: 8n,
      writeHash: (_plan, n) => `0xauth${n}`,
      onWrite: (plan) => calls.push({ plan, nonce: 8 }),
      receiptFor: (tx) => (tx === "0xauth8" ? { status: "success" as const, logs } : null),
    });
    const ctx = testCtx(db, wallet);
    const job = await seedJob(db, "transfer_with_authorization", payload());
    const first = await dispatchJob(ctx, job);
    expect(first.status).toBe("retryable");
    if (first.status !== "retryable") {
      throw new Error("unreachable");
    }
    expect(first.error).toContain("proof is missing");
    expect((await getJob(db, job.id)).status).toBe("sent"); // stays in-flight, unconfirmed

    // The event appears (RPC log lag resolves) — the re-claim confirms without a resend.
    logs = [transferLog(W, R, VALUE)];
    const second = await dispatchJob(ctx, await getJob(db, job.id));
    expect(second.status).toBe("confirmed");
    expect(calls.length).toBe(1);
  });

  it("a reverted attempt re-broadcasts only after the proof shows nothing landed", async () => {
    const calls: { plan: SendPlan; nonce: number }[] = [];
    const wallet = jobWallet({
      pendingCount: 21n, // the resync yields 21 → a NEW hash, not the seeded one
      writeHash: (_plan, n) => `0xauth${n}`,
      onWrite: (plan, n) => calls.push({ plan, nonce: n }),
      receiptFor: (tx) => (tx === "0xauth21" ? { status: "success", logs: [transferLog(W, R, VALUE)] } : { status: "reverted", logs: [] }),
    });
    const job = await seedJob(
      db,
      "transfer_with_authorization",
      payload(),
      { status: "sent", txHash: "0xauth20" }, // a prior attempt mined as a revert
    );
    const outcome = await dispatchJob(testCtx(db, wallet), job);
    expect(outcome.status).toBe("confirmed");
    expect(calls.length).toBe(1); // exactly one proven resend
    expect(calls[0]?.nonce).toBe(21); // resynced before it
  });
});

describe("activate_with_permit (T025)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("relays at the published 346000 limit and confirms on isaOf status 2", async () => {
    const calls: { plan: SendPlan; nonce: number }[] = [];
    let status = 1; // drafted
    const wallet = jobWallet({
      pendingCount: 2n,
      writeHash: (_plan, n) => `0xact${n}`,
      onWrite: (plan) => {
        calls.push({ plan, nonce: 2 });
        status = 2; // active
      },
      isaStatusOf: async () => status,
      receiptFor: (tx) => (tx === "0xact2" ? { status: "success", logs: [] } : null),
    });
    const job = await seedJob(db, "activate_with_permit", { isaId: 7, deadline: 9_000, ...SIG });
    const outcome = await dispatchJob(testCtx(db, wallet), job);

    expect(outcome.status).toBe("confirmed");
    expect(calls.length).toBe(1);
    expect(calls[0]?.plan.address).toBe(CORE);
    expect(calls[0]?.plan.functionName).toBe("activateWithPermit");
    expect(calls[0]?.plan.args).toEqual([7n, 9_000n, 27, SIG.r, SIG.s]);
    expect(calls[0]?.plan.gasFixedLimit).toBe(346_000);
    expect((await getJob(db, job.id)).status).toBe("confirmed");
  });

  it("a re-claimed sent job confirms from the onchain status with NO second broadcast", async () => {
    let writes = 0;
    const wallet = jobWallet({
      isaStatusOf: async () => 2, // already active — the effect landed
      receiptFor: () => ({ status: "success", logs: [] }),
      writeHash: () => {
        writes++;
        return "0xnever";
      },
    });
    const job = await seedJob(db, "activate_with_permit", { isaId: 7, deadline: 9_000, ...SIG }, { status: "sent", txHash: "0xseedtx" });
    const outcome = await dispatchJob(testCtx(db, wallet), job);
    expect(outcome.status).toBe("confirmed");
    expect(writes).toBe(0);
  });

  it("a real revert path terminals after MAX_ATTEMPTS with visible last_error (§7.3)", async () => {
    let writes = 0;
    let count = 30n; // each resync yields a fresh nonce → a fresh hash
    const wallet = jobWallet({
      transactionCountPending: async () => count++,
      writeHash: () => `0xact${count - 1n}`,
      onWrite: () => {
        writes++;
      },
      isaStatusOf: async () => 1, // never activates
      receiptFor: () => ({ status: "reverted", logs: [] }),
    });
    const ctx = testCtx(db, wallet);
    const job = await seedJob(db, "activate_with_permit", { isaId: 7, deadline: 9_000, ...SIG });

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await dispatchJob(ctx, await getJob(db, job.id));
    }
    const row = await getJob(db, job.id);
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.terminalAt).not.toBeNull();
    expect(row.lastError).toContain("reverted onchain");
    expect(writes).toBe(MAX_ATTEMPTS); // the first send + two proven resends
  });
});
