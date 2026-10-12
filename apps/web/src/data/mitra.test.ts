// T033/T034 — the Mitra seam under test: registry rows decode with integer
// money only (a float is an error, never a rounding), the MITA key rides
// every call, the split preview reproduces the contract's exact integer
// split, and the unconfigured submitter refuses loudly.
import { describe, expect, test } from "bun:test";
import {
  isKiteRow,
  makeMitraClient,
  makeUnconfiguredSubmitter,
  rowFromDto,
  splitPreview,
} from "./mitra.js";

const DTO = {
  id: "pur-1",
  channelId: 1,
  isaId: 9,
  purchaseRef: `0x${"ab".repeat(32)}`,
  grossAusd: 1_000_000,
  status: "PENDING",
  txHash: null,
  createdAt: "2026-10-12T00:00:00.000Z",
};

interface Recorded {
  url: string;
  init?: RequestInit;
}

function fetchJson(body: unknown, status = 200): { impl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe("rowFromDto", () => {
  test("maps the registry row; a null txHash becomes absent", () => {
    const row = rowFromDto(DTO);
    expect(row.id).toBe("pur-1");
    expect(row.grossAusd).toBe(1_000_000n);
    expect(row.status).toBe("PENDING");
    expect(row.txHash).toBeUndefined();
  });

  test("keeps a present txHash", () => {
    const row = rowFromDto({ ...DTO, txHash: `0x${"cd".repeat(32)}` });
    expect(row.txHash).toBe(`0x${"cd".repeat(32)}`);
  });

  test("rejects a float gross with an error, never a rounding", () => {
    expect(() => rowFromDto({ ...DTO, grossAusd: 1.5 })).toThrow();
  });

  test("rejects an unknown status", () => {
    expect(() => rowFromDto({ ...DTO, status: "WEIRD" })).toThrow();
  });
});

describe("makeMitraClient", () => {
  test("list sends the key header and decodes rows", async () => {
    const { impl, calls } = fetchJson([DTO]);
    const client = makeMitraClient("https://api.example/", "mita-key", impl);
    const rows = await client.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.grossAusd).toBe(1_000_000n);
    expect(calls[0]?.url).toBe("https://api.example/api/channel/purchases");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("x-api-key")).toBe("mita-key");
  });

  test("markPaid POSTs the paid path with the key", async () => {
    const { impl, calls } = fetchJson({ ...DTO, status: "PAID" });
    const client = makeMitraClient("https://api.example", "mita-key", impl);
    const row = await client.markPaid("pur-1");
    expect(row.status).toBe("PAID");
    expect(calls[0]?.url).toBe("https://api.example/api/channel/purchases/pur-1/paid");
    expect(calls[0]?.init?.method).toBe("POST");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("x-api-key")).toBe("mita-key");
  });

  test("a non-2xx surfaces as an error", async () => {
    const { impl } = fetchJson({ error: { code: "unauthorized", message: "x" } }, 401);
    const client = makeMitraClient("https://api.example", "wrong", impl);
    expect(client.list()).rejects.toThrow();
  });
});

describe("channel + split", () => {
  test("channel 1 is Kite; any other channel is not", () => {
    const row = rowFromDto(DTO);
    expect(isKiteRow(row)).toBe(true);
    expect(isKiteRow({ ...row, channelId: 2 })).toBe(false);
  });

  test("the split matches the contract's integer math (1536 bps of 1 AUSD)", () => {
    const split = splitPreview(1_000_000n, { shareBps: 1536 });
    expect(split.toSeekerAusd).toBe(153_600n);
    expect(split.toBackerAusd).toBe(846_400n);
  });

  test("the remainder stays with the backer; the split always sums to gross", () => {
    const split = splitPreview(1n, { shareBps: 3333 });
    expect(split.toSeekerAusd).toBe(0n);
    expect(split.toBackerAusd).toBe(1n);
    expect(split.toSeekerAusd + split.toBackerAusd).toBe(split.grossAusd);
  });
});

describe("makeUnconfiguredSubmitter", () => {
  test("refuses loudly — settlement never silently pretends", async () => {
    const submitter = makeUnconfiguredSubmitter();
    expect(submitter.submit("pur-1")).rejects.toThrow();
  });
});
