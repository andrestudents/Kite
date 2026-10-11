// T032: the recon verdicts — clean day → ok, injected money → mismatch with
// the row written and NOTHING repaired, pre-baseline chain settlements stay
// out (D15), half-open day boundaries, and an infra failure writes NO row.
import { describe, expect, it } from "bun:test";
import { KiteError } from "@kite/core";
import { type AnyDb, jobState, purchases, reconDaily } from "@kite/core/db";
import { makeTestDb } from "@kite/core/testing";
import { eq } from "drizzle-orm";
import { fakeChain } from "../services/fake-chain.js";
import { BASELINE_KEY, dayBounds, parseDayArg, RECON_EXIT, runRecon } from "./recon.js";

const DAY = "2026-10-10";
const DAY_START = 1_791_590_400; // 2026-10-10T00:00:00Z
const DAY_END = 1_791_676_800; // 2026-10-11T00:00:00Z
const MID_DAY = 1_791_622_751; // 2026-10-10T08:59:11Z
const NOON = 1_791_633_600; // 2026-10-10T12:00:00Z
const REF = `0x${"11".repeat(32)}`;
const HASH = `0x${"c3".repeat(32)}`;

const logAt = (block: bigint, _ts: number, gross: number) => ({
  isaId: 3,
  channelId: 1,
  purchaseRef: REF,
  gross,
  toBacker: 0,
  toSeeker: gross,
  remaining: 0,
  qualifying: true,
  blockNumber: block,
  logIndex: 0,
  txHash: `0xtx${block}`,
});

/** Blocks 40 (MID_DAY 08:59Z) and 41 (13:30Z); head = block 100 (past the day). */
const dayChain = (logs: ReturnType<typeof logAt>[]) =>
  fakeChain({
    blockAtOrAfter: async (ts) => (ts <= MID_DAY ? 40n : 100n),
    blockTimestamp: async (b) => (b === 40n ? MID_DAY : b === 41n ? NOON + 5_400 : 1_791_680_000),
    settlementLogs: async (from, to) => (from === 40n && to === 99n ? logs : []),
  });

async function stampBaseline(db: AnyDb, iso: string): Promise<void> {
  await db.insert(jobState).values({ key: BASELINE_KEY, value: iso }).onConflictDoNothing();
}

async function seedSettled(
  db: AnyDb,
  grossAusd: number,
  settledAtIso: string,
  purchaseRef: string = REF,
): Promise<void> {
  await db.insert(purchases).values({
    channelId: 1,
    isaId: 3,
    purchaseRef,
    grossAusd,
    status: "SETTLED",
    millSig: { salt: HASH, v: 27, r: HASH, s: HASH },
    settledAt: new Date(settledAtIso),
  });
}

async function verdictRows(db: AnyDb) {
  return db.select().from(reconDaily).where(eq(reconDaily.day, DAY));
}

describe("recon (T032)", () => {
  it("a clean day with matching sides → ok, one row, exit 0", async () => {
    const db = await makeTestDb();
    await stampBaseline(db, "2026-10-09T00:00:00Z");
    await seedSettled(db, 1_500_000_000, "2026-10-10T08:59:11Z");

    const result = await runRecon(db, dayChain([logAt(40n, MID_DAY, 1_500_000_000)]), DAY);

    expect(result).toEqual({
      day: DAY,
      backendTotal: 1_500_000_000,
      chainTotal: 1_500_000_000,
      status: "ok",
    });
    expect(await verdictRows(db)).toEqual([
      { day: DAY, backendTotal: 1_500_000_000, chainTotal: 1_500_000_000, status: "ok" },
    ]);
    expect(RECON_EXIT.ok).toBe(0);
  });

  it("a day with no settlements at all → ok with both totals 0", async () => {
    const db = await makeTestDb();
    await stampBaseline(db, "2026-10-09T00:00:00Z");

    const result = await runRecon(db, dayChain([]), DAY);

    expect(result).toEqual({ day: DAY, backendTotal: 0, chainTotal: 0, status: "ok" });
  });

  it("injected backend money → mismatch row with BOTH totals, nothing repaired (FR-020)", async () => {
    const db = await makeTestDb();
    await stampBaseline(db, "2026-10-09T00:00:00Z");
    await seedSettled(db, 500_000_000, "2026-10-10T08:59:11Z"); // no chain log backs it

    const result = await runRecon(db, dayChain([]), DAY);

    expect(result).toEqual({
      day: DAY,
      backendTotal: 500_000_000,
      chainTotal: 0,
      status: "mismatch",
    });
    expect(await verdictRows(db)).toEqual([
      { day: DAY, backendTotal: 500_000_000, chainTotal: 0, status: "mismatch" },
    ]);
    // the injected purchase is untouched — recon never repairs (FR-021)
    const injected = await db.select().from(purchases).where(eq(purchases.grossAusd, 500_000_000));
    expect(injected.length).toBe(1);
    expect(RECON_EXIT.mismatch).toBe(1);
  });

  it("chain settlements BEFORE the baseline stay out of the chain side (D15)", async () => {
    const db = await makeTestDb();
    await stampBaseline(db, "2026-10-10T12:00:00Z"); // baseline INSIDE the day
    await seedSettled(db, 100_000_000, "2026-10-10T13:30:00Z");

    // block 40 settled 08:59 (pre-baseline) — excluded despite being in the day
    const result = await runRecon(
      db,
      dayChain([logAt(40n, MID_DAY, 1_500_000_000), logAt(41n, MID_DAY + 1_800, 100_000_000)]),
      DAY,
    );

    expect(result.chainTotal).toBe(100_000_000); // only the post-baseline log
    expect(result.status).toBe("ok");
  });

  it("the day is half-open: start included, end excluded, both sides", async () => {
    const db = await makeTestDb();
    await stampBaseline(db, "2026-10-01T00:00:00Z");
    await seedSettled(db, 100_000_000, "2026-10-10T00:00:00Z"); // exactly at start — IN
    await seedSettled(db, 200_000_000, "2026-10-11T00:00:00Z", `0x${"22".repeat(32)}`); // at end — OUT

    const boundary = logAt(40n, MID_DAY, 300_000_000);
    const atDayEnd = { ...logAt(41n, DAY_END, 400_000_000) }; // block ts == end — OUT
    const chain = fakeChain({
      blockAtOrAfter: async (ts) => (ts <= MID_DAY ? 40n : 100n),
      blockTimestamp: async (b) => (b === 40n ? MID_DAY : b === 41n ? DAY_END : 1_791_680_000),
      settlementLogs: async (from, to) => (from === 40n && to === 99n ? [boundary, atDayEnd] : []),
    });

    const result = await runRecon(db, chain, DAY);

    expect(result.backendTotal).toBe(100_000_000);
    expect(result.chainTotal).toBe(300_000_000);
    expect(result.status).toBe("mismatch");
  });

  it("an infra failure throws and writes NO verdict row (exit 2 semantics)", async () => {
    const db = await makeTestDb();
    await stampBaseline(db, "2026-10-09T00:00:00Z");
    await seedSettled(db, 100_000_000, "2026-10-10T08:59:11Z");
    const deadRpc = fakeChain({
      settlementLogs: async () => {
        throw new Error("connection refused");
      },
    });

    expect(runRecon(db, deadRpc, DAY)).rejects.toThrow("connection refused");
    expect(await verdictRows(db)).toEqual([]); // no verdict without evidence
    expect(RECON_EXIT.infra).toBe(2);
  });

  it("a missing baseline is infra, not a verdict (db:push stamps it)", async () => {
    const db = await makeTestDb();

    expect(runRecon(db, dayChain([]), DAY)).rejects.toBeInstanceOf(KiteError);
    expect(await verdictRows(db)).toEqual([]);
  });
});

describe("recon day arithmetic", () => {
  it("dayBounds pins the UTC half-open day", () => {
    expect(dayBounds(DAY)).toEqual({ startSec: DAY_START, endSec: DAY_END });
  });

  it("parseDayArg: override passes through, junk is bad_request, default is yesterday UTC", () => {
    expect(parseDayArg(DAY)).toBe(DAY);
    expect(() => parseDayArg("not-a-day")).toThrow(KiteError);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(parseDayArg()).toBe(yesterday);
  });
});
