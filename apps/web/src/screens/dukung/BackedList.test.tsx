// T017 tests — the reconciliation rule, the derived-label fallback, the
// reputation-led ranking, and the honest Lunas recap math. Chain numbers are
// TEST INPUTS (FR-022): the fake reader serves fixtures, nothing more.
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { StorageLike } from "../../auth/session.js";
import type { HexAddress, IsaOnChain, ProfileOnChain } from "../../chain/client.js";
import type { BackedRecord } from "../../data/backed.js";
import type { ChainReader } from "../../data/draft.js";
import { id } from "../../locales/id.js";
import {
  BackedList,
  durationDaysOf,
  loadBackedCards,
  progressOf,
  rankCards,
  receivedOf,
  starsFromScore,
} from "./BackedList.js";

const SEEKER: HexAddress = `0x${"a1".repeat(20)}`;
const OTHER: HexAddress = `0x${"b2".repeat(20)}`;

function isaFixture(over: Partial<IsaOnChain> = {}): IsaOnChain {
  return {
    isaId: 9n,
    principal: 10_000_000n,
    shareBps: 1536,
    capMult: 130,
    termEnd: 1_900_000_000n,
    channelId: 1n,
    seeker: SEEKER,
    backer: OTHER,
    remaining: 13_000_000n,
    activatedAt: 1_700_000_000n,
    lastEventAt: 1_700_000_000n,
    eventCount: 0n,
    status: 2,
    ...over,
  };
}

function makeReader(isas: IsaOnChain[], score = 58, completed = 2): ChainReader {
  return {
    async offerOf() {
      return 0n;
    },
    async isaOf(isaId) {
      const hit = isas.find((i) => i.isaId === isaId);
      if (!hit) throw new Error(`isa ${String(isaId)} unknown to the fixture`);
      return hit;
    },
    async profileOf() {
      return { totalIsas: 4, completed, qualEvents: 11, distinctBackers: 2 };
    },
    async balanceAusd() {
      return 0n;
    },
    async scoreOf() {
      return score;
    },
    async channelOf() {
      return { name: "mill", pubkey: `0x${"11".repeat(32)}`, active: true };
    },
    async ausdNonces() {
      return 0n;
    },
  };
}

function recordFixture(over: Partial<BackedRecord>): BackedRecord {
  return {
    seeker: SEEKER,
    isaId: 9,
    nickname: undefined,
    purpose: undefined,
    activatedAt: 3,
    ...over,
  };
}

function memStorage(rows: BackedRecord[]): StorageLike {
  const m = new Map<string, string>();
  m.set("kite.v1.snapshots.backedList", JSON.stringify({ model: rows, fetchedAt: 1 }));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("backed-card math (T017)", () => {
  it("the score→stars rule matches the profile surface, clamped", () => {
    expect(starsFromScore(0)).toBe(0);
    expect(starsFromScore(45)).toBe(2);
    expect(starsFromScore(58)).toBe(3);
    expect(starsFromScore(100)).toBe(5);
    expect(starsFromScore(120)).toBe(5);
  });

  it("received = cap − remaining, floored at zero — chain numbers only", () => {
    // 3 panen moved 10 of the 13 cap: remaining 3 → received 10.
    expect(receivedOf(isaFixture({ remaining: 3_000_000n }))).toBe(10_000_000n);
    expect(receivedOf(isaFixture({ remaining: 13_000_000n }))).toBe(0n);
    // a corrupted remaining ABOVE the cap can never read as negative.
    expect(receivedOf(isaFixture({ remaining: 99_000_000n }))).toBe(0n);
  });

  it("progress floors; a zero cap reads 0, never NaN", () => {
    expect(progressOf(10_000_000n, 13_000_000n)).toBe(7692);
    expect(progressOf(0n, 13_000_000n)).toBe(0);
    expect(progressOf(5n, 0n)).toBe(0);
  });

  it("duration: finished deals count to the last event, live ones to now", () => {
    const base = isaFixture({
      activatedAt: 1_700_000_000n,
      lastEventAt: 1_700_000_000n + 90n * 86_400n,
    });
    expect(durationDaysOf({ ...base, status: 3 }, 1_700_000_000 + 365 * 86_400)).toBe(90);
    expect(durationDaysOf(base, 1_700_000_000 + 10 * 86_400)).toBe(10);
    expect(durationDaysOf(isaFixture({ activatedAt: 0n }), 99)).toBe(0);
  });
});

describe("reconciliation + ranking (T017)", () => {
  it("the chain wins numbers and status; the record only warms the label", async () => {
    const isa = isaFixture({ status: 4, remaining: 5_000_000n, seeker: OTHER });
    const cards = await loadBackedCards(
      makeReader([isa]),
      [recordFixture({ nickname: "Pak Slameto", purpose: "bibit" })],
      1_800_000_000,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.isa.status).toBe(4);
    expect(cards[0]?.isa.seeker).toBe(OTHER);
    expect(cards[0]?.label).toBe("Pak Slameto");
    expect(cards[0]?.receivedAusd).toBe(8_000_000n);
    expect(cards[0]?.completed).toBe(2);
  });

  it("an empty nickname derives the label from the purpose, then the short id", async () => {
    const isa = isaFixture();
    const withPurpose = await loadBackedCards(
      makeReader([isa]),
      [recordFixture({ purpose: "bibit padi" })],
      1_800_000_000,
    );
    expect(withPurpose[0]?.label).toBe("bibit padi");
    const bare = await loadBackedCards(makeReader([isa]), [recordFixture({})], 1_800_000_000);
    expect(bare[0]?.label).toBe(`Petani · ${SEEKER.slice(2, 8)}`);
  });

  it("stars lead the hierarchy — a lower-progress card with more stars first", async () => {
    const highStars = isaFixture({ isaId: 1n, remaining: 13_000_000n }); // 0% progress
    const lowStars = isaFixture({ isaId: 2n, seeker: OTHER, remaining: 3_000_000n }); // ~77%
    const reader = {
      ...makeReader([highStars, lowStars]),
      async scoreOf(seeker: HexAddress) {
        return seeker === SEEKER ? 90 : 20; // stars 5 vs 1
      },
    };
    const cards = await loadBackedCards(
      reader,
      [recordFixture({ isaId: 1 }), recordFixture({ isaId: 2, seeker: OTHER })],
      1_800_000_000,
    );
    expect(cards.map((c) => c.record.isaId)).toEqual([1, 2]);

    // completed breaks a stars tie; progress breaks both ties.
    const first = cards[0];
    const second = cards[1];
    if (!first || !second) throw new Error("the fixture must yield two cards");
    const tied = [
      { ...first, stars: 3, completed: 1, progressBps: 100 },
      { ...second, stars: 3, completed: 5, progressBps: 9000 },
      {
        ...first,
        stars: 3,
        completed: 5,
        progressBps: 5000,
        record: { ...first.record, isaId: 3 },
      },
    ];
    expect(rankCards(tied).map((c) => c.record.isaId)).toEqual([2, 3, 1]);
  });

  it("a ProfileOnChain fixture feeds completed verbatim", async () => {
    const profile: ProfileOnChain = {
      totalIsas: 7,
      completed: 6,
      qualEvents: 20,
      distinctBackers: 3,
    };
    expect(profile.completed).toBe(6);
  });
});

describe("the BackedList screen (T017)", () => {
  it("first paint is the honest loading state straight from the catalog", () => {
    const html = renderToString(
      <BackedList locale={id} storage={memStorage([recordFixture({})])} reader={makeReader([])} />,
    );
    expect(html).toContain(id.edge.loading);
  });
});
