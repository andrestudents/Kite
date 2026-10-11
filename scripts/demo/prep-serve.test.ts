// T024 — the one-time key server's CONTRACT, headless: env parsing refuses
// malformed/absent keys by NAME, the handler serves each configured key
// exactly once (200 → 410), unknown routes 404, and the all-served callback
// fires exactly once. Key VALUES appear only as handler outputs in-memory.
import { describe, expect, it } from "bun:test";
import {
  KEY_RE,
  makePrepHandler,
  type PersonaId,
  parsePersonaKeys,
  personaAddresses,
  randomKeyHex,
} from "./prep-serve.js";

describe("parsePersonaKeys (T024 — env-only key intake)", () => {
  it("no keys configured → refused with usage guidance", () => {
    const parsed = parsePersonaKeys({});
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("unreachable");
    expect(parsed.problem).toMatch(/nothing to serve/);
  });

  it("empty-string env entries count as absent", () => {
    const parsed = parsePersonaKeys({ BUDI_KEY: "", PAKHAJI_KEY: "" });
    expect(parsed.ok).toBe(false);
  });

  it("a malformed key is refused BY NAME — the value is never echoed", () => {
    const parsed = parsePersonaKeys({ BUDI_KEY: "0x1234" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("unreachable");
    expect(parsed.problem).toMatch(/^BUDI_KEY is set but malformed/);
    expect(parsed.problem).not.toContain("1234");
  });

  it("valid keys are accepted; only 0x + 64 hex qualifies", () => {
    const budi = randomKeyHex();
    const parsed = parsePersonaKeys({ BUDI_KEY: budi });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.keys.get("budi")).toBe(budi);
    expect(parsed.keys.has("pakhaji")).toBe(false);
    expect(KEY_RE.test(randomKeyHex())).toBe(true);
    expect(KEY_RE.test(`0x${"g".repeat(64)}`)).toBe(false);
  });
});

describe("makePrepHandler (T024 — 200-once, then gone)", () => {
  it("serves a configured key exactly once: 200 with CORS/no-store, then 410", async () => {
    const budi = randomKeyHex();
    let allServed = 0;
    const handler = makePrepHandler(new Map([["budi", budi]]), () => {
      allServed += 1;
    });
    const first = handler(new Request("http://laptop:8787/key/budi"));
    expect(first.status).toBe(200);
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    // The one read below IS the key leaving the process boundary — exactly once.
    expect(await first.text()).toBe(budi);
    const replay = handler(new Request("http://laptop:8787/key/budi"));
    expect(replay.status).toBe(410);
    expect(allServed).toBe(1);
  });

  it("unconfigured personas and unknown routes answer 404", () => {
    const handler = makePrepHandler(new Map([["budi", randomKeyHex()]]));
    expect(handler(new Request("http://x/key/pakhaji")).status).toBe(404);
    expect(handler(new Request("http://x/nope")).status).toBe(404);
  });

  it("all-served fires once, only after EVERY configured persona was fetched", () => {
    const keys = new Map<PersonaId, string>([
      ["budi", randomKeyHex()],
      ["pakhaji", randomKeyHex()],
    ]);
    let allServed = 0;
    const handler = makePrepHandler(keys, () => {
      allServed += 1;
    });
    expect(handler(new Request("http://x/key/budi")).status).toBe(200);
    expect(allServed).toBe(0);
    expect(handler(new Request("http://x/key/pakhaji")).status).toBe(200);
    expect(allServed).toBe(1);
    expect(handler(new Request("http://x/key/pakhaji")).status).toBe(410);
    expect(allServed).toBe(1);
  });
});

describe("personaAddresses (T024 — only addresses may print)", () => {
  it("derives the EVM address for each configured key", () => {
    const keys = new Map<PersonaId, string>([["budi", randomKeyHex()]]);
    const addresses = personaAddresses(keys);
    expect(/^0x[0-9a-fA-F]{40}$/.test(addresses.get("budi") ?? "")).toBe(true);
    expect(addresses.has("pakhaji")).toBe(false);
  });
});
