// T013 — the pure serialization/digest parts, plus ONE end-to-end proof:
// the account adapter over a session built on a known private key produces
// BYTE-IDENTICAL output to viem's own privateKeyToAccount signer. If the
// EIP-155 digest, the v formula, or the re-serialization drifted anywhere,
// that equality dies. Message and typed-data signatures are proven by local
// recovery back to the same address (pure crypto — no RPC).

import { describe, expect, it } from "bun:test";
import { KITE_GAS_LIMITS } from "@kite/contracts";
import type { Hex, TransactionSerializableLegacy } from "viem";
import {
  keccak256,
  recoverMessageAddress,
  recoverTypedDataAddress,
  serializeTransaction,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toBytes, toHex } from "viem/utils";
import {
  DRAFT_GAS_LIMIT,
  eip155V,
  hexSignature65,
  legacyDigest,
  makeTxAccount,
  txSignatureParts,
} from "./tx.js";
import type { AccountSession } from "./types.js";

/** A real signer behind the origin-agnostic session (no mera, no ceremony). */
function sessionFor(pk: `0x${string}`): AccountSession {
  const account = privateKeyToAccount(pk);
  let ended = false;
  const refuse = (): never => {
    throw new Error("session ended");
  };
  return {
    address: account.address,
    async signIntent() {
      if (ended) refuse();
      throw new Error("not exercised here");
    },
    async signDigest(digest: Uint8Array) {
      if (ended) refuse();
      const sig = await account.sign({ hash: toHex(digest) as Hex });
      const bytes = toBytes(sig);
      const vByte = bytes[64];
      if (vByte === undefined) throw new Error("short signature");
      return { compact: bytes.slice(0, 64), recovery: vByte - 27 };
    },
    end() {
      ended = true;
    },
  };
}

const pk = generatePrivateKey();
const theirs = privateKeyToAccount(pk);
const mine = makeTxAccount(sessionFor(pk), 10143);
const RECIPIENT = privateKeyToAccount(generatePrivateKey()).address;

const LEGACY_TX: TransactionSerializableLegacy = {
  chainId: 10143,
  nonce: 7,
  to: RECIPIENT,
  value: 1_000_000_000_000n,
  gas: DRAFT_GAS_LIMIT,
  gasPrice: 50_000_000_000n,
  data: "0xdeadbeef",
};

describe("tx.ts pure parts (T013)", () => {
  it("the EIP-155 v formula: recovery + 35 + 2×network id", () => {
    expect(eip155V(0, 10143)).toBe(20_321);
    expect(eip155V(1, 10143)).toBe(20_322);
    expect(() => eip155V(2, 10143)).toThrow(/recovery bit/);
    expect(() => eip155V(0, 0)).toThrow(/positive integer/);
  });

  it("txSignatureParts splits the compact halves and bakes the EIP-155 v", () => {
    const compact = toBytes(`0x${"11".repeat(32)}${"22".repeat(32)}`);
    const parts = txSignatureParts(compact, 0, 10143);
    expect(parts.r).toBe(`0x${"11".repeat(32)}`);
    expect(parts.s).toBe(`0x${"22".repeat(32)}`);
    expect(parts.v).toBe(20_321n);
  });

  it("legacyDigest is the 32-byte keccak of the serialized unsigned tx", () => {
    const unsigned = serializeTransaction(LEGACY_TX);
    const digest = legacyDigest(unsigned);
    expect(digest).toHaveLength(32);
    expect(toHex(digest)).toBe(keccak256(unsigned));
  });

  it("hexSignature65 is r‖s‖v with v 1b/1c", () => {
    const compact = toBytes(`0x${"11".repeat(32)}${"22".repeat(32)}`);
    expect(hexSignature65(compact, 0)).toBe(`0x${"11".repeat(32)}${"22".repeat(32)}1b`);
    expect(hexSignature65(compact, 1)).toBe(`0x${"11".repeat(32)}${"22".repeat(32)}1c`);
  });

  it("DRAFT_GAS_LIMIT is the published 345000 — never an estimate", () => {
    expect(DRAFT_GAS_LIMIT).toBe(345_000n);
    expect(DRAFT_GAS_LIMIT).toBe(BigInt(KITE_GAS_LIMITS.createISADraft.fixedLimit));
  });
});

describe("makeTxAccount (T013 — research D3)", () => {
  it("signTransaction output is BYTE-IDENTICAL to viem's own signer", async () => {
    const a = await mine.signTransaction(LEGACY_TX);
    const b = await theirs.signTransaction(LEGACY_TX);
    expect(a).toBe(b);
  });

  it("signMessage recovers to the session address (EIP-191, no prompt)", async () => {
    const sig = await mine.signMessage({ message: "Kite test message" });
    const recovered = await recoverMessageAddress({
      message: "Kite test message",
      signature: sig,
    });
    expect(recovered.toLowerCase()).toBe(theirs.address.toLowerCase());
  });

  it("signTypedData produces a signature that recovers over the permit domain", async () => {
    const verifyingContract = privateKeyToAccount(generatePrivateKey()).address;
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const typedData = {
      domain: { name: "AUSD", version: "1", chainId: 10143, verifyingContract },
      types,
      primaryType: "Permit",
      message: {
        owner: theirs.address,
        spender: RECIPIENT,
        value: 480_000_000n,
        nonce: 0n,
        deadline: 1_760_000_000n,
      },
    } as const;
    const sig = await mine.signTypedData(typedData);
    const recovered = await recoverTypedDataAddress({ ...typedData, signature: sig });
    expect(recovered.toLowerCase()).toBe(theirs.address.toLowerCase());
  });

  it("an ended session refuses to sign (end() is terminal)", async () => {
    const local = sessionFor(generatePrivateKey());
    const account = makeTxAccount(local, 10143);
    local.end();
    await expect(account.signMessage({ message: "after end" })).rejects.toThrow();
  });
});
