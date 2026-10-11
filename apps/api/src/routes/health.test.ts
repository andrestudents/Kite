// T027: health tells the truth — both dependencies probed, any failure flips
// the entry AND the top-level status (FR-001: never a false ok).
import { describe, expect, it } from "bun:test";
import type { AnyDb } from "@kite/core/db";
import { makeTestDb } from "@kite/core/testing";
import { createApp } from "../app.js";
import { fakeChain } from "../services/fake-chain.js";

function app(db: AnyDb, chain = fakeChain()) {
  return createApp({ db, chain, mitaKey: "k" });
}

describe("GET /api/health (T027)", () => {
  it("probes db and rpc and reports ok when both answer", async () => {
    const db = await makeTestDb();
    const res = await app(db).request("/api/health");
    const body = (await res.json()) as {
      status: string;
      db: { ok: boolean; detail?: string };
      rpc: { ok: boolean; chainId?: number; blockNumber?: number };
      time: string;
    };
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db.ok).toBe(true);
    expect(body.db.detail).toBe("select 1");
    expect(body.rpc).toMatchObject({ ok: true, chainId: 10143, blockNumber: 100 });
    expect(() => new Date(body.time).toISOString()).not.toThrow();
  });

  it("a dead rpc flips the entry and the top-level status", async () => {
    const db = await makeTestDb();
    const chain = fakeChain({
      blockNumber: async () => {
        throw new Error("down");
      },
    });
    const res = await app(db, chain).request("/api/health");
    const body = (await res.json()) as {
      status: string;
      db: { ok: boolean };
      rpc: { ok: boolean; chainId?: number; detail?: string };
    };
    expect(body.status).toBe("degraded");
    expect(body.rpc.ok).toBe(false);
    expect(body.rpc.chainId).toBeUndefined();
    expect(body.db.ok).toBe(true);
  });

  it("a dead db flips the top-level status too", async () => {
    const broken = {
      execute: async () => {
        throw new Error("no db");
      },
    } as unknown as AnyDb;
    const res = await app(broken).request("/api/health");
    const body = (await res.json()) as {
      status: string;
      db: { ok: boolean };
      rpc: { ok: boolean };
    };
    expect(body.status).toBe("degraded");
    expect(body.db.ok).toBe(false);
    expect(body.rpc.ok).toBe(true);
  });
});
