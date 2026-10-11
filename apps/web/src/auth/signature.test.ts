// T011 — the pure serialization of a signing session's compact signature
// (the only adapter part testable without a ceremony; the ceremony itself is
// T005's on-device gate).
import { describe, expect, it } from "bun:test";
import { splitCompactSignature } from "./session.js";

describe("splitCompactSignature (contract §1.1 wire form)", () => {
  it("splits r‖s and sets v = 27 + recovery", () => {
    const compact = Uint8Array.from({ length: 64 }, (_, i) => i & 0xff);
    expect(splitCompactSignature(compact, 0)).toEqual({
      v: 27,
      r: `0x${Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("")}`,
      s: `0x${Array.from({ length: 32 }, (_, i) => (i + 32).toString(16).padStart(2, "0")).join("")}`,
    });
    expect(splitCompactSignature(compact, 1).v).toBe(28);
  });

  it("refuses anything that is not a 64-byte compact with a 0|1 recovery", () => {
    expect(() => splitCompactSignature(new Uint8Array(65), 0)).toThrow(/64 bytes/);
    expect(() => splitCompactSignature(new Uint8Array(64), 2)).toThrow(/recovery/);
  });
});
