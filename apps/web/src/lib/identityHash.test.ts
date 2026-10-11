// T016 — the hash is deterministic, account-bound, and material-sensitive.
import { describe, expect, it } from "bun:test";
import { demoIdentityHash } from "./identityHash.js";

const WALLET = "0xDbAc9A1F342a1b5Fb2956e58E6528ca0F8C44aAD";
const KTP = Uint8Array.from([1, 2, 3]);
const SELFIE = Uint8Array.from([9, 8, 7]);

describe("demoIdentityHash (T016, data-model §3)", () => {
  it("is deterministic and 0x + 64 hex", () => {
    const a = demoIdentityHash(WALLET, KTP, SELFIE);
    const b = demoIdentityHash(WALLET, KTP, SELFIE);
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changes with either material AND with the account", () => {
    const base = demoIdentityHash(WALLET, KTP, SELFIE);
    expect(demoIdentityHash(WALLET, Uint8Array.from([1, 2, 4]), SELFIE)).not.toBe(base);
    expect(demoIdentityHash(WALLET, KTP, Uint8Array.from([9, 8, 6]))).not.toBe(base);
    expect(
      demoIdentityHash("0x127BD57eA26e6F5eee15efe8b5b495ae539d82Ea", KTP, SELFIE),
    ).not.toBe(base);
  });

  it("is insensitive to the SAME byte content via different references (pure function of bytes)", () => {
    expect(demoIdentityHash(WALLET, Uint8Array.from(KTP), Uint8Array.from(SELFIE))).toBe(
      demoIdentityHash(WALLET, KTP, SELFIE),
    );
  });
});
