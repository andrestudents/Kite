// T019 — chunk discipline: the public Monad RPC caps eth_getLogs at 100
// blocks per call, so EVERY getLogs caller sizes spans from KITE_GETLOGS_CHUNK
// and the adaptive walker degrades a wrong cap to slow-but-correct instead of
// failing the pass (the 50k watcher ranges the public RPC rejects are exactly
// that wall — the checkpoint could never catch up through it).
import { afterEach, describe, expect, it } from "bun:test";
import { getLogsChunk, isRangeLimitError, scanLogsAdaptive } from "./chain.js";

const rangeCap = (): Error => new Error("block range too large");

describe("getLogs chunk discipline (T019)", () => {
  afterEach(() => {
    delete process.env.KITE_GETLOGS_CHUNK;
  });

  it("getLogsChunk defaults to the public RPC's 100-block cap", () => {
    expect(getLogsChunk()).toBe(100n);
  });

  it("operators raise the cap via KITE_GETLOGS_CHUNK; garbage falls back to 100", () => {
    process.env.KITE_GETLOGS_CHUNK = "9000";
    expect(getLogsChunk()).toBe(9000n);
    process.env.KITE_GETLOGS_CHUNK = "not-a-number";
    expect(getLogsChunk()).toBe(100n);
    process.env.KITE_GETLOGS_CHUNK = "0";
    expect(getLogsChunk()).toBe(100n);
  });

  it("isRangeLimitError matches provider range/result caps, not everything", () => {
    expect(isRangeLimitError(rangeCap())).toBe(true);
    expect(isRangeLimitError(new Error("query returned more than 10000 results"))).toBe(true);
    expect(isRangeLimitError(new Error("execution reverted"))).toBe(false);
    expect(isRangeLimitError("not even an error")).toBe(false);
  });

  it("scanLogsAdaptive halves on a range cap and still returns EVERY span's logs", async () => {
    const spans: string[] = [];
    const result = await scanLogsAdaptive({
      from: 1n,
      to: 10n,
      label: "test",
      fetch: async (f, t) => {
        spans.push(`${f}-${t}`);
        if (t - f + 1n > 4n) throw rangeCap();
        return [`${f}..${t}`];
      },
    });
    // Optimistic full-span try, one halve past the cap, then clean 2-block
    // walks: no block fetched twice, none skipped.
    expect(result).toEqual(["1..2", "3..4", "5..6", "7..8", "9..10"]);
    expect(spans[0]).toBe("1-10");
    expect(spans[1]).toBe("1-5");
    expect(spans[2]).toBe("1-2");
  });

  it("an always-capped fetch walks down to single blocks before rethrowing", async () => {
    const spans: string[] = [];
    const result = await scanLogsAdaptive({
      from: 5n,
      to: 6n,
      label: "test",
      fetch: async (f, t) => {
        spans.push(`${f}-${t}`);
        if (t - f + 1n > 1n) throw rangeCap();
        return [Number(f)];
      },
    });
    expect(result).toEqual([5, 6]);
    expect(spans).toEqual(["5-6", "5-5", "6-6"]);
  });

  it("a fetch that fails even at one block propagates — no infinite halve", async () => {
    const always = async () => {
      throw rangeCap();
    };
    expect(scanLogsAdaptive({ from: 1n, to: 4n, label: "test", fetch: always })).rejects.toThrow(
      "block range too large",
    );
  });
});
