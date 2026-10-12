// T020 tests — the delivery rule, the two feeds, and the visibility cadence.
// All fixtures are TEST INPUTS (FR-022); the injected clock keeps the loop
// deterministic (nothing schedules real timers here — tests drive pollOnce).
import { describe, expect, it } from "bun:test";
import type { StorageLike } from "../auth/session.js";
import type { BackedRecord } from "../data/backed.js";
import type { ApiClient, MeDto } from "../data/bootstrap.js";
import type { ChainReader, HexAddress, IsaOnChain } from "../data/draft.js";
import {
  DEFAULT_POLL_MS,
  diffWatermark,
  startWatcher,
  type WatchEvent,
  type WatcherClock,
  watermarkFromIsa,
  watermarkFromMe,
} from "./watcher.js";

const BACKER: HexAddress = `0x${"b2".repeat(20)}`;
const SEEKER: HexAddress = `0x${"a1".repeat(20)}`;

// ── fixtures ────────────────────────────────────────────────────────────────

function meFixture(over: {
  progressBps?: number;
  remainingAusd?: number;
  settledRows?: number;
  withIsa?: boolean;
}): MeDto {
  const rows = Array.from({ length: over.settledRows ?? 2 }, (_, i) => ({
    purchaseRef: `pur-${String(i)}`,
    status: "settled",
    settledAt: `2026-10-0${(i % 9) + 1}T00:00:00Z`,
  }));
  return {
    wallet: SEEKER,
    balanceAusd: 1_000_000,
    identityBound: true,
    profile: {
      score: 58,
      maxSupportAusd: 624_000_000,
      totalIsas: 1,
      completed: 0,
      qualEvents: 3,
      distinctBackers: 1,
    },
    activeIsa:
      over.withIsa === false
        ? null
        : {
            isaId: 9,
            backer: BACKER,
            principalAusd: 10_000_000,
            shareBps: 1536,
            capMult: 130,
            capAusd: 13_000_000,
            remainingAusd: over.remainingAusd ?? 6_500_000,
            progressBps: over.progressBps ?? 5000,
            termEnd: 1_900_000_000,
            channelId: 1,
          },
    recentPurchases: rows,
  };
}

function isaFixture(over: Partial<IsaOnChain>): IsaOnChain {
  return {
    isaId: 9n,
    principal: 10_000_000n,
    shareBps: 1536,
    capMult: 130,
    termEnd: 1_900_000_000n,
    channelId: 1n,
    seeker: SEEKER,
    backer: BACKER,
    remaining: 13_000_000n,
    activatedAt: 1_700_000_000n,
    lastEventAt: 1_700_000_000n,
    eventCount: 0n,
    status: 2,
    ...over,
  };
}

function makeReader(isas: IsaOnChain[], balance = 100n): ChainReader {
  return {
    async offerOf() {
      return 0n;
    },
    async isaOf(isaId) {
      const hit = isas.find((i) => i.isaId === isaId);
      if (!hit) throw new Error("unknown to the fixture");
      return hit;
    },
    async profileOf() {
      return { totalIsas: 1, completed: 0, qualEvents: 3, distinctBackers: 1 };
    },
    async balanceAusd() {
      return balance;
    },
    async scoreOf() {
      return 58;
    },
    async channelOf() {
      return { name: "mill", pubkey: `0x${"11".repeat(32)}`, active: true };
    },
    async ausdNonces() {
      return 0n;
    },
  };
}

function memStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** The loop never self-runs: schedule only records. Tests drive pollOnce. */
function makeClock(): WatcherClock & { scheduled: number[] } {
  const scheduled: number[] = [];
  return {
    now: () => 0,
    schedule(_fn, ms) {
      scheduled.push(ms);
      return () => {};
    },
    scheduled,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** A watcher over a MUTABLE fixture holder — tests flip state between passes. */
function watcherFor(opts: {
  me: MeDto;
  isas?: IsaOnChain[];
  balance?: bigint;
  records?: BackedRecord[];
  visible?: () => boolean;
  pollMs?: number;
}): {
  events: WatchEvent[];
  handle: ReturnType<typeof startWatcher>;
  clock: ReturnType<typeof makeClock>;
  api: { current: MeDto };
  chain: { isas: IsaOnChain[]; balance: bigint };
} {
  const storage = memStorage();
  if (opts.records) {
    storage.setItem(
      "kite.v1.snapshots.backedList",
      JSON.stringify({ model: opts.records, fetchedAt: 1 }),
    );
  }
  const api = { current: opts.me };
  const chain = { isas: opts.isas ?? [], balance: opts.balance ?? 100n };
  const events: WatchEvent[] = [];
  const clock = makeClock();
  const handle = startWatcher({
    api: { me: async () => api.current } as unknown as ApiClient,
    reader: {
      ...makeReader(chain.isas, chain.balance),
      async isaOf(isaId) {
        const hit = chain.isas.find((i) => i.isaId === isaId);
        if (!hit) throw new Error("unknown to the fixture");
        return hit;
      },
      async balanceAusd() {
        return chain.balance;
      },
    } as ChainReader,
    storage,
    backerAddress: opts.isas && opts.isas.length > 0 ? BACKER : undefined,
    onEvent: (e) => events.push(e),
    clock,
    visible: opts.visible ?? (() => true),
    pollMs: opts.pollMs,
  });
  return { events, handle, clock, api, chain };
}

describe("pure watermark math (T020)", () => {
  it("first sight baselines; jumps fire once with the full count", () => {
    expect(diffWatermark(undefined, { progressBps: 5000, settledCount: 2, blockTime: "" })).toEqual(
      {
        fires: false,
        deltaCount: 0,
      },
    );
    expect(
      diffWatermark(
        { progressBps: 5000, settledCount: 2, blockTime: "" },
        { progressBps: 6500, settledCount: 3, blockTime: "t" },
      ),
    ).toEqual({ fires: true, deltaCount: 1 });
    // two settlements in one gap = ONE event carrying the jump, never stacked
    expect(
      diffWatermark(
        { progressBps: 5000, settledCount: 2, blockTime: "" },
        { progressBps: 9000, settledCount: 4, blockTime: "t" },
      ).deltaCount,
    ).toBe(2);
    // a progress-only correction still notices
    expect(
      diffWatermark(
        { progressBps: 5000, settledCount: 2, blockTime: "" },
        { progressBps: 5100, settledCount: 2, blockTime: "" },
      ).fires,
    ).toBe(true);
  });

  it("the seeker watermark reads /api/me; the backer watermark reads the chain", () => {
    const w = watermarkFromMe(meFixture({ progressBps: 5000, settledRows: 3 }));
    expect(w === null ? null : w[0]).toBe(9);
    expect(w === null ? null : w[1]).toEqual({
      progressBps: 5000,
      settledCount: 3,
      blockTime: "2026-10-03T00:00:00Z",
      side: "seeker",
    });
    expect(watermarkFromMe(meFixture({ withIsa: false }))).toBe(null);
    // 3 of the 13 cap diverted → 7692 bps; eventCount is the contract's count
    expect(watermarkFromIsa(isaFixture({ remaining: 3_000_000n, eventCount: 3n }))).toEqual({
      progressBps: 7692,
      settledCount: 3,
      blockTime: new Date(1_700_000_000 * 1000).toISOString(),
      status: 2,
      side: "backer",
    });
  });
});

describe("the watcher feeds (T020)", () => {
  it("the start pass baselines silently; a jump then fires exactly ONE split", async () => {
    const w = watcherFor({ me: meFixture({ progressBps: 5000, settledRows: 2 }) });
    await settle();
    expect(w.events).toEqual([]);
    w.api.current = meFixture({ progressBps: 6500, settledRows: 3 });
    await w.handle.pollOnce();
    expect(w.events).toHaveLength(1);
    const e = w.events[0];
    expect(e !== undefined && e.kind === "split" ? e.side : null).toBe("seeker");
    expect(w.events.every((x) => x.kind !== "split" || x.deltaCount === 1)).toBe(true);
    const split = w.events.find((x) => x.kind === "split");
    if (split !== undefined && split.kind === "split") {
      expect(split.progressBeforeBps).toBe(5000);
      expect(split.progressAfterBps).toBe(6500);
    }
    w.handle.stop();
  });

  it("two settlements missed while hidden = ONE summary-grade event", async () => {
    const w = watcherFor({ me: meFixture({ progressBps: 5000, settledRows: 2 }) });
    await settle();
    w.api.current = meFixture({ progressBps: 9000, settledRows: 4 });
    await w.handle.pollOnce();
    expect(w.events).toHaveLength(1);
    expect(w.events[0]?.kind === "split" ? w.events[0].deltaCount : 0).toBe(2);
    w.handle.stop();
  });

  it("the deal leaving /api/me completes the seeker's side exactly once", async () => {
    const w = watcherFor({ me: meFixture({ progressBps: 10_000, settledRows: 5 }) });
    await settle();
    w.api.current = meFixture({ withIsa: false });
    await w.handle.pollOnce();
    expect(w.events).toEqual([{ kind: "completed", side: "seeker", isaId: 9, variant: "capped" }]);
    await w.handle.pollOnce(); // the watermark is gone — never re-fires
    expect(w.events).toHaveLength(1);
    w.handle.stop();
  });

  it("the backer feed notices the chain's own panen count", async () => {
    const w = watcherFor({
      me: meFixture({ withIsa: false }),
      isas: [isaFixture({ eventCount: 1n, remaining: 11_000_000n })],
      records: [{ seeker: SEEKER, isaId: 9, activatedAt: 3 }],
    });
    await settle();
    expect(w.events).toEqual([]);
    w.chain.isas = [isaFixture({ eventCount: 2n, remaining: 9_500_000n })];
    await w.handle.pollOnce();
    expect(w.events).toHaveLength(1);
    expect(w.events[0]?.kind === "split" ? w.events[0].side : null).toBe("backer");
    w.handle.stop();
  });

  it("a live → terminal transition fires the split AND the completion once", async () => {
    const w = watcherFor({
      me: meFixture({ withIsa: false }),
      isas: [isaFixture({ eventCount: 3n, remaining: 1_000_000n })],
      records: [{ seeker: SEEKER, isaId: 9, activatedAt: 3 }],
    });
    await settle();
    w.chain.isas = [isaFixture({ eventCount: 4n, remaining: 0n, status: 3 })];
    await w.handle.pollOnce();
    expect(w.events).toEqual([
      {
        kind: "split",
        side: "backer",
        isaId: 9,
        deltaCount: 1,
        progressBeforeBps: 9230,
        progressAfterBps: 10000,
      },
      { kind: "completed", side: "backer", isaId: 9, variant: "capped" },
    ]);
    await w.handle.pollOnce(); // terminal state is stable — never re-fires
    expect(w.events).toHaveLength(2);
    w.handle.stop();
  });

  it("first sight of an already-terminal deal baselines silently", async () => {
    const w = watcherFor({
      me: meFixture({ withIsa: false }),
      isas: [isaFixture({ eventCount: 4n, remaining: 0n, status: 3 })],
      records: [{ seeker: SEEKER, isaId: 9, activatedAt: 3 }],
    });
    await settle();
    expect(w.events).toEqual([]);
    w.handle.stop();
  });

  it("the backer's wallet delta rides the first split of the pass", async () => {
    const w = watcherFor({
      me: meFixture({ withIsa: false }),
      isas: [isaFixture({ eventCount: 1n, remaining: 11_000_000n })],
      balance: 100n,
      records: [{ seeker: SEEKER, isaId: 9, activatedAt: 3 }],
    });
    await settle();
    w.chain.balance = 160n;
    w.chain.isas = [isaFixture({ eventCount: 2n, remaining: 9_500_000n })];
    await w.handle.pollOnce();
    const split = w.events.find((x) => x.kind === "split");
    expect(split !== undefined && split.kind === "split" ? split.balanceDeltaAusd : null).toBe(60n);
    w.handle.stop();
  });

  it("cadence honors the ≤1.5s budget; a hidden tab never schedules", async () => {
    const w = watcherFor({ me: meFixture({}) });
    await settle();
    expect(w.clock.scheduled).toEqual([DEFAULT_POLL_MS]);
    w.handle.stop();

    const w2 = watcherFor({ me: meFixture({}), pollMs: 400 });
    await settle();
    expect(w2.clock.scheduled).toEqual([400]);
    w2.handle.stop();

    const w3 = watcherFor({ me: meFixture({}), visible: () => false });
    await settle();
    expect(w3.clock.scheduled).toEqual([]); // paused while hidden
    w3.handle.stop();
  });
});
