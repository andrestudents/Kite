// T013 — the client's wire behavior: session header attachment, integral
// bodies, 401 surfacing + onUnauthorized hook, query encoding. Transport is
// injected; nothing here touches the network.
import { describe, expect, it } from "bun:test";
import { type SessionBlob, type StorageLike, saveSessionBlob } from "../auth/session.js";
import { ApiError, makeApiClient } from "./client.js";

const BLOB: SessionBlob = {
  wallet: "0xDbAc9A1F342a1b5Fb2956e58E6528ca0F8C44aAD",
  until: 1_900_000_000,
  sig: {
    v: 27,
    r: `0x${"ab".repeat(32)}`,
    s: `0x${"cd".repeat(32)}`,
  },
};

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

interface Captured {
  url: string;
  init: RequestInit;
}

function fetchJson(status: number, body: unknown, captured: Captured[]) {
  return (async (url: string | URL, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

/** The single captured request — fails loudly if there were none or many. */
function only(captured: Captured[]): Captured {
  expect(captured.length).toBe(1);
  const call = captured[0];
  if (!call) throw new Error("unreachable");
  return call;
}

function clientWith(
  captured: Captured[],
  status: number,
  body: unknown,
  hooks: { onUnauthorized?: () => void } = {},
) {
  const storage = new MemoryStorage();
  saveSessionBlob(storage, BLOB);
  return makeApiClient({
    baseUrl: "https://api.example.test",
    storage,
    fetchImpl: fetchJson(status, body, captured),
    onUnauthorized: hooks.onUnauthorized,
  });
}

describe("api client (T013)", () => {
  it("me() attaches x-kite-session from the stored blob", async () => {
    const captured: Captured[] = [];
    const client = clientWith(captured, 200, { wallet: BLOB.wallet, balanceAusd: 0 });
    const dto = await client.me();
    const call = only(captured);
    expect(call.url).toBe("https://api.example.test/api/me");
    expect((call.init.headers as Headers).get("x-kite-session")).toBe(
      `${BLOB.wallet}|${BLOB.until}|27|${BLOB.sig.r}|${BLOB.sig.s}`,
    );
    expect(dto.wallet).toBe(BLOB.wallet);
  });

  it("verificationPost sends an integral JSON body and returns the trigger dto", async () => {
    const captured: Captured[] = [];
    const client = clientWith(captured, 200, {
      identityBound: false,
      dripped: false,
      enqueued: ["bind_identity", "drip"],
    });
    const dto = await client.verificationPost(`0x${"11".repeat(32)}`);
    const call = only(captured);
    expect(call.url).toBe("https://api.example.test/api/me/verification");
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(String(call.init.body))).toEqual({
      identityHash: `0x${"11".repeat(32)}`,
    });
    expect(dto.enqueued).toEqual(["bind_identity", "drip"]);
  });

  it("quote() encodes the pair and returns rate/scale untouched", async () => {
    const captured: Captured[] = [];
    const client = clientWith(captured, 200, { pair: "USD_IDR", rate: 16000, scale: 0 });
    const dto = await client.quote("USD_IDR");
    expect(only(captured).url).toBe("https://api.example.test/api/quote?pair=USD_IDR");
    expect(dto.rate).toBe(16000);
    expect(dto.scale).toBe(0);
  });

  it("401 → ApiError with the envelope code AND onUnauthorized fired once", async () => {
    const captured: Captured[] = [];
    let unauthorized = 0;
    const client = clientWith(
      captured,
      401,
      { error: { code: "session_expired", message: "sign in again" } },
      { onUnauthorized: () => (unauthorized += 1) },
    );
    try {
      await client.me();
      throw new Error("must have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
      expect((err as ApiError).code).toBe("session_expired");
    }
    expect(unauthorized).toBe(1);
  });

  it("422 identity_hash_invalid surfaces the server code verbatim", async () => {
    const captured: Captured[] = [];
    const client = clientWith(captured, 422, {
      error: { code: "identity_hash_invalid", message: "bad identity hash" },
    });
    try {
      await client.verificationPost("nope");
      throw new Error("must have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("identity_hash_invalid");
    }
  });

  it("transport failure → ApiError code network (plain retry language)", async () => {
    const storage = new MemoryStorage();
    saveSessionBlob(storage, BLOB);
    const client = makeApiClient({
      baseUrl: "https://api.example.test",
      storage,
      fetchImpl: (async () => {
        throw new TypeError("down");
      }) as unknown as typeof fetch,
    });
    try {
      await client.verificationGet();
      throw new Error("must have thrown");
    } catch (err) {
      expect((err as ApiError).code).toBe("network");
      expect((err as ApiError).status).toBe(0);
    }
  });
});
