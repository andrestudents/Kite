// The mill's EIP-712 income signature (research D8) — recomputed EXACTLY as
// contracts/script/SignIncome.s.sol: typehash
// IncomeEvent(uint64 channelId,uint256 isaId,bytes32 purchaseRef,uint256 gross,
// bytes32 salt) over domain ("KiteCore","1",chainId,KITE_DEPLOYMENT.kiteCore).
// The registry captures {salt,v,r,s} at creation (§7.1 anti-collusion record —
// constitution V): the mill attests the purchase BEFORE settlement exists.
import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  recoverAddress,
  toHex,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { KITE_DEPLOYMENT } from "@kite/contracts";
import type { MillSig } from "@kite/core/db";

const INCOME_TYPEHASH = keccak256(
  toHex("IncomeEvent(uint64 channelId,uint256 isaId,bytes32 purchaseRef,uint256 gross,bytes32 salt)"),
);
const DOMAIN_TYPEHASH = keccak256(
  toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
);

const DOMAIN_FIELDS = [
  { type: "bytes32" }, // the domain typehash itself is the first encoded slot
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "uint256" },
  { type: "address" },
] as const;

const STRUCT_FIELDS = [
  { type: "bytes32" },
  { type: "uint64" },
  { type: "uint256" },
  { type: "bytes32" },
  { type: "uint256" },
  { type: "bytes32" },
] as const;

export interface IncomePayload {
  channelId: number;
  isaId: number;
  purchaseRef: Hex;
  gross: number;
  salt: Hex;
}

/** The \x19\x01-prefixed digest KiteCore's `receiveIncome` recovers. */
export function incomeDigest(payload: IncomePayload): Hash {
  const domain = keccak256(
    encodeAbiParameters(DOMAIN_FIELDS, [
      DOMAIN_TYPEHASH,
      keccak256(toHex("KiteCore")),
      keccak256(toHex("1")),
      BigInt(KITE_DEPLOYMENT.chainId),
      KITE_DEPLOYMENT.kiteCore,
    ]),
  );
  const structHash = keccak256(
    encodeAbiParameters(STRUCT_FIELDS, [
      INCOME_TYPEHASH,
      BigInt(payload.channelId),
      BigInt(payload.isaId),
      payload.purchaseRef,
      BigInt(payload.gross),
      payload.salt,
    ]),
  );
  return keccak256(encodePacked(["string", "bytes32", "bytes32"], ["\x19\x01", domain, structHash]));
}

/** Recover the signer of a stored millSig for this payload. */
export async function recoverIncomeSigner(sig: MillSig, payload: IncomePayload): Promise<Address> {
  return recoverAddress({
    hash: incomeDigest(payload),
    signature: { r: sig.r as Hex, s: sig.s as Hex, v: sig.v as 27 | 28 },
  });
}

/** True iff the signature is the channel's registered pubkey over this payload. */
export async function verifyMillSignature(
  sig: MillSig,
  payload: IncomePayload,
  expectedPubkey: string,
): Promise<boolean> {
  try {
    const signer = await recoverIncomeSigner(sig, payload);
    return signer.toLowerCase() === expectedPubkey.toLowerCase();
  } catch {
    return false;
  }
}
