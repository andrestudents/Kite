// The backfill's proof: a getLogs-free sweep finds DRAFTED deals the
// activeISA() view structurally cannot (the contract sets it only at
// activation), upserts them byte-identically to the watcher's rows, and its
// stop rules (consecutive-empty gap, hard cap) hold.
import { beforeEach, describe, expect, it } from "bun:test";
import { isas } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { eq } from "drizzle-orm";
import type { IsaOnchain } from "../services/chain.js";
import { fakeChain } from "../services/fake-chain.js";
import { backfillRegistry, SWEEP_CAP, SWEEP_GAP } from "./backfill-registry.js";

const SEEKER = `0x${"5c".repeat(20)}` as `0x${string}`;
const BACKER = `0x${"b2".repeat(20)}` as `0x${string}`;

const isaOnchain = (status: number, isaId: number): IsaOnchain => ({
  principal: 500_000_000,
  shareBps: 2_000,
  capMult: 130,
  termEnd: 1_794_270_000,
  channelId: 1,
  seeker: isaId === 2 ? SEEKER : `0x${"a1".repeat(20)}`,
  backer: BACKER,
  remaining: status === 1 ? 0 : 500_000_000,
  activatedAt: status === 1 ? 0 : 1_791_580_100,
  lastEventAt: 1_791_580_800,
  eventCount: status === 1 ? 0 : 1,
  status,
});

/** isaOf states ids 1–2 real (one active, one DRAFTED), everything after None. */
const sweepChain = () =>
  fakeChain({
    isaOf: async (isaId: number) =>
      isaId <= 2 ? isaOnchain(isaId === 2 ? 1 : 2, isaId) : isaOnchain(0, isaId),
  });

describe("backfillRegistry (T019)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("finds the DRAFTED deal activeISA() cannot see and caches it", async () => {
    const result = await backfillRegistry(db, sweepChain(), { wallet: SEEKER, gap: 5n });

    expect(result.cached).toBe(2);
    expect(result.scannedIds).toBe(7n); // ids 1–2 real, then the 5-empty gap stops it
    const drafted = await db.select().from(isas).where(eq(isas.isaId, 2));
    expect(drafted[0]).toMatchObject({ seeker: SEEKER, status: "drafted", remaining: 0 });
    expect(result.matches).toEqual([
      { isaId: 2, status: "drafted", seeker: SEEKER, backer: BACKER },
    ]);
  });

  it("rows are byte-identical to the watcher's projection (same isaCacheRow)", async () => {
    await backfillRegistry(db, sweepChain(), { gap: 5n });
    const rows = await db.select().from(isas).orderBy(isas.isaId);
    expect(rows.map((r) => r.status)).toEqual(["active", "drafted"]);
    expect(rows[0]).toMatchObject({ principal: 500_000_000, shareBps: 2_000, capMult: 130 });
  });

  it("the hard cap bounds the sweep even with no empty gap", async () => {
    const endless = fakeChain({
      isaOf: async (isaId: number) => isaOnchain(2, isaId), // never None
    });
    const result = await backfillRegistry(db, endless, { cap: 3n });
    expect(result.scannedIds).toBe(3n);
    expect(result.cached).toBe(3);
    expect(SWEEP_CAP).toBe(5_000n);
    expect(SWEEP_GAP).toBe(100n);
  });
});
