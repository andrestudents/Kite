// T013: test vectors generated + verified with viem in-test — the encoding
// must match SignIncome.s.sol byte-for-byte (research D8).
import { describe, expect, it } from "bun:test";
import { privateKeyToAccount, sign } from "viem/accounts";
import {
  type IncomePayload,
  incomeDigest,
  recoverIncomeSigner,
  verifyMillSignature,
} from "./income-sig.js";

const PAYLOAD: IncomePayload = {
  channelId: 1,
  isaId: 3,
  purchaseRef: `0x${"a1".repeat(32)}` as `0x${string}`,
  gross: 1_500_000_000,
  salt: `0x${"7f".repeat(32)}` as `0x${string}`,
};

/** Sign a digest exactly the way vm.sign / the mill key would. */
async function millSign(privateKey: `0x${string}`, payload: IncomePayload) {
  const digest = incomeDigest(payload);
  const signature = await sign({ hash: digest, privateKey });
  return {
    salt: payload.salt,
    v: Number(signature.v),
    r: signature.r,
    s: signature.s,
    digest,
  };
}

describe("incomeDigest (SignIncome.s.sol encoding)", () => {
  it("is deterministic for the same payload", () => {
    expect(incomeDigest(PAYLOAD)).toBe(incomeDigest(PAYLOAD));
  });

  it("changes with every payload field", () => {
    const base = incomeDigest(PAYLOAD);
    expect(incomeDigest({ ...PAYLOAD, channelId: 2 })).not.toBe(base);
    expect(incomeDigest({ ...PAYLOAD, isaId: 4 })).not.toBe(base);
    expect(
      incomeDigest({ ...PAYLOAD, purchaseRef: `0x${"a2".repeat(32)}` as `0x${string}` }),
    ).not.toBe(base);
    expect(incomeDigest({ ...PAYLOAD, gross: 1_500_000_001 })).not.toBe(base);
    expect(incomeDigest({ ...PAYLOAD, salt: `0x${"7e".repeat(32)}` as `0x${string}` })).not.toBe(
      base,
    );
  });
});

describe("recover + verify (T013 vector)", () => {
  it("round-trips: sign with a viem account → recover → verify passes", async () => {
    const account = privateKeyToAccount(`0x${"9d".repeat(32)}` as `0x${string}`);
    const sig = await millSign(`0x${"9d".repeat(32)}` as `0x${string}`, PAYLOAD);
    expect(await recoverIncomeSigner(sig, PAYLOAD)).toBe(account.address);
    expect(await verifyMillSignature(sig, PAYLOAD, account.address)).toBe(true);
    // case-insensitive pubkey compare
    expect(await verifyMillSignature(sig, PAYLOAD, account.address.toUpperCase())).toBe(true);
  });

  it("rejects a different signer for the same payload", async () => {
    const mill = privateKeyToAccount(`0x${"9d".repeat(32)}` as `0x${string}`);
    const stranger = privateKeyToAccount(`0x${"3c".repeat(32)}` as `0x${string}`);
    const sig = await millSign(`0x${"3c".repeat(32)}` as `0x${string}`, PAYLOAD);
    expect(await verifyMillSignature(sig, PAYLOAD, mill.address)).toBe(false);
    void stranger;
  });

  it("rejects a signature over different payload bytes", async () => {
    const mill = privateKeyToAccount(`0x${"9d".repeat(32)}` as `0x${string}`);
    const sig = await millSign(`0x${"9d".repeat(32)}` as `0x${string}`, PAYLOAD);
    expect(await verifyMillSignature(sig, { ...PAYLOAD, gross: 2_000_000_000 }, mill.address)).toBe(
      false,
    );
  });

  it("treats v as parity: v:1 (yParity 1) recovers like v:28; v:0 does not", async () => {
    const mill = privateKeyToAccount(`0x${"9d".repeat(32)}` as `0x${string}`);
    const sig = await millSign(`0x${"9d".repeat(32)}` as `0x${string}`, PAYLOAD);
    if (sig.v === 28) {
      expect(await verifyMillSignature({ ...sig, v: 1 }, PAYLOAD, mill.address)).toBe(true);
    }
    // the other parity recovers a different (wrong) signer
    expect(
      await verifyMillSignature({ ...sig, v: sig.v === 28 ? 27 : 28 }, PAYLOAD, mill.address),
    ).toBe(false);
    // malformed parity → wrong signer → false, never a throw
    expect(await verifyMillSignature({ ...sig, v: 0 }, PAYLOAD, mill.address)).toBe(false);
  });
});
