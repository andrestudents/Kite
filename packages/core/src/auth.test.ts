import { describe, expect, it } from "bun:test";
import { verifyApiKey } from "./auth.js";

describe("verifyApiKey (research D11)", () => {
  const KEY = "mita-demo-key-9f2c";

  it("accepts an exact match", () => {
    expect(verifyApiKey(KEY, KEY)).toBe(true);
  });

  it("rejects a wrong key of equal length", () => {
    expect(verifyApiKey("mita-demo-key-9f2d", KEY)).toBe(false);
  });

  it("rejects wrong keys of different lengths without throwing", () => {
    expect(verifyApiKey("short", KEY)).toBe(false);
    expect(verifyApiKey(`${KEY}${KEY}`, KEY)).toBe(false);
  });

  it("is false when either side is missing", () => {
    expect(verifyApiKey(undefined, KEY)).toBe(false);
    expect(verifyApiKey(null, KEY)).toBe(false);
    expect(verifyApiKey(KEY, undefined)).toBe(false);
    expect(verifyApiKey(KEY, null)).toBe(false);
    expect(verifyApiKey(undefined, undefined)).toBe(false);
  });

  it("treats keys as opaque bytes (case/whitespace matter)", () => {
    expect(verifyApiKey(`${KEY} `, KEY)).toBe(false);
    expect(verifyApiKey(KEY.toUpperCase(), KEY)).toBe(false);
  });
});
