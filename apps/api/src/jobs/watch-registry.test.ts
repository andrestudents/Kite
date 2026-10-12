// T019 — the registry watcher's proof: a DRAFTED ISA reaches the isas cache
// (the share link's whole subject — without this /api/p answers deals:[] and
// the [Dukung] CTA has nothing to render), an activation flips the cached
// status, passes are idempotent, and status None is never a deal row.
import { beforeEach, describe, expect, it } from "bun:test";
import { isas, jobState } from "@kite/core/db";
import { makeTestDb, type TestDb } from "@kite/core/testing";
import { eq } from "drizzle-orm";
import type { ChainClient, IsaOnchain } from "../services/chain.js";
import { fakeChain, ZERO_ADDRESS } from "../services/fake-chain.js";
import { processNewRegistryLogs, REGISTRY_BLOCK_KEY } from "./watch-registry.js";

const SEEKER = `0x${"5c".repeat(20)}` as `0x${string}`;
const BACKER = `0x${"b2".repeat(20)}` as `0x${string}`;

const isaOnchain = (status: number): IsaOnchain => ({
  principal: 500_000_000,
  shareBps: 2_000,
  capMult: 130,
  termEnd: 1_794_270_000,
  channelId: 1,
  seeker: SEEKER,
  backer: BACKER,
  remaining: status === 1 ? 0 : 500_000_000,
  activatedAt: status === 1 ? 0 : 1_791_580_100,
  lastEventAt: 1_791_580_800,
  eventCount: status === 1 ? 0 : 1,
  status,
});

/** Chain surface with ISA event id 4 in ONE observable range [10, 100]. */
function chainWithDraft(
  isa: (isaId: number) => Promise<IsaOnchain>,
  eventRanges: Array<[bigint, bigint]> = [[10n, 100n]],
  head = 100n,
): ChainClient {
  return fakeChain({
    blockAtOrAfter: async () => 10n,
    blockNumber: async () => head,
    isaEventIds: async (from, to) =>
      eventRanges.some(([a, b]) => from >= a && to <= b) ? [4] : [],
    channelRegisteredIds: async () => [],
    isaOf: isa,
  });
}

describe("processNewRegistryLogs (T019)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  it("a Drafted ISA lands in the cache — the open request exists before activation", async () => {
    let isaOfCalls = 0;
    const result = await processNewRegistryLogs(
      db,
      chainWithDraft(async (id) => {
        expect(id).toBe(4);
        isaOfCalls++;
        return isaOnchain(1);
      }),
    );

    expect(result.isas).toBe(1);
    const rows = await db.select().from(isas).where(eq(isas.isaId, 4));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      seeker: SEEKER,
      backer: BACKER,
      principal: 500_000_000,
      status: "drafted",
    });
    const cp = await db.select().from(jobState).where(eq(jobState.key, REGISTRY_BLOCK_KEY));
    expect(cp[0]?.value).toBe("100");
    expect(isaOfCalls).toBe(1);
  });

  it("a replayed pass is a no-op — the checkpoint ate the range", async () => {
    const chain = chainWithDraft(async () => isaOnchain(1));
    await processNewRegistryLogs(db, chain);
    let isaOfCalls = 0;
    const again = await processNewRegistryLogs(
      db,
      fakeChain({
        blockNumber: async () => 100n,
        isaOf: async () => {
          isaOfCalls++;
          return isaOnchain(1);
        },
      }),
    );
    expect(again.isas).toBe(0);
    expect(isaOfCalls).toBe(0);
  });

  it("an activation flips the cached draft to active — both sides see Active", async () => {
    await processNewRegistryLogs(
      db,
      chainWithDraft(async () => isaOnchain(1)),
    );

    // The activation event arrives in a LATER range; isaOf now states active.
    const result = await processNewRegistryLogs(
      db,
      chainWithDraft(async () => isaOnchain(2), [[100n, 200n]], 200n),
    );
    expect(result.isas).toBe(1);
    const rows = await db.select().from(isas).where(eq(isas.isaId, 4));
    expect(rows[0]?.status).toBe("active");
  });

  it("status None (0) is not a deal row — nothing is cached", async () => {
    const result = await processNewRegistryLogs(
      db,
      chainWithDraft(async () => isaOnchain(0)),
    );
    expect(result.isas).toBe(0);
    const rows = await db.select().from(isas);
    expect(rows).toEqual([]);
  });

  it("channels project alongside isas from the same pass", async () => {
    const chain = fakeChain({
      blockAtOrAfter: async () => 10n,
      blockNumber: async () => 100n,
      isaEventIds: async () => [],
      channelRegisteredIds: async () => [1],
      channelOf: async () => ({ name: "koperasi", pubkey: ZERO_ADDRESS, active: true }),
    });
    await processNewRegistryLogs(db, chain);
    const { channels } = await import("@kite/core/db");
    const rows = await db.select().from(channels).where(eq(channels.id, 1));
    expect(rows[0]).toMatchObject({ name: "koperasi", active: true });
  });

  it("an expired boot deadline walks NOTHING — the port must never be held hostage", async () => {
    let isaOfCalls = 0;
    const result = await processNewRegistryLogs(
      db,
      chainWithDraft(async () => {
        isaOfCalls++;
        return isaOnchain(1);
      }),
      { deadlineMs: Date.now() - 1 }, // already spent
    );
    expect(result.isas).toBe(0);
    expect(isaOfCalls).toBe(0);
    // The checkpoint stayed at its seed — the next pass resumes from there.
    const cp = await db.select().from(jobState).where(eq(jobState.key, REGISTRY_BLOCK_KEY));
    expect(cp[0]?.value).toBe("10");
  });
});
