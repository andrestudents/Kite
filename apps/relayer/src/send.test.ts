// T022: nonce resync (the chain count WINS after a simulated restart), the
// D7 proof-gated confirmation, the FR-013 pre-resend proof gate, capped
// backoff + terminal_at, and the daily native-spend ceiling. The wallet is a
// mock — no network here.
import { beforeEach, describe, expect, it } from "bun:test";
import type { KiteError } from "@kite/core";
import { type AnyDb, drips, relayerJobs } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { eq } from "drizzle-orm";
import { assertDripWithinDailyCap, nativeSpendTodayWei } from "./caps.js";
import { enqueue, getJob, setJobStatus } from "./queue.js";
import {
  backoffMs,
  MAX_ATTEMPTS,
  type RelayerWallet,
  resendGated,
  type SendPlan,
  sendOnce,
} from "./send.js";

const PLAN: SendPlan = {
  address: `0x${"11".repeat(20)}` as `0x${string}`,
  abi: [],
  functionName: "bindIdentity",
  args: ["0xabc", `0x${"aa".repeat(32)}`],
  gasFixedLimit: 158_000,
};

interface WalletScript {
  pendingCount: bigint;
  writeHashes: string[];
  writeCalls: { plan: SendPlan; nonce: number }[];
  /** Map txHash → mined status; a missing hash is UNMINED (null). */
  receipts: Record<string, "success" | "reverted">;
  throwOnWrite?: Error;
}

function mockWallet(script: WalletScript): RelayerWallet {
  return {
    async transactionCountPending() {
      return script.pendingCount;
    },
    async writeCall(plan, nonce) {
      script.writeCalls.push({ plan, nonce });
      if (script.throwOnWrite) {
        throw script.throwOnWrite;
      }
      const hash = script.writeHashes.shift();
      if (!hash) {
        throw new Error("no scripted hash");
      }
      return hash as `0x${string}`;
    },
    async sendNative() {
      throw new Error("native sends are not scripted in this test");
    },
    async receiptWithLogs(txHash) {
      const status = script.receipts[txHash];
      return status ? { status, logs: [] } : null;
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
}

async function seedJob(
  db: AnyDb,
  kind = "bind_identity",
  status = "pending",
  nonce: number | null = null,
): Promise<Awaited<ReturnType<typeof getJob>>> {
  const { job } = await enqueue(db, {
    kind,
    payload: { wallet: "0xabc", identityHash: `0x${"aa".repeat(32)}` },
  });
  if (status !== "pending") {
    await setJobStatus(db, job.id, status);
  }
  // A real `sent` row always carries its broadcast hash (markSent writes both).
  if (status === "sent") {
    await db.update(relayerJobs).set({ txHash: "0xseedtx" }).where(eq(relayerJobs.id, job.id));
  }
  if (nonce !== null) {
    await db.update(relayerJobs).set({ nonce }).where(eq(relayerJobs.id, job.id));
  }
  return getJob(db, job.id);
}

describe("backoffMs", () => {
  it("doubles and caps at 8s", () => {
    expect(backoffMs(1)).toBe(500);
    expect(backoffMs(2)).toBe(1_000);
    expect(backoffMs(3)).toBe(2_000);
    expect(backoffMs(99)).toBe(8_000);
  });
});

describe("sendOnce (T022)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("nonce drift after a simulated restart: the chain pending count wins (D6)", async () => {
    const job = await seedJob(db, "bind_identity", "pending", 4); // a stale local record
    const script: WalletScript = {
      pendingCount: 41n,
      writeHashes: ["0xhash1"],
      writeCalls: [],
      receipts: { "0xhash1": "success" },
    };
    const outcome = await sendOnce(db, mockWallet(script), job, PLAN);
    expect(outcome.status).toBe("confirmed");
    expect(script.writeCalls[0]?.nonce).toBe(41); // NOT the stale 4

    const row = await getJob(db, job.id);
    expect(row.status).toBe("confirmed");
    expect(row.txHash).toBe("0xhash1");
    expect(row.nonce).toBe(41);
  });

  it("every send carries the published fixed gas limit verbatim (D10)", async () => {
    const job = await seedJob(db);
    const script: WalletScript = {
      pendingCount: 0n,
      writeHashes: ["0xhash2"],
      writeCalls: [],
      receipts: {},
    };
    const outcome = await sendOnce(db, mockWallet(script), job, PLAN, { receiptTries: 1 });
    expect(outcome.status).toBe("sent"); // unmined — in-flight record kept
    expect(script.writeCalls[0]?.plan.gasFixedLimit).toBe(158_000);
    const row = await getJob(db, job.id);
    expect(row.status).toBe("sent");
    expect(row.txHash).toBe("0xhash2");
  });

  it("records attempts and last_error on failure; terminal_at when MAX_ATTEMPTS is exhausted", async () => {
    const job = await seedJob(db);
    const boom = new Error("socket hang up");
    const script: WalletScript = {
      pendingCount: 0n,
      writeHashes: [],
      writeCalls: [],
      receipts: {},
      throwOnWrite: boom,
    };

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const current = await getJob(db, job.id);
      const outcome = await sendOnce(db, mockWallet(script), current, PLAN);
      const row = await getJob(db, job.id);
      expect(row.attempts).toBe(i);
      expect(row.lastError).toContain("socket hang up");
      if (i < MAX_ATTEMPTS) {
        expect(outcome.status).toBe("retryable");
        expect(row.terminalAt).toBeNull();
      } else {
        expect(outcome.status).toBe("terminal");
        expect(row.terminalAt).not.toBeNull();
      }
    }
  });

  it("a success receipt without the per-kind proof is retryable, never confirmed (D7)", async () => {
    const job = await seedJob(db);
    const script: WalletScript = {
      pendingCount: 0n,
      writeHashes: ["0xhash5"],
      writeCalls: [],
      receipts: { "0xhash5": "success" },
    };
    const outcome = await sendOnce(db, mockWallet(script), job, PLAN, { proof: async () => false });
    if (outcome.status !== "retryable") {
      throw new Error("expected retryable");
    }
    expect(outcome.error).toContain("proof is missing");
    expect((await getJob(db, job.id)).status).toBe("sent"); // stays in-flight for the gated re-claim
  });
});

describe("resendGated (FR-013: never a blind resend)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("confirms from the proof without a second broadcast when the effect landed", async () => {
    const job = await seedJob(db, "bind_identity", "sent"); // txHash 0xseedtx
    const script: WalletScript = {
      pendingCount: 0n,
      writeHashes: [],
      writeCalls: [],
      receipts: { "0xseedtx": "success" },
    };
    const outcome = await resendGated(db, mockWallet(script), job, PLAN, async () => true);
    expect(outcome.status).toBe("confirmed");
    expect(script.writeCalls.length).toBe(0); // no resend
    expect((await getJob(db, job.id)).status).toBe("confirmed");
  });

  it("resends only after the mined receipt + proof show the effect did NOT land", async () => {
    const job = await seedJob(db, "bind_identity", "sent", 7); // txHash 0xseedtx
    const script: WalletScript = {
      pendingCount: 55n,
      writeHashes: ["0xhash3"],
      writeCalls: [],
      receipts: { "0xseedtx": "reverted", "0xhash3": "success" },
    };
    // The proof reads chain state: false until the resend lands, then true.
    const proof = async () => script.writeCalls.length > 0;
    const outcome = await resendGated(db, mockWallet(script), job, PLAN, proof);
    expect(outcome.status).toBe("confirmed");
    expect(script.writeCalls.length).toBe(1); // exactly one proven resend
    expect(script.writeCalls[0]?.nonce).toBe(55); // resynced again
  });

  it("keeps waiting on an unmined receipt — no resend against a live mempool entry", async () => {
    const job = await seedJob(db, "bind_identity", "sent");
    const script: WalletScript = {
      pendingCount: 0n,
      writeHashes: [],
      writeCalls: [],
      receipts: {},
    }; // 0xseedtx unmined
    const outcome = await resendGated(db, mockWallet(script), job, PLAN, async () => {
      throw new Error("proof must not run while unmined");
    });
    expect(outcome.status).toBe("sent");
    expect(script.writeCalls.length).toBe(0);
  });

  it("confirmed is finished history — no proof, no send", async () => {
    const job = await seedJob(db, "bind_identity", "confirmed");
    const script: WalletScript = {
      pendingCount: 0n,
      writeHashes: [],
      writeCalls: [],
      receipts: {},
    };
    let proofs = 0;
    const outcome = await resendGated(db, mockWallet(script), job, PLAN, async () => {
      proofs++;
      return true;
    });
    expect(outcome.status).toBe("confirmed");
    expect(proofs).toBe(0);
    expect(script.writeCalls.length).toBe(0);
  });

  it("a pending job (crash before broadcast) sends without a pre-send proof — the gate is skipped", async () => {
    const job = await seedJob(db, "bind_identity", "pending");
    const script: WalletScript = {
      pendingCount: 9n,
      writeHashes: ["0xhash4"],
      writeCalls: [],
      receipts: { "0xhash4": "success" },
    };
    let proofCalls = 0;
    const outcome = await resendGated(db, mockWallet(script), job, PLAN, async () => {
      proofCalls++;
      return true;
    });
    expect(outcome.status).toBe("confirmed");
    expect(script.writeCalls.length).toBe(1);
    expect(script.writeCalls[0]?.nonce).toBe(9);
    // The proof ran exactly once — on the fresh receipt (D7), never before the broadcast.
    expect(proofCalls).toBe(1);
  });
});

describe("caps (§7.2 rule 5 daily ceiling)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("blocks the day's drip beyond RELAYER_DAILY_CAP_MON_WEI", async () => {
    const dripMonWei = 50_000_000_000_000_000n; // 0.05 MON
    const dailyCap = 120_000_000_000_000_000n; // 0.12 MON → 2 drips fit, 3rd refused

    expect(await nativeSpendTodayWei(db, dripMonWei)).toBe(0n);
    await assertDripWithinDailyCap(db, dripMonWei, dailyCap);
    await db.insert(drips).values({ wallet: "0xa", txHash: "0xtxa" });
    await assertDripWithinDailyCap(db, dripMonWei, dailyCap);
    await db.insert(drips).values({ wallet: "0xb", txHash: "0xtxb" });
    expect(await nativeSpendTodayWei(db, dripMonWei)).toBe(100_000_000_000_000_000n);

    try {
      await assertDripWithinDailyCap(db, dripMonWei, dailyCap);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as KiteError).code).toBe("daily_cap_exceeded");
    }
  });

  it("drips on prior days do not count", async () => {
    const dripMonWei = 50_000_000_000_000_000n;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.insert(drips).values({ wallet: "0xold", txHash: "0xtxold", createdAt: yesterday });
    expect(await nativeSpendTodayWei(db, dripMonWei)).toBe(0n);
    await expect(assertDripWithinDailyCap(db, dripMonWei, dripMonWei)).resolves.toBe(dripMonWei);
  });
});
