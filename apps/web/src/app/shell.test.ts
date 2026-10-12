// T038 — the shell helpers' contract: the public paths answer directly,
// everything else is the tabbed app; the toggle cycles all three catalogs;
// corrupt persisted bytes fall back to the primary catalog.
import { describe, expect, test } from "bun:test";
import { loadLang, nextLang, parseAppPath } from "./shell.js";

describe("parseAppPath", () => {
  test("the operator console answers at /mitra — no session", () => {
    expect(parseAppPath("/mitra")).toEqual({ kind: "mitra" });
    expect(parseAppPath("/mitra/")).toEqual({ kind: "mitra" });
  });

  test("a public profile deep link carries its id", () => {
    expect(parseAppPath("/p/abc-123")).toEqual({ kind: "profile", id: "abc-123" });
    expect(parseAppPath("/p/abc-123/")).toEqual({ kind: "profile", id: "abc-123" });
  });

  test("everything else is the tabbed app", () => {
    expect(parseAppPath("/")).toEqual({ kind: "app" });
    expect(parseAppPath("/p/")).toEqual({ kind: "app" });
    expect(parseAppPath("/smoke/index.html")).toEqual({ kind: "app" });
  });
});

describe("locale cycle", () => {
  test("id → ms → en → id", () => {
    expect(nextLang("id")).toBe("ms");
    expect(nextLang("ms")).toBe("en");
    expect(nextLang("en")).toBe("id");
  });

  test("absent or corrupt storage falls back to the primary catalog", () => {
    expect(loadLang(null)).toBe("id");
    expect(loadLang("xx")).toBe("id");
    expect(loadLang("ms")).toBe("ms");
  });
});
