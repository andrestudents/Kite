// T021: enqueue idempotency, kind whitelist, FIFO claim, and the D5 restart
// invariant — a job left `sent` by a dead worker is re-claimed (exactly once
// per claim, ahead of pending work) so its resolution is a READ-BACK decision,
// never a blind second send (FR-013).
import { beforeEach, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import { KiteError } from "@kite/core";
import { relayerJobs } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { createRelayerApp } from "./app.js";
import { claimJob, enqueue, getJob, setJobStatus } from "./queue.js";

describe("enqueue (§7.2 rule 1 for jobs)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("creates a pending job and enforces the FR-015 whitelist", async () => {
    const { job, created } = await enqueue(db, { kind: "drip", payload: { wallet: "0xabc" } });
    expect(created).toBe(true);
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);

    for (const kind of ["activate_with_permit", "transfer_with_authorization", "bind_identity", "drip"]) {
      const ok = await enqueue(db, { kind, payload: {} });
      expect(ok.created).toBe(true);
    }
    try {
      await enqueue(db, { kind: "upgrade_proxy", payload: {} });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as KiteError).code).toBe("unknown_kind");
    }
  });

  it("collapses duplicate clientRefs onto the original job", async () => {
    const first = await enqueue(db, { kind: "drip", payload: { wallet: "0xabc" }, clientRef: "wf-1" });
    const second = await enqueue(db, { kind: "drip", payload: { wallet: "0xabc" }, clientRef: "wf-1" });
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    const all = await db.select().from(relayerJobs);
    expect(all.length).toBe(1);
  });

  it("every clientRef-less call is a new job", async () => {
    await enqueue(db, { kind: "drip", payload: {} });
    await enqueue(db, { kind: "drip", payload: {} });
    expect((await db.select().from(relayerJobs)).length).toBe(2);
  });
});

describe("claimJob (D5: one transaction in flight per key)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("claims FIFO among pending jobs and never re-claims confirmed work", async () => {
    const a = await enqueue(db, { kind: "drip", payload: {} });
    const b = await enqueue(db, { kind: "bind_identity", payload: {} });
    await enqueue(db, { kind: "drip", payload: {} });

    const first = await claimJob(db);
    expect(first?.id).toBe(a.job.id);
    await setJobStatus(db, a.job.id, "confirmed");
    const second = await claimJob(db);
    expect(second?.id).toBe(b.job.id);
    await setJobStatus(db, b.job.id, "confirmed");
    const third = await claimJob(db);
    expect(third?.id).not.toBe(b.job.id);
    await setJobStatus(db, third!.id, "confirmed");
    expect(await claimJob(db)).toBeUndefined();
  });

  it("restart scenario: a job left sent (crash after broadcast) is claimed BEFORE pending work", async () => {
    const crashed = await enqueue(db, { kind: "drip", payload: { wallet: "0xa" } });
    await setJobStatus(db, crashed.job.id, "sent"); // the simulated crash state
    const queued = await enqueue(db, { kind: "drip", payload: { wallet: "0xb" } });

    // first claim after the "restart" resolves the in-flight job, not the new one
    const recovery = await claimJob(db);
    expect(recovery?.id).toBe(crashed.job.id);
    expect(recovery?.status).toBe("sent");

    // once resolved (confirmed), the queue moves on — exactly one resolution
    await setJobStatus(db, crashed.job.id, "confirmed");
    const next = await claimJob(db);
    expect(next?.id).toBe(queued.job.id);
    await setJobStatus(db, queued.job.id, "confirmed");

    const drained = await claimJob(db);
    expect(drained).toBeUndefined();
  });
});

describe("relayer routes (http-api shapes)", () => {
  let db: TestDb;
  let app: Hono;
  let internalKey: string;

  beforeEach(async () => {
    db = await makeTestDb();
    internalKey = "internal-demo-key";
    app = createRelayerApp({ db, internalKey });
  });

  const post = (body: unknown, key = internalKey) =>
    app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
      body: JSON.stringify(body),
    });

  it("401 without the key — no echo", async () => {
    const res = await post({ kind: "drip", payload: {} }, "");
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain(internalKey);
  });

  it("POST → 202 {jobId}; duplicate clientRef → 200 same jobId", async () => {
    const body = { kind: "drip", payload: { wallet: "0xa" }, clientRef: "wf-9" };
    const first = await post(body);
    expect(first.status).toBe(202);
    const a = (await first.json()) as { jobId: number };
    const second = await post(body);
    expect(second.status).toBe(200);
    const b = (await second.json()) as { jobId: number };
    expect(b.jobId).toBe(a.jobId);
  });

  it("unknown kind → 400 unknown_kind", async () => {
    const res = await post({ kind: "mint_mon", payload: {} });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unknown_kind");
  });

  it("GET /jobs/:id returns the 7-field shape; unknown id → 404 job_not_found", async () => {
    const { job } = await enqueue(db, { kind: "drip", payload: { wallet: "0xa" }, clientRef: "wf-2" });
    const res = await app.request(`/api/jobs/${job.id}`, { headers: { "x-api-key": internalKey } });
    expect(res.status).toBe(200);
    const dto = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(dto).sort()).toEqual([
      "attempts",
      "id",
      "kind",
      "lastError",
      "status",
      "terminalAt",
      "txHash",
    ]);

    const missing = await app.request("/api/jobs/999999", { headers: { "x-api-key": internalKey } });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("job_not_found");
  });

  it("getJob rejects non-numeric ids", async () => {
    await expect(getJob(db, -1)).rejects.toMatchObject({ code: "job_not_found" });
  });
});
