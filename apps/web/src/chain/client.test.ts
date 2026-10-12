// T006 — the chain reader against FIXTURES (no network): decoding keeps the
// contract's machine status untouched, maps the struct field-for-field, and
// the reader calls the right functions with the right addresses (stub client
// records the calls). Unit tests never dial the public RPC.
import { describe, expect, it } from "bun:test";
import { decodeIsa, decodeProfile, ISA_STATUS, makeChainReader } from "./client.js";

const SEEKER = "0xdbac9a1f342a1b5fb2956e58e6528ca0f8c44aad" as const;
const BACKER = "0x127bd57ea26e6f5eee15efe8b5b495ae539d82ea" as const;

/** A viem-shaped decoded ISA struct (what readContract hands back). */
function isaFixture(status: number) {
  return {
    terms: {
      principal: 480_000_000n,
      shareBps: 1540,
      capMult: 1300,
      termEnd: 1_900_000_000n,
      channelId: 1n,
    },
    seeker: SEEKER,
    backer: BACKER,
    remaining: 295_200_000n,
    activatedAt: 1_790_000_000n,
    lastEventAt: 1_795_000_000n,
    eventCount: 3n,
    status,
  };
}

describe("decodeIsa (T006)", () => {
  it("maps the struct field-for-field; money stays bigint base units", () => {
    const isa = decodeIsa(3n, isaFixture(ISA_STATUS.active));
    expect(isa.isaId).toBe(3n);
    expect(isa.principal).toBe(480_000_000n);
    expect(isa.shareBps).toBe(1540);
    expect(isa.capMult).toBe(1300);
    expect(isa.termEnd).toBe(1_900_000_000n);
    expect(isa.channelId).toBe(1n);
    expect(isa.seeker).toBe(SEEKER);
    expect(isa.backer).toBe(BACKER);
    expect(isa.remaining).toBe(295_200_000n);
    expect(isa.eventCount).toBe(3n);
  });

  it("status passes through as the machine value for every contract state", () => {
    for (const code of [0, 1, 2, 3, 4, 5] as const) {
      expect(decodeIsa(1n, isaFixture(code)).status).toBe(code);
    }
  });

  it("an unknown machine value refuses to decode (data/ never guesses)", () => {
    expect(() => decodeIsa(1n, isaFixture(6))).toThrow(/status machine value/);
    expect(() => decodeIsa(1n, isaFixture(-1))).toThrow(/status machine value/);
  });
});

describe("decodeProfile (T006)", () => {
  it("maps the counts with their contract field names (totalISAs → totalIsas)", () => {
    expect(
      decodeProfile({
        totalISAs: 4n,
        completed: 2n,
        qualEvents: 11n,
        distinctBackers: 2n,
      }),
    ).toEqual({
      totalIsas: 4,
      completed: 2,
      qualEvents: 11,
      distinctBackers: 2,
    });
  });
});

describe("makeChainReader (T006) — wiring against a stub client", () => {
  /** Records readContract calls; answers from fixtures. */
  function stubClient(responses: Record<string, unknown>) {
    const calls: Array<{ functionName: string; args: unknown[] }> = [];
    const client = {
      async readContract(args: { functionName: string; args: unknown[] }) {
        calls.push({ functionName: args.functionName, args: args.args });
        const fixed = responses[args.functionName];
        if (typeof fixed === "function") return (fixed as () => unknown)();
        if (fixed === undefined) throw new Error(`no fixture for ${args.functionName}`);
        return fixed;
      },
    };
    return { client, calls };
  }

  it("offerOf reads the seeker's live cap from KiteCore", async () => {
    const { client, calls } = stubClient({ offerOf: 624_000_000n });
    const reader = makeChainReader(client as never);
    expect(await reader.offerOf(SEEKER)).toBe(624_000_000n);
    expect(calls).toEqual([{ functionName: "offerOf", args: [SEEKER] }]);
  });

  it("isaOf decodes the live deal; profileOf maps counts; balance reads the asset", async () => {
    const { client } = stubClient({
      isaOf: () => isaFixture(ISA_STATUS.completedCapped),
      profileOf: { totalISAs: 4n, completed: 2n, qualEvents: 11n, distinctBackers: 2n },
      balanceOf: 1_200_000_000n,
    });
    const reader = makeChainReader(client as never);
    const isa = await reader.isaOf(3n);
    expect(isa.status).toBe(ISA_STATUS.completedCapped);
    expect(isa.principal).toBe(480_000_000n);
    expect(await reader.profileOf(SEEKER)).toEqual({
      totalIsas: 4,
      completed: 2,
      qualEvents: 11,
      distinctBackers: 2,
    });
    expect(await reader.balanceAusd(BACKER)).toBe(1_200_000_000n);
  });

  it("a malformed address is rejected before any call leaves the app", () => {
    const { client, calls } = stubClient({});
    const reader = makeChainReader(client as never);
    expect(() => reader.offerOf("0xnot-an-address" as never)).toThrow(/valid address/);
    expect(calls).toEqual([]);
  });
});
