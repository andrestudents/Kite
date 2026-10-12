// T013 — the transaction-signing path (research D3): the draft broadcast is
// the seeker's OWN account. A viem account adapter INSIDE auth/ feeds the
// serialized-tx digest (EIP-155) to the SAME prompt-free signing session
// primitive that 006 uses for messages — mera imports stay confined to the
// adapters; this file consumes only the origin-agnostic AccountSession.
// Gas is the PUBLISHED fixed limit (constitution III: charged on the limit,
// never a client estimate). Typed data (EIP-712) rides the same digest
// primitive — the Dukung permit signature (T016) is one session call away.
import { KITE_GAS_LIMITS } from "@kite/contracts";
import type {
  Hex,
  SignableMessage,
  TransactionSerializable,
  TypedData,
  TypedDataDefinition,
} from "viem";
import { hashMessage, hashTypedData, keccak256, serializeTransaction } from "viem";
import { type CustomSource, toAccount } from "viem/accounts";
import { toBytes } from "viem/utils";
import { splitCompactSignature } from "./session.js";
import type { AccountSession } from "./types.js";

/** The published cold-padded limit for the draft broadcast (constitution
 *  III). Callers set `gas` to THIS — never an estimate. */
export const DRAFT_GAS_LIMIT = BigInt(KITE_GAS_LIMITS.createISADraft.fixedLimit);

/** EIP-155 `v`: recovery bit + 35 + 2×network id. Pure — unit-tested. */
export function eip155V(recovery: number, networkId: number): number {
  if (recovery !== 0 && recovery !== 1) {
    throw new Error(`recovery bit must be 0 or 1, got ${recovery}`);
  }
  if (!Number.isInteger(networkId) || networkId < 1) {
    throw new Error(`network id must be a positive integer, got ${networkId}`);
  }
  return recovery + 35 + 2 * networkId;
}

/** The serialized UNSIGNED tx → the 32-byte digest the session signs. */
export function legacyDigest(serializedUnsigned: Hex): Uint8Array {
  return toBytes(keccak256(serializedUnsigned));
}

/** Session output (compact r‖s + recovery) → viem's serializeTransaction
 *  signature: r/s as 0x-hex, v as the EIP-155 bigint. Pure — unit-tested. */
export function txSignatureParts(
  compact: Uint8Array,
  recovery: number,
  networkId: number,
): { r: `0x${string}`; s: `0x${string}`; v: bigint } {
  const { r, s } = splitCompactSignature(compact, recovery);
  return { r, s, v: BigInt(eip155V(recovery, networkId)) };
}

/** 65-byte hex signature (r‖s‖v, v 27|28) — viem's signMessage/signTypedData
 *  return shape. Pure. */
export function hexSignature65(compact: Uint8Array, recovery: number): `0x${string}` {
  const { v, r, s } = splitCompactSignature(compact, recovery);
  return `0x${r.slice(2)}${s.slice(2)}${v.toString(16).padStart(2, "0")}`;
}

/**
 * The viem local account over a live session (research D3). signTransaction
 * serializes the UNSIGNED tx, keccak-hashes it, signs the digest through the
 * session (in-session — D7, no new ceremony), and re-serializes with the
 * EIP-155 v. signMessage / signTypedData take the same digest road.
 */
export function makeTxAccount(session: AccountSession, networkId: number) {
  const source: CustomSource = {
    address: session.address,
    signMessage: async ({ message }: { message: SignableMessage }) => {
      const out = await session.signDigest(toBytes(hashMessage(message)));
      return hexSignature65(out.compact, out.recovery);
    },
    signTransaction: async (transaction: TransactionSerializable) => {
      const unsigned = serializeTransaction(transaction);
      const out = await session.signDigest(legacyDigest(unsigned));
      return serializeTransaction(
        transaction,
        txSignatureParts(out.compact, out.recovery, networkId),
      );
    },
    signTypedData: async <
      const typedData extends TypedData | Record<string, unknown>,
      primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
    >(
      parameters: TypedDataDefinition<typedData, primaryType>,
    ): Promise<Hex> => {
      const out = await session.signDigest(toBytes(hashTypedData(parameters)));
      return hexSignature65(out.compact, out.recovery);
    },
  };
  return toAccount(source);
}
