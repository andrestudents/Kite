// The profile load seam: a COMPLETE response becomes a populated model; an
// empty body, a rejecting fetch, a float, or a fetch that NEVER settles all
// THROW — the screen's error face, never an endless "Sebentar ya…".
// Fixture numbers are TEST INPUTS (FR-022) — never screen literals.
import { describe, expect, it } from "bun:test";
import { loadProfileModel, PROFILE_LOAD_TIMEOUT_MS } from "./profile-load.js";

const NOW = () => 1_795_000_000_000;

/** A complete /api/p/:id body — two deals, one open request, one panen row. */
const COMPLETE = {
  id: "budi-hash",
  wallet: "0xDbAc9A1F342a1b5Fb2956e58E6528ca0F8C44aAD",
  reputation: { score: 58, completedDeals: 2, qualEvents: 11 },
  deals: [
    {
      isaId: 7,
      principalAusd: 300_000_000,
      shareBps: 1536,
      capAusd: 390_000_000,
      totalDivertedAusd: 390_000_000,
      status: "completed_capped",
      events: [
        {
          grossAusd: 200_000_000,
          toBackerAusd: 30_720_000,
          toSeekerAusd: 169_280_000,
          remainingAusd: 0,
          txHash: `0x${"aa".repeat(32)}`,
          blockTime: "2026-10-01T02:00:00.000Z",
        },
      ],
    },
    {
      isaId: 9,
      principalAusd: 400_000_000,
      shareBps: 1536,
      capAusd: 520_000_000,
      totalDivertedAusd: 130_000_000,
      status: "drafted",
      events: [],
    },
  ],
  explorerBaseUrl: "https://testnet.monadscan.com",
};

function apiResolving(dto: unknown): { profile(id: string): Promise<unknown> } {
  return { profile: () => Promise.resolve(dto) };
}

describe("loadProfileModel (device gate: loading is a phase, not a destination)", () => {
  it("a complete response → populated model: stars, the open request, history", async () => {
    const model = await loadProfileModel(apiResolving(COMPLETE), "budi-hash", 1_000, NOW);
    expect(model.stars).toBe(3); // round(58/20)
    expect(model.openRequest?.isaId).toBe(9);
    expect(model.openRequest?.status).toBe(1);
    expect(model.completedDeals).toBe(2);
    expect(model.deals).toHaveLength(2);
    expect(model.deals[0]?.panen?.[0]?.grossAusd).toBe(200_000_000n);
  });

  it("a fetch that NEVER settles → throws at the timeout (no infinite waiting)", async () => {
    const hanging = { profile: () => new Promise(() => {}) };
    await expect(loadProfileModel(hanging, "budi-hash", 10, NOW)).rejects.toThrow(/timed out/);
  });

  it("an EMPTY body (null / non-object) → throws, mapped to the error face", async () => {
    await expect(loadProfileModel(apiResolving(null), "budi-hash", 1_000, NOW)).rejects.toThrow(
      /empty profile/,
    );
    await expect(loadProfileModel(apiResolving("nope"), "budi-hash", 1_000, NOW)).rejects.toThrow(
      /empty profile/,
    );
  });

  it("a rejecting fetch propagates — the screen shows retry, not waiting", async () => {
    const failing = { profile: () => Promise.reject(new Error("offline")) };
    await expect(loadProfileModel(failing, "budi-hash", 1_000, NOW)).rejects.toThrow(/offline/);
  });

  it("a float where money must be integral refuses to assemble (constitution VI)", async () => {
    const broken = structuredClone(COMPLETE);
    const d0 = broken.deals[0];
    if (!d0) throw new Error("fixture");
    broken.deals[0] = { ...d0, principalAusd: 300.5 };
    await expect(loadProfileModel(apiResolving(broken), "budi-hash", 1_000, NOW)).rejects.toThrow(
      /integral base-unit/,
    );
  });

  it("the shipped default timeout stays humane — seconds, not minutes", () => {
    expect(PROFILE_LOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(PROFILE_LOAD_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
