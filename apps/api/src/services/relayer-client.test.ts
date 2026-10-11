// T014 — the client's wire behavior over an injected transport: INTERNAL key
// on every call, 202/200 → created flag, retry-once on transport failure,
// relayer answers (even 5xx) are final, and every failure is the neutral
// relayer_unreachable code.
import { describe, expect, it } from "bun:test";
import { KiteError } from "@kite/core";
import { jobClientRef, makeRelayerClient } from "./relayer-client.js";

interface Call {
  url: string;
  init: RequestInit;
}

const KEY = "test-internal-key";
const INPUT = {
  kind: "bind_identity",
  payload: { wallet: "0xabc", identityHash: `0x${"11".repeat(32)}` },
  clientRef: "bind-0xabc",
};

function fetchJson(status: number, body: unknown, calls: Call[]) {
  return (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("relayer-client (T014)", () => {
  it("202 → created:true; 200 (same clientRef) → created:false; key + body on the wire", async () => {
    const calls: Call[] = [];
    const client = makeRelayerClient(
      "http://relayer:3001/",
      KEY,
      fetchJson(202, { jobId: 7 }, calls),
    );
    const first = await client.enqueue(INPUT);
    expect(first).toEqual({ jobId: 7, created: true });
    const call = calls[0];
    if (!call) throw new Error("no call captured");
    expect(call.url).toBe("http://relayer:3001/api/jobs");
    expect((call.init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    expect(JSON.parse(String(call.init.body))).toEqual(INPUT);

    const again = makeRelayerClient(
      "http://relayer:3001",
      KEY,
      fetchJson(200, { jobId: 7 }, calls),
    );
    expect(await again.enqueue(INPUT)).toEqual({ jobId: 7, created: false });
  });

  it("deterministic clientRefs: <kind>-<lowercased wallet>", () => {
    expect(jobClientRef("bind", "0xDbAc9A1F342a1b5Fb2956e58E6528ca0F8C44aAD")).toBe(
      "bind-0xdbac9a1f342a1b5fb2956e58e6528ca0f8c44aad",
    );
    expect(jobClientRef("drip", "0xABC")).toBe("drip-0xabc");
  });

  it("retries exactly once on transport failure, then succeeds", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError("down");
      }
      return new Response(JSON.stringify({ jobId: 3 }), { status: 202 });
    }) as unknown as typeof fetch;
    const client = makeRelayerClient("http://relayer:3001", KEY, flaky);
    expect(await client.enqueue(INPUT)).toEqual({ jobId: 3, created: true });
    expect(calls).toBe(2);
  });

  it("two transport failures → KiteError relayer_unreachable", async () => {
    let calls = 0;
    const down = (async () => {
      calls += 1;
      throw new TypeError("down");
    }) as unknown as typeof fetch;
    const client = makeRelayerClient("http://relayer:3001", KEY, down);
    try {
      await client.enqueue(INPUT);
      throw new Error("must have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KiteError);
      expect((err as KiteError).code).toBe("relayer_unreachable");
    }
    expect(calls).toBe(2);
  });

  it("a relayer that ANSWERS is final — 500 does not retry, surfaces unreachable", async () => {
    const calls: Call[] = [];
    const client = makeRelayerClient(
      "http://relayer:3001",
      KEY,
      fetchJson(500, { error: { code: "daily_cap_exceeded", message: "cap" } }, calls),
    );
    try {
      await client.enqueue(INPUT);
      throw new Error("must have thrown");
    } catch (err) {
      expect((err as KiteError).code).toBe("relayer_unreachable");
    }
    expect(calls.length).toBe(1);
  });
});
